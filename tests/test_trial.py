from datetime import datetime, timedelta, timezone

from core import billing


class FakeUser:
    """Just the two fields is_expired reads — avoids a DB round trip for
    what is otherwise pure logic."""

    def __init__(self, plan="free", trial_ends_at=None):
        self.plan = plan
        self.trial_ends_at = trial_ends_at


def ago(days):
    return datetime.now(timezone.utc) - timedelta(days=days)


def hence(days):
    return datetime.now(timezone.utc) + timedelta(days=days)


class TestIsExpired:
    def test_a_fresh_signup_is_not_expired(self):
        user = FakeUser(trial_ends_at=billing.start_trial())
        assert not billing.is_expired(user)

    def test_a_free_account_past_its_trial_is_expired(self):
        user = FakeUser(plan="free", trial_ends_at=ago(1))
        assert billing.is_expired(user)

    def test_a_free_account_still_within_its_trial_is_not_expired(self):
        user = FakeUser(plan="free", trial_ends_at=hence(1))
        assert not billing.is_expired(user)

    def test_null_trial_ends_at_never_expires(self):
        """The backfill semantics for every account that predates this
        feature — and the lever an operator uses to comp an account by
        clearing the column directly in the database."""
        user = FakeUser(plan="free", trial_ends_at=None)
        assert not billing.is_expired(user)

    def test_a_paying_account_never_expires_even_with_a_past_trial_date(self):
        """plan == 'pro' wins regardless of trial_ends_at — Stripe, via the
        webhook, is the only thing that revokes it."""
        user = FakeUser(plan="pro", trial_ends_at=ago(365))
        assert not billing.is_expired(user)

    def test_naive_trial_ends_at_is_handled(self):
        """SQLite hands back naive datetimes on read; the comparison must
        not TypeError on aware-vs-naive."""
        naive_past = ago(1).replace(tzinfo=None)
        assert billing.is_expired(FakeUser(plan="free", trial_ends_at=naive_past))

    def test_start_trial_is_fourteen_days_out(self):
        delta = billing.start_trial() - datetime.now(timezone.utc)
        assert timedelta(days=13, hours=23) < delta <= timedelta(days=14)
