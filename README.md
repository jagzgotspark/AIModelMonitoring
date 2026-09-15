# AI Model Monitoring & Explainability Platform

Upload a dataset, train and compare multiple ML models, explain predictions with SHAP,
deploy the best model, and monitor it for data drift over time.

## Stack

- **Backend**: FastAPI, SQLAlchemy, PostgreSQL, scikit-learn, XGBoost, SHAP
- **Frontend**: React (Vite), React Router, Recharts
- **Auth**: JWT (OAuth2 password flow)
- **Deployment**: Docker Compose

## Running locally

```bash
docker-compose up --build
```

- Frontend: http://localhost:5173
- Backend API docs: http://localhost:8000/docs
- Postgres: localhost:5432 (user/pass: `postgres`/`postgres`)

## Workflow

1. Register / log in.
2. Upload a CSV dataset.
3. Set the target column (task type — classification or regression — is inferred automatically).
4. Create an experiment: pick algorithms (Random Forest, XGBoost) and optionally enable
   hyperparameter tuning (RandomizedSearchCV). Training runs in the background.
5. Compare model versions by metrics (accuracy/F1/AUC or RMSE/MAE/R²), deploy the best one,
   and view SHAP feature importance for its predictions.
6. On the Drift page, upload a new batch of incoming data (CSV) for a model version. The
   platform runs PSI + KS-test per feature against the training distribution and flags an
   alert when retraining is recommended.

## Project layout

```
backend/
  app/
    api/        # FastAPI routers (auth, datasets, experiments, drift)
    core/       # config, security (JWT/password hashing)
    db/         # SQLAlchemy session/engine
    ml/         # preprocessing, training, explainability (SHAP), drift detection
    models/     # SQLAlchemy ORM models
    schemas/    # Pydantic request/response schemas
frontend/
  src/
    api/        # axios client
    context/    # auth context
    pages/      # Datasets, Experiments, Experiment detail, Drift dashboard
```

## Stretch goals not yet implemented

- LightGBM and Neural Network (PyTorch) algorithms
- Celery-based background task queue (currently uses FastAPI `BackgroundTasks`)
- Alembic migrations (tables are created automatically on backend startup)
- Email/webhook alerting on drift detection
