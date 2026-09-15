import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.db.session import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=_uuid)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    datasets = relationship("Dataset", back_populates="owner", cascade="all, delete-orphan")
    experiments = relationship("Experiment", back_populates="owner", cascade="all, delete-orphan")


class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(String, primary_key=True, default=_uuid)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    target_column = Column(String, nullable=True)
    task_type = Column(String, nullable=True)  # classification | regression
    n_rows = Column(Integer, nullable=True)
    n_columns = Column(Integer, nullable=True)
    columns_meta = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    owner = relationship("User", back_populates="datasets")
    experiments = relationship("Experiment", back_populates="dataset", cascade="all, delete-orphan")


class ExperimentStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class Experiment(Base):
    __tablename__ = "experiments"

    id = Column(String, primary_key=True, default=_uuid)
    owner_id = Column(String, ForeignKey("users.id"), nullable=False)
    dataset_id = Column(String, ForeignKey("datasets.id"), nullable=False)
    name = Column(String, nullable=False)
    status = Column(Enum(ExperimentStatus), default=ExperimentStatus.pending)
    task_type = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    owner = relationship("User", back_populates="experiments")
    dataset = relationship("Dataset", back_populates="experiments")
    model_versions = relationship(
        "ModelVersion", back_populates="experiment", cascade="all, delete-orphan"
    )


class ModelVersion(Base):
    __tablename__ = "model_versions"

    id = Column(String, primary_key=True, default=_uuid)
    experiment_id = Column(String, ForeignKey("experiments.id"), nullable=False)
    algorithm = Column(String, nullable=False)  # random_forest | xgboost | lightgbm | neural_network
    version = Column(Integer, default=1)
    hyperparameters = Column(JSON, nullable=True)
    metrics = Column(JSON, nullable=True)
    feature_importance = Column(JSON, nullable=True)
    artifact_path = Column(String, nullable=True)
    is_deployed = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=_now)

    experiment = relationship("Experiment", back_populates="model_versions")
    drift_reports = relationship(
        "DriftReport", back_populates="model_version", cascade="all, delete-orphan"
    )


class DriftReport(Base):
    __tablename__ = "drift_reports"

    id = Column(String, primary_key=True, default=_uuid)
    model_version_id = Column(String, ForeignKey("model_versions.id"), nullable=False)
    overall_drift_score = Column(Float, nullable=False)
    is_drifted = Column(Boolean, default=False)
    feature_drift = Column(JSON, nullable=True)
    n_samples = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_now)

    model_version = relationship("ModelVersion", back_populates="drift_reports")
