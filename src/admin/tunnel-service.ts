import { spawn, spawnSync } from 'node:child_process';

const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const READY_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 5;
const RETRY_DELAYS_MS = [10_000, 20_000, 30_000, 60_000, 120_000];

export interface TunnelOptions {
  port: number;
  onUrl: (url: string) => void;
  onError?: (msg: string) => void;
}

export function startQuickTunnel(opts: TunnelOptions): () => void {
  const { port, onUrl, onError } = opts;

  const findCmd = process.platform === 'win32' ? 'where' : 'which';
  const whichResult = spawnSync(findCmd, ['cloudflared'], { encoding: 'utf-8' });
  const bin = whichResult.stdout.trim().split('\n')[0].trim();
  if (!bin) {
    const installHint = process.platform === 'darwin'
      ? 'brew install cloudflared'
      : process.platform === 'win32'
        ? 'winget install Cloudflare.cloudflared'
        : 'apt install cloudflared';
    onError?.(`cloudflared 未安裝，跳過 Quick Tunnel（${installHint}）`);
    return () => {};
  }

  // 殺掉同 port 的孤兒 cloudflared（防止多進程同時搶佔）
  spawnSync('pkill', ['-f', `cloudflared tunnel --url http://localhost:${port}`], { encoding: 'utf-8' });

  let stopped = false;
  let retryCount = 0;
  let currentChild: ReturnType<typeof spawn> | undefined;
  let retryTimerId: NodeJS.Timeout | undefined;

  function spawnTunnel(): void {
    if (stopped) return;

    const child = spawn(bin, ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    currentChild = child;

    let urlFound = false;
    let lastErrLine = '';
    let timeoutId: NodeJS.Timeout | undefined;

    function handleChunk(chunk: Buffer): void {
      const text = chunk.toString('utf-8');
      // 記錄最後一行非空錯誤訊息，供 exit handler 附上原因
      const errMatch = text.match(/ERR .+/);
      if (errMatch) lastErrLine = errMatch[0].slice(0, 80);
      if (urlFound) return;
      const match = TUNNEL_URL_RE.exec(text);
      if (match) {
        urlFound = true;
        retryCount = 0;
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        onUrl(match[0]);
      }
    }

    child.stdout?.on('data', handleChunk);
    child.stderr?.on('data', handleChunk);

    child.on('error', (err) => {
      onError?.(`cloudflared 啟動失敗：${err.message}`);
    });

    child.on('exit', (code, signal) => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (stopped || signal === 'SIGTERM' || signal === 'SIGKILL') return;

      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS_MS[retryCount] ?? 120_000;
        retryCount++;
        const detail = lastErrLine ? `\n${lastErrLine}` : '';
        const reason = urlFound
          ? `tunnel 斷線（code=${code ?? signal}），${delay / 1000}s 後重連（第 ${retryCount}/${MAX_RETRIES} 次）${detail}`
          : `cloudflared 意外退出（code=${code ?? signal}），${delay / 1000}s 後重試（第 ${retryCount}/${MAX_RETRIES} 次）${detail}`;
        onError?.(reason);
        retryTimerId = setTimeout(spawnTunnel, delay);
      } else {
        onError?.(`cloudflared 已重試 ${MAX_RETRIES} 次仍失敗，停止自動重連`);
      }
    });

    // 超時未拿到 URL 時提示（不終止，讓 exit handler 處理重試）
    timeoutId = setTimeout(() => {
      if (!urlFound) {
        onError?.(`cloudflared 啟動超時（${READY_TIMEOUT_MS / 1000}s），未取得 Tunnel URL`);
      }
    }, READY_TIMEOUT_MS);
  }

  spawnTunnel();

  const cleanup = (): void => {
    stopped = true;
    if (retryTimerId !== undefined) clearTimeout(retryTimerId);
    const child = currentChild;
    if (child && !child.killed) {
      child.kill('SIGTERM');
      // SIGKILL fallback：若 3 秒後仍未退出則強制終止
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 3_000);
    }
    process.off('exit', cleanup);
    process.off('SIGINT', cleanup);
    process.off('SIGTERM', cleanup);
  };

  process.on('exit', cleanup);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return cleanup;
}
