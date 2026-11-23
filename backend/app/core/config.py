from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://careerpilot:careerpilot@localhost:5432/careerpilot"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3.5:4b"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
