/**
 * Info card renderer — generates PNG screenshots from HTML templates.
 * Uses the existing Camoufox browser pool for rendering.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { ExtractedContent } from '../extractors/types.js';
import { camoufoxPool } from '../utils/camoufox-pool.js';
import { type CardData, resolveAccentColor } from './card-types.js';
import { renderCardHtml } from './card-templates.js';
import { getLocalFontFaceCSS } from './font-cache.js';
import { PLATFORM_LABELS } from '../formatters/shared.js';
import { logger } from '../core/logger.js';

/** Convert ExtractedContent to CardData. */
function toCardData(content: ExtractedContent): CardData {
  const category = content.category ?? '其他';
  return {
    title: content.title,
    summary: content.enrichedSummary ?? content.text.slice(0, 150),
    category,
    platform: PLATFORM_LABELS[content.platform] ?? content.platform,
    date: content.date,
    keywords: content.enrichedKeywords ?? [],
    accentColor: resolveAccentColor(category),
  };
}

/** Build output path for the card image. */
function cardPath(vaultPath: string, platform: string, slug: string): string {
  return join(vaultPath, 'attachments', 'knowpipe', 'cards', `${slug}.png`);
}

/** Create a URL-safe slug from title. */
function slugify(title: string, maxLen = 40): string {
  return title
    .replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
    .toLowerCase();
}

/**
 * Generate an info card PNG for the given content.
 * @returns Path to the generated PNG, or null on failure.
 */
export async function generateInfoCard(
  content: ExtractedContent,
  vaultPath: string,
): Promise<string | null> {
  const data = toCardData(content);
  const slug = `${slugify(content.title)}-${content.date}`;
  const outPath = cardPath(vaultPath, content.platform, slug);

  const fontFaceCSS = await getLocalFontFaceCSS();
  const html = renderCardHtml(data, fontFaceCSS);

  let acquired: Awaited<ReturnType<typeof camoufoxPool.acquire>> | null = null;
  try {
    await mkdir(dirname(outPath), { recursive: true });

    acquired = await camoufoxPool.acquire();
    const { page, release } = acquired;

    try {
      await page.setViewportSize({ width: 800, height: 420 });
      // 使用本地字型，不需要等待外部網路請求
      await page.setContent(html, { waitUntil: 'load' });
      // 等待字型就緒（本地檔案應迅速載入）
      await page.waitForFunction(
        () => document.fonts.ready.then(() => true),
        { timeout: 3000 },
      ).catch(() => {
        logger.warn('card', '字型就緒逾時，直接截圖');
      });
      const screenshot = await page.screenshot({
        clip: { x: 0, y: 0, width: 800, height: 420 },
        type: 'png',
      });
      await writeFile(outPath, screenshot);
      logger.info('card', '資訊卡生成成功', { path: outPath });
      return outPath;
    } finally {
      await release();
    }
  } catch (err) {
    logger.warn('card', '資訊卡生成失敗', { error: (err as Error).message });
    return null;
  }
}
