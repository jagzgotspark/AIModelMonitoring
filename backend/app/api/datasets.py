import os
import uuid

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.ml.preprocessing import infer_task_type, profile_columns
from app.models.models import Dataset, User
from app.schemas.schemas import DatasetOut, DatasetTargetUpdate

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.post("/upload", response_model=DatasetOut)
async def upload_dataset(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported")

    user_dir = os.path.join(settings.storage_dir, current_user.id)
    os.makedirs(user_dir, exist_ok=True)
    file_id = str(uuid.uuid4())
    file_path = os.path.join(user_dir, f"{file_id}.csv")

    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)

    df = pd.read_csv(file_path)

    dataset = Dataset(
        owner_id=current_user.id,
        name=file.filename,
        file_path=file_path,
        n_rows=len(df),
        n_columns=len(df.columns),
        columns_meta=profile_columns(df),
    )
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return dataset


@router.get("", response_model=list[DatasetOut])
def list_datasets(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Dataset).filter(Dataset.owner_id == current_user.id).order_by(Dataset.created_at.desc()).all()


@router.get("/{dataset_id}", response_model=DatasetOut)
def get_dataset(dataset_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    dataset = _get_owned_dataset(dataset_id, db, current_user)
    return dataset


@router.put("/{dataset_id}/target", response_model=DatasetOut)
def set_target_column(
    dataset_id: str,
    payload: DatasetTargetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    dataset = _get_owned_dataset(dataset_id, db, current_user)
    df = pd.read_csv(dataset.file_path)
    if payload.target_column not in df.columns:
        raise HTTPException(status_code=400, detail="Target column not found in dataset")

    dataset.target_column = payload.target_column
    dataset.task_type = infer_task_type(df[payload.target_column])
    db.commit()
    db.refresh(dataset)
    return dataset


def _get_owned_dataset(dataset_id: str, db: Session, current_user: User) -> Dataset:
    dataset = (
        db.query(Dataset)
        .filter(Dataset.id == dataset_id, Dataset.owner_id == current_user.id)
        .first()
    )
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset
