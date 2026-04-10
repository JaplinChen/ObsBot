#!/bin/bash
# ObsBot 生產模式啟動腳本（macOS）
# 用法：./start.sh
#   --no-loop  單次執行，不自動重啟
#   --stop     停止所有 ObsBot 進程
# 開發模式請用 ./dev.sh

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
  pkill -f "ssh.*192.168.90.168.*3001" 2>/dev/null
  sleep 1
  echo "✅ 已停止"
  exit 0
fi

# 先清除舊進程，避免多個 loop.mjs 互相干擾（code=137 問題）
pkill -f "scripts/loop.mjs" 2>/dev/null
pkill -f "node.*src/index" 2>/dev/null
pkill -f "tsx.*src/index" 2>/dev/null
sleep 2

npm run build || { echo "❌ TypeScript 編譯失敗"; exit 1; }

# SSH Tunnel：將 192.168.110.169:3001 轉發到 192.168.90.168:3001（公司電腦存取用）
TUNNEL_TARGET="192.168.110.169"
TUNNEL_PORT="3001"
TUNNEL_BIND="192.168.90.168"

if lsof -ti TCP:${TUNNEL_PORT} -s TCP:LISTEN | grep -q .; then
  echo "🔗 Port ${TUNNEL_PORT} 已有監聽，跳過 SSH Tunnel 建立"
else
  echo "🔗 建立 SSH Tunnel：${TUNNEL_BIND}:${TUNNEL_PORT} → ${TUNNEL_TARGET}:${TUNNEL_PORT}"
  ssh -f -N -o StrictHostKeyChecking=no \
      -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=3 \
      -L "${TUNNEL_BIND}:${TUNNEL_PORT}:${TUNNEL_TARGET}:${TUNNEL_PORT}" \
      localhost 2>/dev/null && echo "✅ SSH Tunnel 已啟動" || echo "⚠️  SSH Tunnel 建立失敗（繼續啟動 Bot）"
fi

if [ "$1" = "--no-loop" ]; then
  echo "🚀 啟動 Bot（單次模式）..."
  NODE_ENV=production npm run start
else
  echo "🔄 啟動 Bot（自動重啟模式）..."
  echo "   關閉此視窗或按 Ctrl+C 停止"
  echo ""
  # caffeinate -i 防止 macOS 睡眠時終止進程
  NODE_ENV=production caffeinate -i node scripts/loop.mjs
fi
