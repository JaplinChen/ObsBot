#!/bin/bash
# worktree commit 後自動同步到主目錄並重啟 KnowPipe
# 觸發：.git/hooks/post-commit

WORK_DIR=$(git rev-parse --show-toplevel 2>/dev/null)
MAIN_DIR="/Users/japlin/Works/KnowPipe"

# 只在 worktree 中執行（路徑含 /.claude/worktrees/）
[[ "$WORK_DIR" == *"/.claude/worktrees/"* ]] || exit 0

# 取得此 commit 修改或新增的檔案（排除刪除）
CHANGED=$(git diff HEAD~1 HEAD --name-only --diff-filter=ACM 2>/dev/null)
[ -n "$CHANGED" ] || exit 0

echo ""
echo "╔══════════════════════════════════════╗"
echo "║  [worktree-sync] 同步到主目錄        ║"
echo "╚══════════════════════════════════════╝"

# 複製修改的檔案
while IFS= read -r file; do
  src="$WORK_DIR/$file"
  dst="$MAIN_DIR/$file"
  if [ -f "$src" ]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    echo "  ✓ $file"
  fi
done <<< "$CHANGED"

# 重啟 KnowPipe
echo ""
echo "  ↻ 重啟 KnowPipe..."
if [ -f "$MAIN_DIR/.loop.pid" ]; then
  kill "$(cat "$MAIN_DIR/.loop.pid")" 2>/dev/null && rm "$MAIN_DIR/.loop.pid"
fi
pkill -f "loop.mjs" 2>/dev/null
if [ -f "$MAIN_DIR/.bot.pid" ]; then
  kill "$(cat "$MAIN_DIR/.bot.pid")" 2>/dev/null && rm "$MAIN_DIR/.bot.pid"
fi
pkill -x "KnowPipe" 2>/dev/null
pkill -f "node.*src/index" 2>/dev/null
sleep 3

# 改用 dev:loop 啟動（有 supervisor 管理，確保穩定）
cd "$MAIN_DIR" && npm run dev:loop >> /tmp/knowpipe-launch.log 2>&1 &
echo "  ✓ KnowPipe 重啟完成（loop 模式，log: /tmp/knowpipe-launch.log）"
echo ""
