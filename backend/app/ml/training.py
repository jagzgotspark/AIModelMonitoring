import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
    roc_auc_score,
)
from sklearn.model_selection import RandomizedSearchCV, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder
from xgboost import XGBClassifier, XGBRegressor

from app.ml.preprocessing import build_preprocessor

ALGORITHM_REGISTRY = {
    "random_forest": {
        "classification": RandomForestClassifier,
        "regression": RandomForestRegressor,
        "param_grid": {
            "model__n_estimators": [100, 200, 400],
            "model__max_depth": [None, 5, 10, 20],
            "model__min_samples_split": [2, 5, 10],
        },
    },
    "xgboost": {
        "classification": XGBClassifier,
        "regression": XGBRegressor,
        "param_grid": {
            "model__n_estimators": [100, 200, 400],
            "model__max_depth": [3, 5, 8],
            "model__learning_rate": [0.01, 0.05, 0.1, 0.2],
        },
    },
}


def _base_model(algorithm: str, task_type: str):
    entry = ALGORITHM_REGISTRY[algorithm]
    model_cls = entry[task_type]
    return model_cls(random_state=42)


def _tuning_scoring(task_type: str, n_classes: int) -> str:
    # Tune on the same metric used to pick the best model version (see app.ml.selection).
    if task_type == "classification":
        return "f1" if n_classes == 2 else "f1_macro"
    return "neg_root_mean_squared_error"


def train_model(
    df: pd.DataFrame,
    target_column: str,
    algorithm: str,
    task_type: str,
    tune_hyperparameters: bool = False,
) -> dict:
    # Rows without a label can't be used for training or evaluation.
    df = df.dropna(subset=[target_column])
    feature_columns = [c for c in df.columns if c != target_column]
    X = df[feature_columns]
    y = df[target_column]

    stratify = None
    label_classes = None
    if task_type == "classification":
        # XGBoost requires labels 0..k-1, so encode every classification target
        # (e.g. {1, 2} or {"no", "yes"}), not just string ones.
        encoder = LabelEncoder()
        y = pd.Series(encoder.fit_transform(y.astype(str)), index=y.index)
        label_classes = [str(c) for c in encoder.classes_]
        if y.value_counts().min() >= 2:
            stratify = y

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=stratify
    )

    preprocessor = build_preprocessor(df, feature_columns)
    model = _base_model(algorithm, task_type)
    pipeline = Pipeline(steps=[("preprocess", preprocessor), ("model", model)])

    best_params = {}
    if tune_hyperparameters:
        param_grid = ALGORITHM_REGISTRY[algorithm]["param_grid"]
        search = RandomizedSearchCV(
            pipeline,
            param_grid,
            n_iter=8,
            cv=3,
            scoring=_tuning_scoring(task_type, n_classes=y.nunique()),
            random_state=42,
            n_jobs=-1,
        )
        search.fit(X_train, y_train)
        pipeline = search.best_estimator_
        best_params = search.best_params_
    else:
        pipeline.fit(X_train, y_train)

    # Persisted with the artifact so encoded predictions can be mapped back to the original labels.
    pipeline.label_classes_ = label_classes

    y_pred = pipeline.predict(X_test)

    metrics = {}
    if task_type == "classification":
        metrics["accuracy"] = float(accuracy_score(y_test, y_pred))
        average = "binary" if len(np.unique(y)) == 2 else "macro"
        metrics["f1"] = float(f1_score(y_test, y_pred, average=average))
        try:
            if hasattr(pipeline, "predict_proba"):
                y_proba = pipeline.predict_proba(X_test)
                if len(np.unique(y)) == 2:
                    metrics["auc"] = float(roc_auc_score(y_test, y_proba[:, 1]))
                else:
                    metrics["auc"] = float(
                        roc_auc_score(y_test, y_proba, multi_class="ovr")
                    )
        except (ValueError, IndexError):
            pass
    else:
        metrics["rmse"] = float(np.sqrt(mean_squared_error(y_test, y_pred)))
        metrics["mae"] = float(mean_absolute_error(y_test, y_pred))
        metrics["r2"] = float(r2_score(y_test, y_pred))

    feature_names = _output_feature_names(pipeline.named_steps["preprocess"], feature_columns)
    feature_importance = _extract_feature_importance(pipeline.named_steps["model"], feature_names)

    # Report the full parameter set of the model that was actually fitted (includes tuned values).
    fitted_model = pipeline.named_steps["model"]
    hyperparameters = {k: v for k, v in fitted_model.get_params().items() if not callable(v)}
    if best_params:
        hyperparameters["tuned_params"] = best_params

    return {
        "pipeline": pipeline,
        "metrics": json_safe(metrics),
        "hyperparameters": json_safe(hyperparameters),
        "feature_importance": json_safe(feature_importance),
    }


def _output_feature_names(preprocessor, feature_columns: list[str]) -> list[str]:
    try:
        return list(preprocessor.get_feature_names_out())
    except Exception:
        return feature_columns


def _extract_feature_importance(model, feature_names: list[str]) -> dict:
    importances = getattr(model, "feature_importances_", None)
    if importances is None:
        return {}
    return {
        name: float(score)
        for name, score in zip(feature_names, importances)
    }


def json_safe(value):
    if isinstance(value, float) and (np.isnan(value) or np.isinf(value)):
        return None
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, np.generic):
        return json_safe(value.item())
    return value


def save_pipeline(pipeline, path: str) -> None:
    joblib.dump(pipeline, path)


def load_pipeline(path: str):
    return joblib.load(path)


def decode_labels(pipeline, codes) -> list:
    """Map encoded class predictions (0..k-1) back to the original target labels."""
    classes = getattr(pipeline, "label_classes_", None)
    if not classes:
        return [c.item() if isinstance(c, np.generic) else c for c in codes]
    return [classes[int(c)] for c in codes]
