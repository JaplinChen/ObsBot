/**
 * One-command bot restart: kill → wait → compile → start --force
 * Usage: npx tsx scripts/restart-bot.ts [--skip-wait]
 */
import { execSync, spawn } from 'node:child_process';

const WAIT_SECONDS = 30;
const skipWait = process.argv.includes('--skip-wait');

function log(msg: string): void {
  const ts = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

function killAllNode(): number {
  try {
    const list = execSync('tasklist /FI "IMAGENAME eq node.exe" /FO CSV', {
      encoding: 'utf-8',
    });
    // Count node processes (excluding header and current process)
    const lines = list.split('\n').filter((l) => l.includes('node.exe'));
    if (lines.length === 0) return 0;

    execSync('taskkill /F /IM node.exe', { stdio: 'ignore' });
    return lines.length;
  } catch {
    return 0;
  }
}

function cleanLockfiles(): void {
  const files = ['.bot.pid', '.bot.lock', 'bot.pid'];
  for (const f of files) {
    try {
      execSync(`del /q "${f}"`, { stdio: 'ignore', cwd: process.cwd() });
    } catch {
      /* ignore */
    }
  }
}

function compileCheck(): boolean {
  try {
    execSync('npx tsc --noEmit', { stdio: 'pipe' });
    return true;
  } catch (err) {
    const output = (err as { stdout?: Buffer }).stdout?.toString() ?? '';
    console.error(output);
    return false;
  }
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = seconds;
    const interval = setInterval(() => {
      process.stdout.write(`\r⏳ 等待 Telegram 連線釋放... ${remaining}s `);
      remaining--;
      if (remaining < 0) {
        clearInterval(interval);
        process.stdout.write('\r✅ 等待完成                           \n');
        resolve();
      }
    }, 1000);
  });
}

async function main(): Promise<void> {
  log('🔄 GetThreads 重啟開始');

  // Step 1: Kill
  const killed = killAllNode();
  cleanLockfiles();
  log(`🗑️  清除 ${killed} 個 node 進程 + lockfiles`);

  // Step 2: Wait for Telegram to release polling connection
  if (killed > 0 && !skipWait) {
    await sleep(WAIT_SECONDS);
  } else {
    log('⏭️  無需等待（無舊進程）');
  }

  // Step 3: Compile check
  log('🔨 TypeScript 編譯檢查...');
  if (!compileCheck()) {
    log('❌ 編譯失敗，中止重啟');
    process.exit(1);
  }
  log('✅ 編譯通過');

  // Step 4: Start bot with --force
  log('🚀 啟動 Bot (--force)...');
  const child = spawn('npx', ['tsx', 'src/index.ts', '--force'], {
    stdio: 'inherit',
    shell: true,
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      log(`❌ Bot 異常退出 (code: ${code})`);
    }
    process.exit(code ?? 1);
  });
}

main().catch((err) => {
  console.error('重啟失敗:', err);
  process.exit(1);
});
