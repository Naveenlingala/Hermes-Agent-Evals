#!/usr/bin/env bash
# Quiet, token-free formatting hook. It only uses Prettier already installed in the repo.
# If jq or Prettier isn't installed, it safely becomes a no-op.
set -u

command -v jq >/dev/null 2>&1 || exit 0
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
INPUT="$(cat)"
FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null || true)"
[ -n "$FILE_PATH" ] || exit 0

case "$FILE_PATH" in
  "$PROJECT_ROOT"/*) ;;
  *) exit 0 ;;
esac

case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.vue|*.json|*.css|*.scss|*.md|*.mdx|*.yaml|*.yml|*.html)
    ;;
  *) exit 0 ;;
esac

# Find the nearest installed Prettier, allowing common monorepo layouts.
DIR="$(dirname "$FILE_PATH")"
PRETTIER=""
while [ "$DIR" = "$PROJECT_ROOT" ] || [[ "$DIR" == "$PROJECT_ROOT"/* ]]; do
  if [ -x "$DIR/node_modules/.bin/prettier" ]; then
    PRETTIER="$DIR/node_modules/.bin/prettier"
    break
  fi
  [ "$DIR" = "$PROJECT_ROOT" ] && break
  PARENT="$(dirname "$DIR")"
  [ "$PARENT" = "$DIR" ] && break
  DIR="$PARENT"
done
[ -n "$PRETTIER" ] || exit 0

# Formatting must never block edits; report failures through normal lint/test commands instead.
"$PRETTIER" --write --log-level error "$FILE_PATH" >/dev/null 2>&1 || true
exit 0
