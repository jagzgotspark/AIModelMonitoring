import numpy as np
import pandas as pd
import shap

from app.ml.training import decode_labels


def explain_model(pipeline, X_sample: pd.DataFrame, feature_columns: list[str]) -> dict:
    preprocessor = pipeline.named_steps["preprocess"]
    model = pipeline.named_steps["model"]

    X_transformed = preprocessor.transform(X_sample)
    if hasattr(X_transformed, "toarray"):
        X_transformed = X_transformed.toarray()

    try:
        feature_names = list(preprocessor.get_feature_names_out())
    except Exception:
        feature_names = feature_columns

    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_transformed)

    # Normalise multi-output results to (n_samples, n_features, n_classes).
    if isinstance(shap_values, list):
        shap_values = np.stack(shap_values, axis=-1)

    explained_class = None
    if len(getattr(model, "classes_", [])) == 2:
        # Binary: the two classes' SHAP values mirror each other, so use the positive class.
        # (Random Forest returns both classes; XGBoost returns only the positive one.)
        if shap_values.ndim == 3:
            shap_values = shap_values[:, :, 1]
        explained_class = decode_labels(pipeline, [1])[0]

    if shap_values.ndim == 3:
        # Multiclass: a feature matters if it moves any class, so average |SHAP| over classes too.
        mean_abs_shap = np.abs(shap_values).mean(axis=(0, 2))
        predicted = int(model.predict(X_transformed[:1])[0])
        first_row_shap = shap_values[0, :, predicted]
        explained_class = decode_labels(pipeline, [predicted])[0]
    else:
        mean_abs_shap = np.abs(shap_values).mean(axis=0)
        first_row_shap = shap_values[0] if len(shap_values) else np.zeros(len(feature_names))

    global_importance = {
        name: float(score) for name, score in zip(feature_names, mean_abs_shap)
    }
    sample_explanation = {
        name: float(score) for name, score in zip(feature_names, first_row_shap)
    }

    return {
        "feature_names": feature_names,
        "global_importance": global_importance,
        "sample_explanation": sample_explanation,
        "explained_class": None if explained_class is None else str(explained_class),
    }
