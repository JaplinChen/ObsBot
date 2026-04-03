#!/bin/bash
# ObsBot 開發模式啟動腳本（macOS）
# 用法：./dev.sh
#   --no-loop  單次執行，不自動重啟
#   --stop     停止所有 ObsBot 進程
# 生產模式請用 ./start.sh

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "❌ 找不到 .env 檔案，請先執行："
  echo "   cp .env.example .env"
  echo "   然後填入 BOT_TOKEN 和 VAULT_PATH"
  read -p "按 Enter 關閉..."
  exit 1
fi

if [ "$1" = "--stop" ]; then
  echo "🛑 停止所有 ObsBot 進程..."
  pkill -f "scripts/loop.mjs" 2>/dev/null
  pkill -f "node.*src/index" 2>/dev/null
  pkill -f "tsx.*src/index" 2>/dev/null
  sleep 1
  echo "✅ 已停止"
  exit 0
fi

# 先清除舊進程，避免多個 loop.mjs 互相干擾
pkill -f "scripts/loop.mjs" 2>/dev/null
pkill -f "node.*src/index" 2>/dev/null
pkill -f "tsx.*src/index" 2>/dev/null
sleep 2

if [ "$1" = "--no-loop" ]; then
  echo "🚀 啟動 Bot（開發 · 單次模式）..."
  npm run dev
else
  echo "🔄 啟動 Bot（開發 · 自動重啟模式）..."
  echo "   關閉此視窗或按 Ctrl+C 停止"
  echo ""
  caffeinate -i npm run dev:loop
fi
