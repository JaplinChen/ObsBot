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
        try {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        } catch {
          try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
        }
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

  /** Kill orphaned node.exe processes that have no parent (zombie cleanup) */
  private cleanOrphanProcesses(): number {
    try {
      const csv = execSync(
        'wmic process where "name=\'node.exe\'" get ProcessId,ParentProcessId /format:csv',
        { encoding: 'utf-8', timeout: 5_000 },
      );
      const myPid = process.pid;
      let killed = 0;

      for (const line of csv.split('\n')) {
        const parts = line.trim().split(',');
        if (parts.length < 3) continue;
        const parentPid = Number(parts[1]);
        const pid = Number(parts[2]);
        if (!pid || pid === myPid) continue;

        // Check if parent is dead → orphan
        if (parentPid && !this.isProcessAlive(parentPid)) {
          logger.info('guardian', 'killing orphan node process', { pid, parentPid });
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
            killed++;
          } catch { /* ignore */ }
        }
      }

      if (killed > 0) {
        logger.info('guardian', `cleaned ${killed} orphan process(es)`);
      }
      return killed;
    } catch {
      return 0;
    }
  }

  /** Call Telegram logOut API to release polling lock, then wait for cooldown */
  private async autoLogout(): Promise<boolean> {
    if (this.logoutAttempted) return false;
    this.logoutAttempted = true;

    logger.info('guardian', '409 retries exhausted → attempting logOut + cooldown');

    try {
      await this.bot.telegram.callApi('logOut', {});
      logger.info('guardian', 'logOut succeeded, waiting for cooldown', {
        cooldownSeconds: LOGOUT_COOLDOWN_MS / 1000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // logOut may fail if already logged out, that's ok
      logger.warn('guardian', 'logOut call failed (may be already logged out)', { error: msg });
    }

    await this.sleep(LOGOUT_COOLDOWN_MS);
    return true;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private is409(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('409') || msg.includes('Conflict');
  }

  private attempt(): void {
    this.bot.launch({ dropPendingUpdates: true })
      .then(() => {
        logger.info('guardian', '✅ bot launched', { pid: process.pid });
      })
      .catch(async (err: unknown) => {
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

        // Stage 2: logOut + cooldown + reset retries for one more round
        const loggedOut = await this.autoLogout();
        if (loggedOut) {
          this.retries = 0;
          logger.info('guardian', 'retrying after logOut cooldown');
          this.attempt();
          return;
        }

        // Stage 3: all recovery exhausted
        logger.error('guardian', 'all recovery strategies exhausted; exiting');
        this.clearPid();
        process.exit(1);
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
