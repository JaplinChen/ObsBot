/**
 * Telegram photo handler — processes images sent directly to the bot.
 * Downloads the photo, runs OCR + Vision analysis, saves to Vault as a note.
 */
import type { Telegraf, Context } from 'telegraf';
import type { PhotoSize } from 'telegraf/types';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { logger } from '../core/logger.js';
import { formatErrorMessage } from '../core/errors.js';
import type { ExtractedContent } from '../extractors/types.js';
import type { AppConfig } from '../utils/config.js';
import { enrichExtractedContent } from './services/enrich-content-service.js';
import { saveExtractedContent } from './services/save-content-service.js';
import { formatSavedSummary } from './user-messages.js';
import { analyzeImage } from '../utils/vision-llm.js';
import type { BotStats } from './types.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** Pick the largest available photo size */
function pickBestPhoto(photos: PhotoSize[]): PhotoSize {
  return photos.reduce((best, p) =>
    (p.file_size ?? 0) > (best.file_size ?? 0) ? p : best,
  );
}

/** Build ExtractedContent from an analyzed photo */
function buildContent(
  title: string,
  description: string,
  imagePath: string,
  caption?: string,
): ExtractedContent {
  const today = new Date().toISOString().slice(0, 10);
  const text = caption
    ? `${caption}\n\n${description}`
    : description;

  return {
    platform: 'web',
    author: '',
    authorHandle: '',
    title,
    text,
    images: [imagePath],
    videos: [],
    date: today,
    url: `photo://${today}-${randomBytes(4).toString('hex')}`,
  };
}

export function registerPhotoHandler(
  bot: Telegraf,
  config: AppConfig,
  stats: BotStats,
): void {
  bot.on('photo', async (ctx: Context) => {
    const msg = ctx.message;
    if (!msg || !('photo' in msg)) return;

    const photos = (msg as { photo: PhotoSize[] }).photo;
    const best = pickBestPhoto(photos);
    const caption = 'caption' in msg ? (msg as { caption?: string }).caption : undefined;

    if ((best.file_size ?? 0) > MAX_FILE_SIZE) {
      await ctx.reply(`圖片太大（上限 ${MAX_FILE_SIZE / 1024 / 1024}MB）`);
      return;
    }

    ctx.sendChatAction('typing').catch(() => {});
    const status = await ctx.reply('🖼 分析圖片中…');

    const id = randomBytes(4).toString('hex');
    const tempDir = join(tmpdir(), `obsbot-photo-${id}`);

    try {
      await mkdir(tempDir, { recursive: true });

      // Download photo from Telegram
      const fileLink = await ctx.telegram.getFileLink(best.file_id);
      const res = await fetch(fileLink.href);
      if (!res.ok) throw new Error(`下載失敗：${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());

      const imgPath = join(tempDir, `photo-${id}.jpg`);
      await writeFile(imgPath, buffer);
      logger.info('photo', 'downloaded', { size: buffer.length, path: imgPath });

      // Vision analysis
      const description = await analyzeImage(imgPath) ?? '（無法辨識圖片內容）';
      logger.info('photo', 'analyzed', { chars: description.length });

      // Build title from caption or description
      const title = caption
        ? caption.slice(0, 40)
        : description.slice(0, 40).replace(/\n/g, ' ');

      const content = buildContent(title, description, imgPath, caption);
      content.tempDir = tempDir;

      await enrichExtractedContent(content, config);
      const result = await saveExtractedContent(content, config.vaultPath, { saveVideos: config.saveVideos });

      stats.saved++;
      if (stats.recent.length >= 50) stats.recent.shift();
      stats.recent.push(`[圖片] ${content.title.slice(0, 50)}`);

      await ctx.reply(formatSavedSummary(content, result));

      // 回傳 .md 檔案
      try {
        const fullPath = join(config.vaultPath, result.mdPath);
        await ctx.replyWithDocument({ source: fullPath, filename: result.mdPath.split('/').pop() ?? 'note.md' });
      } catch { /* 非關鍵 */ }

      logger.info('photo', 'saved', { path: result.mdPath });
    } catch (err) {
      logger.error('photo', 'failed', { err });
      stats.errors++;
      await ctx.reply(formatErrorMessage(err));
    } finally {
      await ctx.deleteMessage(status.message_id).catch(() => {});
      rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}
