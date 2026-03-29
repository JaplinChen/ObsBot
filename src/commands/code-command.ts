/**
 * /code — Remote code trigger via Telegram.
 * Executes predefined safe commands on the dev machine.
 * Security: strict whitelist + execFile (no shell injection).
 */
import type { Context } from 'telegraf';
import { Markup } from 'telegraf';
import type { AppConfig } from '../utils/config.js';
import { execFile } from 'node:child_process';
import { logger } from '../core/logger.js';

interface CodeAction {
  description: string;
  command: string;
  args: string[];
  timeoutMs: number;
}

const ACTIONS: Record<string, CodeAction> = {
  health: {
    description: '系統健康檢查（uptime + memory）',
    command: 'node',
    args: ['-e', `
      const u = process.uptime();
      const m = process.memoryUsage();
      const fmt = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';
      console.log('Node uptime: ' + Math.floor(u / 3600) + 'h ' + Math.floor((u % 3600) / 60) + 'm');
      console.log('RSS: ' + fmt(m.rss));
      console.log('Heap: ' + fmt(m.heapUsed) + ' / ' + fmt(m.heapTotal));
    `.trim()],
    timeoutMs: 5_000,
  },
  status: {
    description: 'Git 狀態',
    command: 'git',
    args: ['status', '--short', '--branch'],
    timeoutMs: 10_000,
  },
  log: {
    description: '最近 5 筆 commit',
    command: 'git',
    args: ['log', '--oneline', '-5'],
    timeoutMs: 10_000,
  },
  test: {
    description: '執行測試',
    command: 'npx',
    args: ['tsc', '--noEmit'],
    timeoutMs: 60_000,
  },
  build: {
    description: '編譯檢查',
    command: 'npx',
    args: ['tsc', '--noEmit'],
    timeoutMs: 60_000,
  },
  disk: {
    description: '磁碟空間',
    command: 'df',
    args: ['-h', '.'],
    timeoutMs: 5_000,
  },
};

function executeAction(action: CodeAction): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      action.command,
      action.args,
      { timeout: action.timeoutMs, cwd: process.cwd(), maxBuffer: 1024 * 512 },
      (err, stdout, stderr) => {
        if (err && !stdout && !stderr) {
          reject(err);
        } else {
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
        }
      },
    );
  });
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n…（輸出已截斷）';
}

function buildActionList(): string {
  return Object.entries(ACTIONS)
    .map(([name, a]) => `  \`${name}\` — ${a.description}`)
    .join('\n');
}

/** Handle code:ACTION callback from InlineKeyboard */
export async function handleCodeAction(ctx: Context & { match: RegExpExecArray }): Promise<void> {
  const arg = ctx.match[1];
  await ctx.answerCbQuery().catch(() => {});
  const action = ACTIONS[arg];
  if (!action) return;
  await ctx.reply(`⏳ 執行中：${action.description}…`);
  try {
    const { stdout, stderr } = await executeAction(action);
    const output = (stdout + (stderr ? `\n--- stderr ---\n${stderr}` : '')).trim();
    const display = output || '（無輸出）';
    await ctx.reply(`✅ \`${arg}\` 完成\n\n\`\`\`\n${truncate(display, 3500)}\n\`\`\``, { parse_mode: 'Markdown' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('code', `action ${arg} failed`, err);
    await ctx.reply(`❌ \`${arg}\` 失敗：${truncate(msg, 500)}`);
  }
}

export async function handleCode(ctx: Context, _config: AppConfig): Promise<void> {
  const text = (ctx.message && 'text' in ctx.message ? ctx.message.text : '') ?? '';
  const arg = text.split(/\s+/).slice(1).join(' ').trim().toLowerCase();

  if (!arg) {
    const names = Object.keys(ACTIONS);
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    for (let i = 0; i < names.length; i += 2) {
      const row = [Markup.button.callback(`⚡ ${names[i]}`, `code:${names[i]}`)];
      if (i + 1 < names.length) row.push(Markup.button.callback(`⚡ ${names[i + 1]}`, `code:${names[i + 1]}`));
      rows.push(row);
    }
    await ctx.reply(`🔧 遠端指令\n\n${buildActionList()}`, Markup.inlineKeyboard(rows));
    return;
  }

  const action = ACTIONS[arg];
  if (!action) {
    await ctx.reply(`❌ 未知 action: \`${arg}\`\n\n可用：\n${buildActionList()}`);
    return;
  }

  await ctx.reply(`⏳ 執行中：${action.description}…`);

  try {
    const { stdout, stderr } = await executeAction(action);
    const output = (stdout + (stderr ? `\n--- stderr ---\n${stderr}` : '')).trim();
    const display = output || '（無輸出）';
    await ctx.reply(`✅ \`${arg}\` 完成\n\n\`\`\`\n${truncate(display, 3500)}\n\`\`\``, {
      parse_mode: 'Markdown',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('code', `action ${arg} failed`, err);
    await ctx.reply(`❌ \`${arg}\` 失敗：${truncate(msg, 500)}`);
  }
}
