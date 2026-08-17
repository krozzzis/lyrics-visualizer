#!/usr/bin/env bash
# One-time setup: activates scripts/pre-commit as this clone's
# .git/hooks/pre-commit (git doesn't version-control hooks itself, so
# they can't take effect just by being committed to the repo).
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
ln -sf ../../scripts/pre-commit "$repo_root/.git/hooks/pre-commit"
echo "Installed pre-commit hook -> scripts/pre-commit"
