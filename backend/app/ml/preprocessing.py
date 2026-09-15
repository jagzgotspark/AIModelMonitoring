import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


def infer_task_type(series: pd.Series) -> str:
    if series.dtype == object or series.dtype.name == "category":
        return "classification"
    if series.nunique() <= 20:
        return "classification"
    return "regression"


def build_preprocessor(df: pd.DataFrame, feature_columns: list[str]) -> ColumnTransformer:
    numeric_cols = [c for c in feature_columns if pd.api.types.is_numeric_dtype(df[c])]
    categorical_cols = [c for c in feature_columns if c not in numeric_cols]

    numeric_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
        ]
    )
    categorical_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("encoder", OneHotEncoder(handle_unknown="ignore")),
        ]
    )

    return ColumnTransformer(
        transformers=[
            ("num", numeric_pipeline, numeric_cols),
            ("cat", categorical_pipeline, categorical_cols),
        ]
    )


def profile_columns(df: pd.DataFrame) -> dict:
    profile = {}
    for col in df.columns:
        profile[col] = {
            "dtype": str(df[col].dtype),
            "n_missing": int(df[col].isna().sum()),
            "n_unique": int(df[col].nunique()),
        }
    return profile
