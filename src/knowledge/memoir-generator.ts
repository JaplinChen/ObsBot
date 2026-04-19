/**
 * Memoir Generator — assembles an KnowPipe development history narrative.
 * Sources: git log + claude-mem handoff records + CLAUDE.md decision log.
 * Output: a narrative markdown note saved to Vault.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { saveReportToVault } from './report-saver.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { logger } from '../core/logger.js';

const execAsync = promisify(exec);

export interface MemoirResult {
  savedPath: string;
  commitCount: number;
  hasMemory: boolean;
}

async function getGitLog(since?: string): Promise<string> {
  const flag = since ? `--since="${since}"` : '--max-count=120';
  const { stdout } = await execAsync(
    `git -C "${process.cwd()}" log ${flag} --oneline --no-merges`,
    { timeout: 10_000 },
  ).catch(() => ({ stdout: '' }));
  return stdout.trim();
}

async function readMemoryContext(memoryDir: string): Promise<string> {
  const files = ['MEMORY.md', 'project_current.md', 'user_profile.md'];
  const parts: string[] = [];
  for (const f of files) {
    try {
      const content = await readFile(join(memoryDir, f), 'utf-8');
      parts.push(`### ${f}\n${content.slice(0, 800)}`);
    } catch { /* optional */ }
  }
  return parts.join('\n\n');
}

async function extractDecisionLog(projectRoot: string): Promise<string> {
  try {
    const raw = await readFile(join(projectRoot, 'CLAUDE.md'), 'utf-8');
    const m = raw.match(/## 決策日誌[\s\S]*?(?=\n## |\n# |$)/);
    return m?.[0]?.trim() ?? '';
  } catch {
    return '';
  }
}

export async function generateMemoir(
  vaultPath: string,
  since?: string,
): Promise<MemoirResult> {
  const today = new Date().toISOString().split('T')[0];
  // Claude Code project memory 路徑：將 cwd 轉換為 Claude 的 project-slug 格式
  // Mac: /Users/japlin/Works/KnowPipe → -Users-japlin-Works-KnowPipe
  // Win: D:\Works\KnowPipe → D--Works-KnowPipe
  const cwd = process.cwd();
  const projectSlug = cwd.replace(/^[A-Za-z]:/, m => m.replace(':', '')).replace(/[\\/]/g, '-');
  const claudeHome = process.env.CLAUDE_HOME
    ?? (process.platform === 'win32'
      ? join(process.env.USERPROFILE ?? homedir(), '.claude')
      : join(homedir(), '.claude'));
  const memoryDir = join(claudeHome, 'projects', projectSlug, 'memory');

  const [gitLog, memoryContext, decisionLog] = await Promise.all([
    getGitLog(since),
    readMemoryContext(memoryDir),
    extractDecisionLog(process.cwd()),
  ]);

  const commitLines = gitLog.split('\n').filter(Boolean);
  const commitCount = commitLines.length;

  const contextParts = [
    `## Git 提交記錄（${commitCount} 筆）\n${gitLog.slice(0, 3000)}`,
    memoryContext ? `## 記憶與專案脈絡\n${memoryContext.slice(0, 2000)}` : '',
    decisionLog ? `## 決策日誌\n${decisionLog.slice(0, 1500)}` : '',
  ].filter(Boolean).join('\n\n---\n\n');

  const prompt =
    `你是一位技術寫作者。以下是 KnowPipe 專案的開發記錄資料：\n\n${contextParts}\n\n` +
    `請用繁體中文，以「KnowPipe 開發史」為題，撰寫一份敘事式技術史文章。\n` +
    `格式：每個重要階段一個 ## 章節，包含決策背景、關鍵轉折、實作成果。\n` +
    `目標讀者：未來的自己，用來快速理解這段開發歷程的脈絡。長度：600-1000 字。`;

  const narrative = await runLocalLlmPrompt(prompt, {
    task: 'analyze',
    timeoutMs: 90_000,
    maxTokens: 1800,
  });

  const content = narrative ??
    `## 資料不足\n\nLLM 無回應，以下為原始 Git 記錄：\n\n\`\`\`\n${gitLog.slice(0, 3000)}\n\`\`\``;

  const savedPath = await saveReportToVault(vaultPath, {
    title: `KnowPipe 開發史${since ? ` — ${since} 起` : ''}`,
    date: today,
    content,
    tags: ['memoir', 'development-history', 'auto-generated'],
    filePrefix: 'memoir',
    subtitle: `基於 ${commitCount} 筆 commit，從 ${since ?? '專案初期'} 至今`,
    tool: 'memoir',
  });

  logger.info('memoir', '開發史生成完成', { commits: commitCount, path: savedPath });
  return { savedPath, commitCount, hasMemory: Boolean(memoryContext) };
}
