import logging

from pydantic import model_validator
from pydantic_settings import BaseSettings

DEFAULT_SECRET_KEY = "change-me-in-production"

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    project_name: str = "AI Model Monitoring & Explainability Platform"
    environment: str = "development"  # development | production
    database_url: str = "postgresql://postgres:postgres@db:5432/ai_monitoring"
    secret_key: str = DEFAULT_SECRET_KEY
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    storage_dir: str = "/app/storage"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]

    class Config:
        env_file = ".env"

    @model_validator(mode="after")
    def check_secret_key(self):
        # Anyone who knows the signing key can forge login tokens for any user.
        insecure = self.secret_key == DEFAULT_SECRET_KEY or len(self.secret_key) < 32
        if insecure and self.environment == "production":
            raise ValueError(
                "SECRET_KEY must be set to a random value of at least 32 characters in production "
                '(e.g. python -c "import secrets; print(secrets.token_urlsafe(48))")'
            )
        if insecure:
            logger.warning("SECRET_KEY is the insecure default; set a random value before deploying.")
        return self


settings = Settings()
