#!/usr/bin/env node
/**
 * Cross-platform auto-restart loop for ObsBot.
 * Restarts the bot on exit (code 0 = restart, code 1 = crash recovery).
 * Usage: node scripts/loop.mjs [--dev]
 *
 * Inspired by Leo's Claude Code Channels while-loop pattern.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const isDev = process.argv.includes('--dev');
const RESTART_DELAY_MS = 3_000;
const CRASH_DELAY_MS = 10_000;
const LOOP_PID_FILE = join(ROOT, '.loop.pid');

// 寫入 PID 檔，讓 /launch 可以精確 kill 此進程
writeFileSync(LOOP_PID_FILE, String(process.pid), 'utf-8');

let running = true;
let currentChild = null;

function stopLoop(signal) {
  running = false;
  console.log(`\n[loop] 收到 ${signal}，停止重啟`);
  if (currentChild) {
    try { currentChild.kill('SIGTERM'); } catch {}
  }
  // 清除 PID 檔
  try { unlinkSync(LOOP_PID_FILE); } catch {}
  // 強制退出，避免殭屍 loop 殘留
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', () => stopLoop('SIGINT'));
process.on('SIGTERM', () => stopLoop('SIGTERM'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp() {
  return new Date().toLocaleTimeString('zh-TW', { hour12: false });
}

async function run() {
  let consecutiveCrashes = 0;

  while (running) {
    console.log(`[loop] ${timestamp()} 啟動 Bot${isDev ? ' (dev mode)' : ''}…`);

    const args = isDev
      ? ['tsx', 'src/index.ts', '--force']
      : ['node', 'dist/index.js', '--force'];

    const child = spawn('npx', args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, LOOP_WRAPPER: '1' },
    });

    currentChild = child;
    const code = await new Promise((resolve) => {
      child.on('exit', (c) => resolve(c ?? 1));
      child.on('error', () => resolve(1));
    });
    currentChild = null;

    if (!running) break;

    if (code === 0) {
      // Graceful exit (e.g. /restart command)
      consecutiveCrashes = 0;
      console.log(`[loop] ${timestamp()} Bot 正常退出，${RESTART_DELAY_MS / 1000}s 後重啟…`);
      await sleep(RESTART_DELAY_MS);
    } else if (code === 2) {
      // Permanent 409 conflict — another instance is running, stop loop to avoid spam
      console.log(`[loop] ${timestamp()} ⛔ Bot 409 持續衝突 (code=2)，停止重啟。請手動確認是否有其他 Bot 實例在執行。`);
      running = false;
      break;
    } else {
      // Crash
      consecutiveCrashes++;
      const delay = Math.min(CRASH_DELAY_MS * consecutiveCrashes, 60_000);
      console.log(`[loop] ${timestamp()} Bot 異常退出 (code=${code})，${delay / 1000}s 後重啟… (連續第 ${consecutiveCrashes} 次)`);
      await sleep(delay);
    }
  }

  console.log(`[loop] ${timestamp()} 結束`);
}

run();
