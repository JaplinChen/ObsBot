#!/bin/bash
# ObsBot 啟動腳本（macOS）
# 用法：雙擊或在終端機執行 ./啟動.sh
# 加上 --loop 參數可自動重啟：./啟動.sh --loop

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "❌ 找不到 .env 檔案，請先執行："
  echo "   cp .env.example .env"
  echo "   然後填入 BOT_TOKEN 和 VAULT_PATH"
  exit 1
fi

if [ "$1" = "--loop" ]; then
  echo "🔄 啟動 Bot（自動重啟模式）..."
  npm run dev:loop
else
  echo "🚀 啟動 Bot..."
  npm run dev
fi
