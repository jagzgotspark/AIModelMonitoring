import os

import pandas as pd
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import SessionLocal, get_db
from app.ml.explainability import explain_model
from app.ml.training import save_pipeline, train_model
from app.models.models import Dataset, Experiment, ExperimentStatus, ModelVersion, User
from app.schemas.schemas import ExperimentCreate, ExperimentOut, ExplanationOut

router = APIRouter(prefix="/api/experiments", tags=["experiments"])


@router.post("", response_model=ExperimentOut)
def create_experiment(
    payload: ExperimentCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    dataset = (
        db.query(Dataset)
        .filter(Dataset.id == payload.dataset_id, Dataset.owner_id == current_user.id)
        .first()
    )
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    if not dataset.target_column:
        raise HTTPException(status_code=400, detail="Set a target column on the dataset first")

    experiment = Experiment(
        owner_id=current_user.id,
        dataset_id=dataset.id,
        name=payload.name,
        status=ExperimentStatus.pending,
        task_type=dataset.task_type,
    )
    db.add(experiment)
    db.commit()
    db.refresh(experiment)

    background_tasks.add_task(
        _run_training_job,
        experiment.id,
        dataset.id,
        payload.algorithms,
        payload.tune_hyperparameters,
    )

    return experiment


def _run_training_job(
    experiment_id: str, dataset_id: str, algorithms: list[str], tune_hyperparameters: bool
) -> None:
    db = SessionLocal()
    try:
        experiment = db.query(Experiment).filter(Experiment.id == experiment_id).first()
        dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        experiment.status = ExperimentStatus.running
        db.commit()

        df = pd.read_csv(dataset.file_path)
        artifact_dir = os.path.join(settings.storage_dir, "models", experiment_id)
        os.makedirs(artifact_dir, exist_ok=True)

        for algorithm in algorithms:
            result = train_model(
                df=df,
                target_column=dataset.target_column,
                algorithm=algorithm,
                task_type=dataset.task_type,
                tune_hyperparameters=tune_hyperparameters,
            )
            artifact_path = os.path.join(artifact_dir, f"{algorithm}.joblib")
            save_pipeline(result["pipeline"], artifact_path)

            model_version = ModelVersion(
                experiment_id=experiment_id,
                algorithm=algorithm,
                hyperparameters=result["hyperparameters"],
                metrics=result["metrics"],
                feature_importance=result["feature_importance"],
                artifact_path=artifact_path,
            )
            db.add(model_version)

        experiment.status = ExperimentStatus.completed
        from datetime import datetime, timezone

        experiment.completed_at = datetime.now(timezone.utc)
        db.commit()
    except Exception as exc:  # noqa: BLE001
        experiment.status = ExperimentStatus.failed
        experiment.error_message = str(exc)
        db.commit()
    finally:
        db.close()


@router.get("", response_model=list[ExperimentOut])
def list_experiments(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return (
        db.query(Experiment)
        .filter(Experiment.owner_id == current_user.id)
        .order_by(Experiment.created_at.desc())
        .all()
    )


@router.get("/{experiment_id}", response_model=ExperimentOut)
def get_experiment(experiment_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _get_owned_experiment(experiment_id, db, current_user)


@router.post("/{experiment_id}/model-versions/{model_version_id}/deploy", response_model=ExperimentOut)
def deploy_model_version(
    experiment_id: str,
    model_version_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    experiment = _get_owned_experiment(experiment_id, db, current_user)
    target = None
    for mv in experiment.model_versions:
        mv.is_deployed = mv.id == model_version_id
        if mv.id == model_version_id:
            target = mv
    if not target:
        raise HTTPException(status_code=404, detail="Model version not found")
    db.commit()
    db.refresh(experiment)
    return experiment


@router.get("/{experiment_id}/model-versions/{model_version_id}/explain", response_model=ExplanationOut)
def explain(
    experiment_id: str,
    model_version_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    experiment = _get_owned_experiment(experiment_id, db, current_user)
    model_version = next((mv for mv in experiment.model_versions if mv.id == model_version_id), None)
    if not model_version:
        raise HTTPException(status_code=404, detail="Model version not found")

    from app.ml.training import load_pipeline

    dataset = experiment.dataset
    df = pd.read_csv(dataset.file_path)
    feature_columns = [c for c in df.columns if c != dataset.target_column]
    pipeline = load_pipeline(model_version.artifact_path)

    sample = df[feature_columns].sample(min(100, len(df)), random_state=42)
    explanation = explain_model(pipeline, sample, feature_columns)

    return ExplanationOut(
        algorithm=model_version.algorithm,
        feature_names=explanation["feature_names"],
        feature_importance=list(explanation["global_importance"].values()),
        sample_explanation=explanation["sample_explanation"],
    )


def _get_owned_experiment(experiment_id: str, db: Session, current_user: User) -> Experiment:
    experiment = (
        db.query(Experiment)
        .filter(Experiment.id == experiment_id, Experiment.owner_id == current_user.id)
        .first()
    )
    if not experiment:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return experiment
