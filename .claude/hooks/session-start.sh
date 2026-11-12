#!/usr/bin/env bash
# Runs at the start of every Claude Code session in this repo.
# Commits in this project are made as the project owner, never as an assistant.
set -euo pipefail
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"
git config user.name "Nisaar"
git config user.email "120457154+eshygn@users.noreply.github.com"
git config commit.gpgsign false
echo "git identity: $(git config user.name) <$(git config user.email)>"
