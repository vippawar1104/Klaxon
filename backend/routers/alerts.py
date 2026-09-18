from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from backend.db import get_session
from backend.deps import owned_project, require_active_account
from backend.models import Alert, AlertRule, Issue, User
from backend.routers.auth import current_user
from backend.schemas import AlertRuleCreate
from core.urlguard import check_webhook_url

router = APIRouter()

VALID_KINDS = ("new_issue", "regression", "volume")
VALID_CHANNELS = ("console", "webhook")


@router.get("")
def list_alerts(
    project_id: int,
    limit: int = 50,
    session: Session = Depends(get_session),
    user: User = Depends(require_active_account),
):
    """Alerts that actually fired — the audit trail behind '1 alert sent'."""
    owned_project(session, user, project_id)

    alerts = session.exec(
        select(Alert)
        .where(Alert.project_id == project_id)
        .order_by(Alert.created_at.desc())  # type: ignore[attr-defined]
        .limit(limit)
    ).all()

    issues = {
        i.id: i
        for i in session.exec(
            select(Issue).where(Issue.id.in_([a.issue_id for a in alerts]))  # type: ignore[attr-defined]
        ).all()
    } if alerts else {}

    return [
        {
            "id": a.id,
            "issue_id": a.issue_id,
            "kind": a.kind,
            "reason": a.reason,
            "channel": a.channel,
            "delivered": a.delivered,
            "times_seen_at_fire": a.times_seen_at_fire,
            "created_at": a.created_at,
            "issue_type": issues[a.issue_id].type if a.issue_id in issues else None,
            "issue_culprit": issues[a.issue_id].culprit if a.issue_id in issues else None,
        }
        for a in alerts
    ]


@router.get("/rules")
def list_rules(
    project_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(require_active_account),
):
    owned_project(session, user, project_id)
    rules = session.exec(select(AlertRule).where(AlertRule.project_id == project_id)).all()
    return [
        {
            "id": r.id,
            "kind": r.kind,
            "threshold": r.threshold,
            "window_s": r.window_s,
            "cooldown_s": r.cooldown_s,
            "channel": r.channel,
            "target": r.target,
            "enabled": r.enabled,
        }
        for r in rules
    ]


@router.post("/rules", status_code=201)
def create_rule(
    project_id: int,
    body: AlertRuleCreate,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    # A webhook rule makes the server POST this project's crash data to a URL
    # the caller chooses, so creating one on a project you do not own is both a
    # data leak and an outbound-request primitive.
    owned_project(session, user, project_id)

    if body.kind not in VALID_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {VALID_KINDS}")
    if body.channel not in VALID_CHANNELS:
        raise HTTPException(status_code=400, detail=f"channel must be one of {VALID_CHANNELS}")
    if body.channel == "webhook" and not body.target:
        raise HTTPException(status_code=400, detail="webhook channel requires a target URL")
    if body.channel == "webhook":
        # Rejected here so the caller sees why, and again at delivery because
        # DNS can change underneath a rule that was acceptable when created.
        allowed, why = check_webhook_url(body.target or "")
        if not allowed:
            raise HTTPException(status_code=400, detail=why)

    rule = AlertRule(project_id=project_id, **body.model_dump())
    session.add(rule)
    session.commit()
    session.refresh(rule)
    return {"id": rule.id, "kind": rule.kind, "enabled": rule.enabled}


@router.post("/rules/{rule_id}/toggle")
def toggle_rule(
    rule_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(current_user),
):
    rule = session.get(AlertRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    try:
        owned_project(session, user, rule.project_id)
    except HTTPException:
        # Same 404 as an unknown rule: silently disabling someone else's paging
        # is the worst thing an unscoped mutation here could do.
        raise HTTPException(status_code=404, detail="Rule not found") from None
    rule.enabled = not rule.enabled
    session.add(rule)
    session.commit()
    return {"id": rule.id, "enabled": rule.enabled}
