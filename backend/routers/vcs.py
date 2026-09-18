from fastapi import APIRouter, Depends

from backend.deps import get_vcs
from backend.models import User
from backend.routers.auth import current_user
from core.vcs import VersionControlIntegration

router = APIRouter()


# Signed-in only: these read the *server's own* checkout, so unauthenticated
# they hand the working-tree diff of the deployment to anyone who asks.
@router.get("/status")
def vcs_status(
    vcs: VersionControlIntegration = Depends(get_vcs),
    user: User = Depends(current_user),
):
    return vcs.get_status()


@router.get("/diff")
def vcs_diff(
    vcs: VersionControlIntegration = Depends(get_vcs),
    user: User = Depends(current_user),
):
    return {"diff": vcs.get_diff()}
