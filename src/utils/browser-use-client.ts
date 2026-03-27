/**
 * Browser Use CLI client — wraps `browser-use` commands via execFileAsync.
 * Pattern matches existing yt-dlp / ffmpeg CLI integration style.
 * Each client instance uses a named session for isolation.
 *
 * CLI reference (verified against browser-use 0.12.x):
 *   open <url>         — navigate
 *   get text <idx>     — element text by index
 *   get html           — full page HTML (no arg)
 *   get title          — page title
 *   state              — interactive element list
 *   eval <js>          — execute JavaScript
 *   click <idx>        — click element
 *   screenshot [path]  — capture screenshot
 *   cookies import/export <file>
 *   close              — close session
 *
 * Requires: --headed for visible browser, --profile <name> for Chrome profile
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { homedir } from 'node:os';

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT = 30_000;
const MAX_BUFFER = 5 * 1024 * 1024;

/** Resolved path to the browser-use binary inside the venv */
const BROWSER_USE_BIN = join(homedir(), '.browser-use-env', 'bin', 'browser-use');

/** Parsed element from `browser-use state` output */
export interface BrowserElement {
  index: number;
  tag: string;
  text: string;
}

export class BrowserUseClient {
  private readonly session: string;
  private readonly headed: boolean;

  constructor(session = 'obsbot', headed = false) {
    this.session = session;
    this.headed = headed;
  }

  /** Check if browser-use CLI is installed */
  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(BROWSER_USE_BIN, ['doctor'], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Navigate to a URL */
  async open(url: string): Promise<string> {
    return this.exec(['open', url]);
  }

  /** Get page text via JavaScript eval (browser-use has no bare `text` command) */
  async text(): Promise<string> {
    const raw = await this.exec(['eval', 'document.body?.innerText ?? ""']);
    // Output format: "result: <text>"
    return raw.replace(/^result:\s*/i, '').trim();
  }

  /** Get full page HTML via `get html` */
  async html(): Promise<string> {
    const raw = await this.exec(['get', 'html'], 15_000);
    // Output format: "html: <content>"
    return raw.replace(/^html:\s*/i, '');
  }

  /** Get page title */
  async title(): Promise<string> {
    const raw = await this.exec(['get', 'title']);
    return raw.replace(/^title:\s*/i, '').trim();
  }

  /** Get interactive elements on the page (index + tag + text) */
  async state(): Promise<BrowserElement[]> {
    const raw = await this.exec(['state']);
    return this.parseState(raw);
  }

  /** Take a screenshot */
  async screenshot(outputPath?: string): Promise<string> {
    const args = outputPath ? ['screenshot', outputPath] : ['screenshot'];
    return this.exec(args);
  }

  /** Click an element by its index from `state()` */
  async click(index: number): Promise<string> {
    return this.exec(['click', String(index)]);
  }

  /** Type text into an element by index */
  async type(index: number, value: string): Promise<string> {
    return this.exec(['input', String(index), value]);
  }

  /** Scroll the page */
  async scroll(direction: 'up' | 'down', amount = 3): Promise<string> {
    return this.exec(['scroll', direction, String(amount)]);
  }

  /** Get current page URL via eval */
  async url(): Promise<string> {
    const raw = await this.exec(['eval', 'window.location.href']);
    return raw.replace(/^result:\s*/i, '').trim();
  }

  /** Execute arbitrary JavaScript in the page context */
  async evaluate(script: string): Promise<string> {
    const raw = await this.exec(['eval', script]);
    return raw.replace(/^result:\s*/i, '').trim();
  }

  /** Import cookies from a JSON file */
  async importCookies(filePath: string): Promise<string> {
    return this.exec(['cookies', 'import', filePath]);
  }

  /** Export cookies to a JSON file */
  async exportCookies(filePath: string): Promise<string> {
    return this.exec(['cookies', 'export', filePath]);
  }

  /** Close the browser session */
  async close(): Promise<void> {
    try {
      await this.exec(['close'], 5_000);
    } catch {
      // Ignore close errors — daemon may already be stopped
    }
  }

  // ── Internal ──────────────────────────────────────────────

  private async exec(args: string[], timeout = DEFAULT_TIMEOUT): Promise<string> {
    const baseArgs = ['--session', this.session];
    if (this.headed) baseArgs.push('--headed');

    try {
      const { stdout } = await execFileAsync(
        BROWSER_USE_BIN,
        [...baseArgs, ...args],
        { timeout, maxBuffer: MAX_BUFFER },
      );
      return stdout;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ENOENT') || msg.includes('not found')) {
        throw new Error(
          'browser-use CLI 未安裝。請執行：curl -fsSL https://browser-use.com/cli/install.sh | bash',
        );
      }
      throw err;
    }
  }

  /** Parse `browser-use state` output into structured elements */
  private parseState(raw: string): BrowserElement[] {
    const elements: BrowserElement[] = [];
    // Format: "[index]<tag attr=val /> text"
    const lines = raw.split('\n').filter(Boolean);
    for (const line of lines) {
      const m = line.match(/^\[(\d+)]<(\w+)\b[^/]*\/?>?\s*(.*)/);
      if (m) {
        elements.push({
          index: parseInt(m[1], 10),
          tag: m[2],
          text: m[3].trim(),
        });
      }
    }
    return elements;
  }
}

/** Shared singleton — use `obsbot` session by default */
export const browserUseClient = new BrowserUseClient();
