#!/bin/bash
set -euo pipefail

# Ensure we are in a git repository
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Error: not a git repository" >&2
  exit 1
fi

# --- Skills & Commands (ローカルのみ、git管理外) ---
SKILLS_DIST_URL="https://REDACTED_HOST/claude-skills/claude-skills-personal-dist.git"
TMP_DIR=$(mktemp -d)

# 旧構造（subtreeで追跡されたskills）があれば解除
if git ls-files ".claude/skills" 2>/dev/null | grep -q .; then
  echo "Removing old tracked skills (migrating to local-only)..."
  git rm -r .claude/skills
  git commit -m "Remove tracked skills (now local-only, gitignored)"
fi

echo "Fetching skills and commands ..."
git clone --depth 1 "$SKILLS_DIST_URL" "$TMP_DIR"

mkdir -p .claude/skills .claude/commands

# skills
if [ -d "$TMP_DIR/skills" ]; then
  rm -rf .claude/skills/*
  cp -r "$TMP_DIR/skills/"* .claude/skills/
fi

# commands
if [ -d "$TMP_DIR/commands" ]; then
  rm -rf .claude/commands/*
  cp -r "$TMP_DIR/commands/"* .claude/commands/
fi

rm -rf "$TMP_DIR"
echo "Skills and commands updated (local only)."

# --- Workflows (git subtree で追跡) ---
REMOTE_NAME="actions-dist"
REMOTE_URL="https://REDACTED_HOST/mygitea-actions/actions-dist.git"
PREFIX=".gitea/workflows"
BRANCH="main"

if ! git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  echo "Adding remote: $REMOTE_NAME"
  git remote add "$REMOTE_NAME" "$REMOTE_URL"
fi

if [ -d "$PREFIX" ] && git ls-files --error-unmatch "$PREFIX" >/dev/null 2>&1; then
  echo "Updating subtree: $PREFIX"
  git subtree pull --prefix="$PREFIX" "$REMOTE_NAME" "$BRANCH" --squash -m "Update $PREFIX from $REMOTE_NAME"
else
  echo "Adding subtree: $PREFIX"
  git subtree add --prefix="$PREFIX" "$REMOTE_NAME" "$BRANCH" --squash
fi

echo "Done."
