/**
 * 實驗性 LLM 分類器 — 用 LLM 判斷筆記分類，取代關鍵詞規則。
 * 讀取 Vault 現有資料夾結構作為 few-shot 上下文。
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../core/logger.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { classifyContent as keywordClassify } from '../classifier.js';

// ── Vault 資料夾掃描 ──

let folderCache: string[] | null = null;

/** 遞迴掃描 GetThreads 下的資料夾結構（最多 3 層），回傳分類路徑清單 */
async function scanVaultFolders(vaultPath: string): Promise<string[]> {
  if (folderCache) return folderCache;

  const rootDir = join(vaultPath, 'GetThreads');
  const folders: string[] = [];

  async function walk(dir: string, depth: number, prefix: string): Promise<void> {
    if (depth > 3) return;
    try {
      for (const entry of await readdir(dir)) {
        if (entry.startsWith('.') || entry === 'attachments' || entry === 'MOC') continue;
        const full = join(dir, entry);
        if ((await stat(full)).isDirectory()) {
          const path = prefix ? `${prefix}/${entry}` : entry;
          folders.push(path);
          await walk(full, depth + 1, path);
        }
      }
    } catch { /* skip */ }
  }

  await walk(rootDir, 1, '');
  folderCache = folders;
  return folders;
}

// ── LLM 分類 ──

function buildPrompt(title: string, text: string, existingFolders: string[]): string {
  const snippet = text.slice(0, 600);
  const folderList = existingFolders.slice(0, 50).join('\n');

  return [
    '你是一個內容分類器。根據以下標題和內容摘要，從已知的資料夾分類中選擇最合適的一個。',
    '如果沒有合適的分類，可以建議新分類（但格式必須是 A/B 或 A/B/C 的中文路徑）。',
    '',
    '=== 已知分類 ===',
    folderList,
    '',
    '=== 待分類內容 ===',
    `標題：${title}`,
    `摘要：${snippet}`,
    '',
    '請只回覆一行：分類路徑（如 AI/研究對話/Claude）。不要解釋。',
  ].join('\n');
}

/** 用 LLM 分類內容，回傳分類字串。失敗時 fallback 到關鍵詞分類器。 */
export async function classifyWithLlm(
  title: string,
  text: string,
  vaultPath: string,
): Promise<{ category: string; source: 'llm' | 'keyword' }> {
  try {
    const folders = await scanVaultFolders(vaultPath);
    const prompt = buildPrompt(title, text, folders);
    const result = await runLocalLlmPrompt(prompt, { model: 'flash' });

    if (result) {
      const cleaned = result
        .replace(/```/g, '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('#'))[0];

      if (cleaned && cleaned.length <= 40 && cleaned.includes('/')) {
        logger.info('classify', 'llm-classifier', { category: cleaned });
        return { category: cleaned, source: 'llm' };
      }
    }
  } catch (err) {
    logger.warn('classify', 'llm-classifier failed, fallback to keyword', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { category: keywordClassify(title, text), source: 'keyword' };
}

// ── A/B 比較工具 ──

export interface ClassifierComparison {
  title: string;
  keywordResult: string;
  llmResult: string;
  match: boolean;
}

/** 對單篇內容進行 A/B 比較 */
export async function compareClassifiers(
  title: string,
  text: string,
  vaultPath: string,
): Promise<ClassifierComparison> {
  const keywordResult = keywordClassify(title, text);
  const llmResult = await classifyWithLlm(title, text, vaultPath);

  return {
    title: title.slice(0, 60),
    keywordResult,
    llmResult: llmResult.category,
    match: keywordResult === llmResult.category,
  };
}
