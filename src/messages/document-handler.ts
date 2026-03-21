/**
 * Telegram document handler — processes PDF files sent to the bot.
 * Downloads the file, extracts text, runs through enrichment pipeline, saves to Vault.
 */
import type { Telegraf, Context } from 'telegraf';
import type { Document } from 'telegraf/types';
import { logger } from '../core/logger.js';
import { formatErrorMessage } from '../core/errors.js';
import type { ExtractedContent } from '../extractors/types.js';
import type { AppConfig } from '../utils/config.js';
import { enrichExtractedContent } from './services/enrich-content-service.js';
import { saveExtractedContent } from './services/save-content-service.js';
import { formatSavedSummary } from './user-messages.js';
import type { BotStats } from './types.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const SUPPORTED_TYPES = ['application/pdf'];

/* ── PDF text extraction ─────────────────────────────────────────────── */

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  return result.text.trim();
}

/* ── Build ExtractedContent from document ────────────────────────────── */

function buildContent(fileName: string, text: string): ExtractedContent {
  const title = fileName.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
  const today = new Date().toISOString().slice(0, 10);

  return {
    platform: 'web',
    author: '',
    authorHandle: '',
    title,
    text: text.slice(0, 5000),
    images: [],
    videos: [],
    date: today,
    url: `file://${fileName}`,
  };
}

/* ── Register handler ────────────────────────────────────────────────── */

export function registerDocumentHandler(
  bot: Telegraf,
  config: AppConfig,
  stats: BotStats,
): void {
  bot.on('document', async (ctx: Context) => {
    const msg = ctx.message;
    if (!msg || !('document' in msg)) return;

    const doc = (msg as { document: Document }).document;
    const mime = doc.mime_type ?? '';
    const fileName = doc.file_name ?? 'document.pdf';

    // Only handle PDFs
    if (!SUPPORTED_TYPES.includes(mime)) return;

    if ((doc.file_size ?? 0) > MAX_FILE_SIZE) {
      await ctx.reply(`檔案太大（上限 ${MAX_FILE_SIZE / 1024 / 1024}MB）`);
      return;
    }

    const status = await ctx.reply(`處理 PDF：${fileName}…`);

    try {
      // Download file from Telegram
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      const res = await fetch(fileLink.href);
      if (!res.ok) throw new Error(`下載失敗：${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());

      // Extract text
      const text = await extractPdfText(buffer);
      if (!text || text.length < 20) {
        await ctx.reply('PDF 文字內容不足，無法處理。可能是掃描圖檔，需 OCR。');
        return;
      }

      logger.info('doc', 'pdf-extracted', { fileName, chars: text.length });

      // Build content and run through pipeline
      const content = buildContent(fileName, text);
      await enrichExtractedContent(content, config);
      const result = await saveExtractedContent(content, config.vaultPath, { saveVideos: config.saveVideos });

      stats.saved++;
      if (stats.recent.length >= 50) stats.recent.shift();
      stats.recent.push(`[PDF] ${content.title.slice(0, 50)}`);

      await ctx.reply(formatSavedSummary(content, result));
      logger.info('doc', 'pdf-saved', { fileName, path: result.mdPath });
    } catch (err) {
      logger.error('doc', 'pdf-failed', { fileName, err });
      stats.errors++;
      await ctx.reply(formatErrorMessage(err));
    } finally {
      await ctx.deleteMessage(status.message_id).catch(() => {});
    }
  });
}
