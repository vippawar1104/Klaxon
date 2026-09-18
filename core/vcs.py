import subprocess
from dataclasses import dataclass
from typing import Dict, List


@dataclass
class GitCommit:
    hash: str
    message: str


class VersionControlIntegration:
    """Git operations backed by the system `git` CLI."""

    def __init__(self, repo_path: str = ".", ai_router=None):
        self.repo_path = repo_path
        self.ai_router = ai_router

    def _run_git(self, *args: str) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=self.repo_path,
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
        return result.stdout

    def get_status(self) -> Dict[str, List[str]]:
        """Parse `git status --porcelain` into staged/modified/untracked file lists."""
        try:
            output = self._run_git("status", "--porcelain")
        except (RuntimeError, FileNotFoundError):
            return {"modified": [], "staged": [], "untracked": []}

        staged: List[str] = []
        modified: List[str] = []
        untracked: List[str] = []

        for line in output.splitlines():
            if not line:
                continue
            index_status, worktree_status, path = line[0], line[1], line[3:]
            if index_status == "?" and worktree_status == "?":
                untracked.append(path)
                continue
            if index_status not in (" ", "?"):
                staged.append(path)
            if worktree_status not in (" ", "?"):
                modified.append(path)

        return {"modified": modified, "staged": staged, "untracked": untracked}

    def get_diff(self, staged: bool = False) -> str:
        """Return the unified diff for staged or unstaged changes."""
        args = ["diff", "--staged"] if staged else ["diff"]
        try:
            return self._run_git(*args)
        except (RuntimeError, FileNotFoundError):
            return ""

    def generate_commit_message(self) -> str:
        """Commit message from the current diff, falling back to a heuristic
        whenever the model is unavailable."""
        diff = self.get_diff(staged=True) or self.get_diff(staged=False)
        if not diff.strip():
            return "chore: no changes detected"

        if self.ai_router is None:
            return self._heuristic_commit_message()

        prompt = (
            "Write a single concise git commit message (Conventional Commits style, "
            "one line, no surrounding quotes) for the following diff:\n\n" + diff[:6000]
        )

        try:
            message = self.ai_router.complete(prompt, max_tokens=120).strip()
        except Exception:
            return self._heuristic_commit_message()

        return message.strip('"').splitlines()[0] if message else self._heuristic_commit_message()

    def _heuristic_commit_message(self) -> str:
        status = self.get_status()
        changed = status["staged"] or (status["modified"] + status["untracked"])
        count = len(changed)
        return f"chore: update {count} file{'s' if count != 1 else ''}"
