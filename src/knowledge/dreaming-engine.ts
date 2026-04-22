/**
 * Dreaming Engine — daily knowledge consolidation.
 * Scans recently modified notes, finds cross-note connections via entity
 * overlap, and generates a "dreaming report" of suggested links.
 * With dryRun=false: also patches related: field into frontmatter.
 */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getAllMdFiles } from '../vault/frontmatter-utils.js';
import { loadKnowledge } from './knowledge-store.js';
import { findRelatedNotes } from './knowledge-graph.js';
import { saveReportToVault } from './report-saver.js';
import { runLocalLlmPrompt } from '../utils/local-llm.js';
import { logger } from '../core/logger.js';

export interface DreamingResult {
  scannedNotes: number;
  notesWithLinks: number;
  totalNewLinks: number;
  savedPath?: string;
  dryRun: boolean;
}

interface NoteConnection {
  title: string;
  filePath: string;
  related: Array<{ title: string; sharedEntities: string[] }>;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

async function getFileMtime(filePath: string): Promise<string> {
  const s = await stat(filePath);
  return s.mtime.toISOString().split('T')[0];
}

async function findRecentFiles(vaultPath: string, days: number): Promise<string[]> {
  const files = await getAllMdFiles(join(vaultPath, 'KnowPipe'));
  const cutoff = daysAgo(days);
  const recent: string[] = [];
  for (const f of files) {
    try {
      const mtime = await getFileMtime(f);
      if (mtime >= cutoff) recent.push(f);
    } catch { /* skip unreadable */ }
  }
  return recent;
}

export async function runDreaming(
  vaultPath: string,
  days = 7,
  dryRun = true,
): Promise<DreamingResult> {
  const knowledge = await loadKnowledge();
  if (Object.keys(knowledge.notes).length === 0) {
    return { scannedNotes: 0, notesWithLinks: 0, totalNewLinks: 0, dryRun };
  }

  // Build filePath → NoteAnalysis map
  const noteByPath = new Map(
    Object.values(knowledge.notes).map(n => [n.filePath, n]),
  );

  const recentFiles = await findRecentFiles(vaultPath, days);
  const connections: NoteConnection[] = [];

  for (const filePath of recentFiles) {
    const note = noteByPath.get(filePath);
    if (!note) continue;
    const related = findRelatedNotes(knowledge, note.noteId, 5);
    if (related.length === 0) continue;
    connections.push({
      title: note.title,
      filePath,
      related: related.map(r => ({ title: r.title, sharedEntities: r.sharedEntities })),
    });
  }

  const totalNewLinks = connections.reduce((s, c) => s + c.related.length, 0);
  const today = new Date().toISOString().split('T')[0];
  const sections: string[] = [];

  if (connections.length > 0) {
    // LLM synthesis
    const sample = connections.slice(0, 20)
      .map(c =>
        `「${c.title}」→ ${c.related.slice(0, 3).map(r =>
          `「${r.title}」(${r.sharedEntities.slice(0, 3).join('、')})`,
        ).join('；')}`,
      ).join('\n');

    const summary = await runLocalLlmPrompt(
      `以下是最近 ${days} 天新筆記與現有 Vault 的關聯發現：\n\n${sample}\n\n` +
      `請用 2-3 段繁體中文，總結主要連結模式，並找出最值得深化的 1-2 個主題群集。`,
      { task: 'summarize', timeoutMs: 30_000, maxTokens: 512 },
    );
    if (summary) sections.push(`## AI 洞察\n\n${summary}\n`);

    sections.push('## 建議連結清單\n');
    for (const conn of connections) {
      sections.push(`### ${conn.title}\n`);
      for (const r of conn.related) {
        sections.push(`- [[${r.title}]] — 共同主題：${r.sharedEntities.slice(0, 4).join('、')}`);
      }
      sections.push('');
    }

    if (!dryRun) {
      for (const conn of connections) {
        await patchRelated(conn.filePath, conn.related.map(r => r.title));
      }
    }
  } else {
    sections.push(
      `最近 ${days} 天的新筆記尚未建立足夠關聯` +
      `（需先執行 /vault analyze 建立實體圖譜）。`,
    );
  }

  const savedPath = await saveReportToVault(vaultPath, {
    title: `Dreaming Report — ${today}`,
    date: today,
    content: sections.join('\n'),
    tags: ['dreaming', 'knowledge-graph', 'auto-generated'],
    filePrefix: 'dreaming',
    subtitle: `最近 ${days} 天：${connections.length} 篇筆記發現連結` +
      (dryRun ? '（dry-run）' : '（已套用 related:）'),
    tool: 'dreaming',
  });

  logger.info('dreaming', '知識固化完成', { notes: connections.length, links: totalNewLinks });
  return { scannedNotes: recentFiles.length, notesWithLinks: connections.length, totalNewLinks, savedPath, dryRun };
}

async function patchRelated(filePath: string, titles: string[]): Promise<void> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const escaped = titles.map(t => `"${t.replace(/"/g, '')}"`).join(', ');
    const relatedLine = `related: [${escaped}]`;
    const updated = /^related:/m.test(raw)
      ? raw.replace(/^related:.*$/m, relatedLine)
      : raw.replace(/(^---\r?\n[\s\S]*?)(\r?\n---)/, `$1\n${relatedLine}$2`);
    await writeFile(filePath, updated, 'utf-8');
  } catch (err) {
    logger.warn('dreaming', '無法寫入 related', { filePath, err: String(err) });
  }
}
