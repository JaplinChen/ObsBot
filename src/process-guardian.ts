import { Telegraf } from 'telegraf';
import { execSync } from 'node:child_process';
import { logger } from './core/logger.js';
import { clearAllTimers } from './core/service-registry.js';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';

const PID_FILE = '.bot.pid';
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2_000;
const LOGOUT_COOLDOWN_MS = 15_000;

export class ProcessGuardian {
  private retries = 0;
  private logoutAttempted = false;

  constructor(
    private bot: Telegraf,
    private force = false,
  ) {}

  private writePid(): void {
    writeFileSync(PID_FILE, String(process.pid));
  }

  private clearPid(): void {
    try {
      if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
    } catch {
      /* ignore */
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  }

  /** Force-kill a process by PID */
  private killProcess(pid: number): void {
    try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
  }

  /** Force mode: kill existing bot process referenced in PID file */
  private forceKillExisting(): void {
    if (!existsSync(PID_FILE)) return;

    try {
      const pidText = readFileSync(PID_FILE, 'utf8').trim();
      if (!/^\d+$/.test(pidText)) {
        this.clearPid();
        return;
      }

      const pid = Number(pidText);
      if (pid === process.pid) return;

      if (this.isProcessAlive(pid)) {
        logger.info('guardian', 'force killing existing process', { pid });
        this.killProcess(pid);
      }
    } catch {
      /* ignore */
    }

    this.clearPid();
  }

  private clearStalePidIfDead(): void {
    if (!existsSync(PID_FILE)) return;

    try {
      const pidText = readFileSync(PID_FILE, 'utf8').trim();
      if (!/^\d+$/.test(pidText)) {
        logger.warn('guardian', 'invalid PID format in lockfile; clearing');
        this.clearPid();
        return;
      }

      const pid = Number(pidText);
      if (pid === process.pid) return;

      if (!this.isProcessAlive(pid)) {
        logger.info('guardian', 'removing stale lockfile', { pid });
        this.clearPid();
        return;
      }

      logger.warn('guardian', 'existing process detected; not force-killing', { pid });
    } catch {
      this.clearPid();
    }
  }

  /** Kill orphaned KnowPipe processes that have no parent (zombie cleanup).
   *  Scoped to KnowPipe-specific scripts only — never touches unrelated node processes. */
  private cleanOrphanProcesses(): number {
    try {
      const cwd = process.cwd();
      const raw = execSync('ps -eo pid,ppid,args', { encoding: 'utf-8', timeout: 5_000 });
      const myPid = process.pid;
      let killed = 0;

      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('PID')) continue;
        const m = trimmed.match(/^(\d+)\s+(\d+)\s+(.+)$/);
        if (!m) continue;
        const pid = Number(m[1]);
        const parentPid = Number(m[2]);
        const args = m[3];

        if (!pid || pid === myPid) continue;

        // Only target KnowPipe-related processes (same cwd or known script names)
        const isKnowPipeRelated =
          args.includes(cwd) ||
          args.includes('loop.mjs') ||
          args.includes('src/index.ts');
        if (!isKnowPipeRelated) continue;

        // Check if parent is dead → orphan
        if (parentPid && !this.isProcessAlive(parentPid)) {
          logger.info('guardian', 'killing orphan KnowPipe process', { pid, parentPid });
          this.killProcess(pid);
          killed++;
        }
      }

      if (killed > 0) {
        logger.info('guardian', `cleaned ${killed} orphan KnowPipe process(es)`);
      }
      return killed;
    } catch {
      return 0;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private is409(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('409') || msg.includes('Conflict');
  }

  /** Clear any stale Telegram session before launching */
  private async clearTelegramSession(): Promise<void> {
    try {
      await this.bot.telegram.callApi('deleteWebhook', { drop_pending_updates: true });
    } catch {
      // Ignore — best effort cleanup
    }
  }

  private async stopBot(): Promise<void> {
    try { await this.bot.stop(); } catch { /* ignore */ }
  }

  private attempt(): void {
    // Pre-launch: clear stale polling/webhook session on Telegram's side
    this.clearTelegramSession().then(() => {
    this.bot.launch(
      { dropPendingUpdates: true },
      () => { logger.info('guardian', '✅ bot launched', { pid: process.pid }); },
    ).catch(async (err: unknown) => {
        // Stop current bot session before any retry to avoid multiple concurrent polling sessions
        await this.stopBot();

        if (!this.is409(err)) {
          logger.error('guardian', 'fatal error', err);
          this.clearPid();
          process.exit(1);
        }

        // Stage 1: exponential backoff retries
        if (this.retries < MAX_RETRIES) {
          this.retries++;
          const delay = Math.min(BASE_DELAY_MS * 2 ** this.retries, 60_000);
          logger.error('guardian', `409 conflict retry ${this.retries}/${MAX_RETRIES}`, {
            delaySeconds: delay / 1000,
          });
          await this.sleep(delay);
          this.attempt();
          return;
        }

        // Stage 2: deleteWebhook + cooldown + reset retries for one more round
        if (!this.logoutAttempted) {
          this.logoutAttempted = true;
          logger.info('guardian', '409 retries exhausted → deleteWebhook + cooldown');
          await this.clearTelegramSession();
          await this.sleep(LOGOUT_COOLDOWN_MS);
          this.retries = 0;
          logger.info('guardian', 'retrying after cooldown');
          this.attempt();
          return;
        }

        // Stage 3: all recovery exhausted — exit code 2 signals loop to stop restarting
        logger.error('guardian', '409 持續衝突，所有恢復策略已耗盡。請確認是否有其他 Bot 實例在執行。');
        this.clearPid();
        process.exit(2);
      });
    });
  }

  launch(): void {
    // Clean orphan processes before anything else
    this.cleanOrphanProcesses();

    if (this.force) {
      this.forceKillExisting();
    } else {
      this.clearStalePidIfDead();
    }
    this.writePid();

    process.once('SIGINT', () => {
      clearAllTimers();
      this.clearPid();
      this.bot.stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      clearAllTimers();
      this.clearPid();
      this.bot.stop('SIGTERM');
    });

    logger.info('guardian', 'bot launching', { force: this.force, maxRetries: MAX_RETRIES });
    this.attempt();
  }
}
