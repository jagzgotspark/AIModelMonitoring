import numpy as np
import pandas as pd
import shap


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

    if isinstance(shap_values, list):
        shap_values = shap_values[-1]
    elif isinstance(shap_values, np.ndarray) and shap_values.ndim == 3:
        shap_values = shap_values[:, :, -1]

    mean_abs_shap = np.abs(shap_values).mean(axis=0)
    global_importance = {
        name: float(score) for name, score in zip(feature_names, mean_abs_shap)
    }

    first_row_shap = shap_values[0] if len(shap_values) else np.zeros(len(feature_names))
    sample_explanation = {
        name: float(score) for name, score in zip(feature_names, first_row_shap)
    }

    return {
        "feature_names": feature_names,
        "global_importance": global_importance,
        "sample_explanation": sample_explanation,
    }
