import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.ml.drift import detect_drift
from app.models.models import DriftReport, Experiment, ModelVersion, User
from app.schemas.schemas import DriftCheckRequest, DriftReportOut

router = APIRouter(prefix="/api/drift", tags=["drift"])


@router.post("/{model_version_id}/check", response_model=DriftReportOut)
def check_drift(
    model_version_id: str,
    payload: DriftCheckRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    model_version = (
        db.query(ModelVersion)
        .join(Experiment)
        .filter(ModelVersion.id == model_version_id, Experiment.owner_id == current_user.id)
        .first()
    )
    if not model_version:
        raise HTTPException(status_code=404, detail="Model version not found")

    if not payload.records:
        raise HTTPException(status_code=400, detail="No records provided")

    experiment = model_version.experiment
    dataset = experiment.dataset
    reference_df = pd.read_csv(dataset.file_path)
    incoming_df = pd.DataFrame(payload.records)

    feature_columns = [c for c in reference_df.columns if c != dataset.target_column]
    result = detect_drift(reference_df, incoming_df, feature_columns)

    report = DriftReport(
        model_version_id=model_version.id,
        overall_drift_score=result["overall_drift_score"],
        is_drifted=result["is_drifted"],
        feature_drift=result["feature_drift"],
        n_samples=len(incoming_df),
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


@router.get("/{model_version_id}/reports", response_model=list[DriftReportOut])
def list_drift_reports(
    model_version_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    model_version = (
        db.query(ModelVersion)
        .join(Experiment)
        .filter(ModelVersion.id == model_version_id, Experiment.owner_id == current_user.id)
        .first()
    )
    if not model_version:
        raise HTTPException(status_code=404, detail="Model version not found")

    return (
        db.query(DriftReport)
        .filter(DriftReport.model_version_id == model_version_id)
        .order_by(DriftReport.created_at.desc())
        .all()
    )
