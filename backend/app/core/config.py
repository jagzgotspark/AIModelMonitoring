from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    project_name: str = "AI Model Monitoring & Explainability Platform"
    database_url: str = "postgresql://postgres:postgres@db:5432/ai_monitoring"
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    storage_dir: str = "/app/storage"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    class Config:
        env_file = ".env"


settings = Settings()
