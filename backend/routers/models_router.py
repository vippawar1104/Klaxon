from fastapi import APIRouter, Depends

from backend.deps import get_ai_router
from backend.models import User
from backend.routers.auth import current_user
from core.ai_router import AIModelRouter

router = APIRouter()


@router.get("")
def list_models(
    ai_router: AIModelRouter = Depends(get_ai_router),
    user: User = Depends(current_user),
):
    """Which AI providers are configured, for the triage layer.

    Signed-in only: it names the environment variables this deployment reads
    and which are populated, which is infrastructure detail rather than
    something an anonymous caller needs.
    """
    return {
        "models": [
            {
                "id": provider.value,
                "provider": provider.name,
                "available": bool(config.get("api_key")),
                "api_key_env": config.get("api_key_env", f"{provider.name}_API_KEY"),
            }
            for provider, config in ai_router.providers.items()
        ]
    }
