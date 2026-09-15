from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.models import Dataset, DriftReport, Experiment, ExperimentStatus, ModelVersion, User

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/summary")
def get_summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    dataset_count = db.query(Dataset).filter(Dataset.owner_id == current_user.id).count()

    experiments = (
        db.query(Experiment)
        .filter(Experiment.owner_id == current_user.id)
        .order_by(Experiment.created_at.desc())
        .all()
    )
    experiment_count = len(experiments)
    running_count = sum(1 for e in experiments if e.status == ExperimentStatus.running)

    model_versions = [mv for e in experiments for mv in e.model_versions]
    deployed_models = [mv for mv in model_versions if mv.is_deployed]

    drift_alerts = (
        db.query(DriftReport)
        .join(ModelVersion)
        .join(Experiment)
        .filter(Experiment.owner_id == current_user.id, DriftReport.is_drifted.is_(True))
        .order_by(DriftReport.created_at.desc())
        .limit(5)
        .all()
    )

    recent_experiments = experiments[:5]

    return {
        "dataset_count": dataset_count,
        "experiment_count": experiment_count,
        "running_experiment_count": running_count,
        "model_version_count": len(model_versions),
        "deployed_model_count": len(deployed_models),
        "recent_experiments": [
            {
                "id": e.id,
                "name": e.name,
                "status": e.status,
                "task_type": e.task_type,
                "created_at": e.created_at,
                "model_version_count": len(e.model_versions),
            }
            for e in recent_experiments
        ],
        "recent_drift_alerts": [
            {
                "id": r.id,
                "model_version_id": r.model_version_id,
                "algorithm": r.model_version.algorithm,
                "experiment_name": r.model_version.experiment.name,
                "overall_drift_score": r.overall_drift_score,
                "created_at": r.created_at,
            }
            for r in drift_alerts
        ],
    }
