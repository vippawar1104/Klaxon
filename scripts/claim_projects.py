"""Assign ownerless projects to an account.

Projects created before ownership existed have owner_id NULL. Now that the
projects endpoint is scoped to the caller, those rows belong to nobody and are
invisible in every dashboard. init_db() adopts them automatically only when a
single account exists — with several registered there is no safe basis to
guess, so this script makes the choice explicit.

    python scripts/claim_projects.py you@example.com            # list, change nothing
    python scripts/claim_projects.py you@example.com --ids 1 2  # claim those
    python scripts/claim_projects.py you@example.com --all      # claim every ownerless
"""

import argparse
import sys

from sqlmodel import Session, select

sys.path.insert(0, __file__.rsplit("/scripts/", 1)[0])

from backend.db import engine, init_db  # noqa: E402
from backend.models import Project, User  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("email", help="account to assign the projects to")
    parser.add_argument("--ids", nargs="*", type=int, default=None, help="project ids to claim")
    parser.add_argument("--all", action="store_true", help="claim every ownerless project")
    args = parser.parse_args()

    init_db()
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == args.email.strip().lower())).first()
        if not user:
            print(f"No account for {args.email!r}.")
            return 1

        ownerless = session.exec(select(Project).where(Project.owner_id.is_(None))).all()
        if not ownerless:
            print("No ownerless projects.")
            return 0

        if args.ids is None and not args.all:
            print(f"Ownerless projects (none claimed — pass --ids or --all):\n")
            for p in ownerless:
                print(f"  {p.id:>3}  {p.name}")
            return 0

        wanted = ownerless if args.all else [p for p in ownerless if p.id in set(args.ids)]
        if not wanted:
            print("None of those ids are ownerless.")
            return 1

        for p in wanted:
            p.owner_id = user.id
            session.add(p)
        session.commit()

        print(f"Claimed for {user.email}:")
        for p in wanted:
            print(f"  {p.id:>3}  {p.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
