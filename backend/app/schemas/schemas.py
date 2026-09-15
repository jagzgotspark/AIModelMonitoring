from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, EmailStr, ConfigDict


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    full_name: Optional[str] = None
    created_at: datetime


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class DatasetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    target_column: Optional[str] = None
    task_type: Optional[str] = None
    n_rows: Optional[int] = None
    n_columns: Optional[int] = None
    columns_meta: Optional[Any] = None
    created_at: datetime


class DatasetTargetUpdate(BaseModel):
    target_column: str


class ExperimentCreate(BaseModel):
    dataset_id: str
    name: str
    algorithms: list[str] = ["random_forest", "xgboost"]
    tune_hyperparameters: bool = False


class ModelVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    algorithm: str
    version: int
    hyperparameters: Optional[Any] = None
    metrics: Optional[Any] = None
    is_deployed: bool
    created_at: datetime


class ExperimentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())

    id: str
    dataset_id: str
    name: str
    status: str
    task_type: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    model_versions: list[ModelVersionOut] = []


class ExplanationOut(BaseModel):
    algorithm: str
    feature_names: list[str]
    feature_importance: list[float]
    sample_explanation: Optional[dict[str, float]] = None


class DriftCheckRequest(BaseModel):
    records: list[dict[str, Any]]


class DriftReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    overall_drift_score: float
    is_drifted: bool
    feature_drift: Optional[Any] = None
    n_samples: Optional[int] = None
    created_at: datetime
