#!/bin/bash
set -euo pipefail

# Ensure we are in a git repository
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Error: not a git repository" >&2
  exit 1
fi

# --- Skills dist URL の取得 ---
SKILLS_REMOTE="skills-dist"
SKILLS_URL=$(git remote get-url "$SKILLS_REMOTE" 2>/dev/null || true)
if [ -z "$SKILLS_URL" ]; then
  read -p "Skills dist URL: " SKILLS_URL
  git remote add "$SKILLS_REMOTE" "$SKILLS_URL"
fi

# --- Actions dist URL の取得 ---
ACTIONS_REMOTE="actions-dist"
ACTIONS_URL=$(git remote get-url "$ACTIONS_REMOTE" 2>/dev/null || true)
if [ -z "$ACTIONS_URL" ]; then
  read -p "Actions dist URL: " ACTIONS_URL
  git remote add "$ACTIONS_REMOTE" "$ACTIONS_URL"
fi

# --- Skills & Commands (ローカルのみ、git管理外) ---
TMP_DIR=$(mktemp -d)

# 旧構造（subtreeで追跡されたskills）があれば解除
if git ls-files ".claude/skills" 2>/dev/null | grep -q .; then
  echo "Removing old tracked skills (migrating to local-only)..."
  git rm -r .claude/skills
  git commit -m "Remove tracked skills (now local-only, gitignored)"
fi

echo "Fetching skills and commands ..."
git clone --depth 1 "$SKILLS_URL" "$TMP_DIR"

mkdir -p .claude/skills .claude/commands

if [ -d "$TMP_DIR/skills" ]; then
  rm -rf .claude/skills/*
  cp -r "$TMP_DIR/skills/"* .claude/skills/
fi

if [ -d "$TMP_DIR/commands" ]; then
  rm -rf .claude/commands/*
  cp -r "$TMP_DIR/commands/"* .claude/commands/
fi

rm -rf "$TMP_DIR"
echo "Skills and commands updated (local only)."

# --- Workflows (git subtree で追跡) ---
if [ -d ".gitea/workflows" ] && git ls-files --error-unmatch ".gitea/workflows" >/dev/null 2>&1; then
  echo "Updating subtree: .gitea/workflows"
  if ! git subtree pull --prefix=".gitea/workflows" "$ACTIONS_REMOTE" main --squash -m "Update .gitea/workflows from $ACTIONS_REMOTE"; then
    echo "Subtree pull failed (conflict). Re-adding subtree..."
    git merge --abort 2>/dev/null || true
    git rm -r .gitea/workflows
    git commit -m "Remove workflows subtree for re-add"
    git subtree add --prefix=".gitea/workflows" "$ACTIONS_REMOTE" main --squash
  fi
else
  echo "Adding subtree: .gitea/workflows"
  git subtree add --prefix=".gitea/workflows" "$ACTIONS_REMOTE" main --squash
fi

echo "Done."
