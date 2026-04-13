import { logger } from '../../core/logger.js';
import { classifyError } from '../../core/errors.js';
import type { ErrorCode } from '../../core/errors.js';
import type { ExtractedContent, ExtractorWithComments } from '../../extractors/types.js';
import { webExtractor } from '../../extractors/web-extractor.js';

/** Error codes eligible for web-extractor fallback */
const FALLBACK_ELIGIBLE: Set<ErrorCode> = new Set([
  'TIMEOUT', 'FORBIDDEN', 'NETWORK',
]);

function shouldFallbackToWeb(err: unknown, platform: string): boolean {
  if (platform === 'web') return false;
  return FALLBACK_ELIGIBLE.has(classifyError(err));
}

/** CAPTCHA / bot-detection page title patterns */
const CAPTCHA_TITLE_RE = /^(請稍候|just a moment|security check|verif|attention required|access denied|ddos protection|one more step|enable javascript)/i;

/** CAPTCHA / connection-error content patterns */
const CAPTCHA_CONTENT_RE = /正在執行安全驗證|安全服務抵禦惡意機器人|ERR_CONNECTION_CLOSED|ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|無法連上這個網站.*中斷連線|cloudflare.*protect|verify you are human|checking if the site connection is secure|此網站使用安全服務|Performing security verification|This website uses a security service|Please wait while we verify|你被封鎖了|You've been blocked/i;

/** Detect useless pages (CAPTCHA / bot-block / connection error) — exported for reprocess */
export function detectUselessPage(content: import('../../extractors/types.js').ExtractedContent): string | null {
  if (CAPTCHA_TITLE_RE.test(content.title.trim())) {
    return `擷取到驗證或封鎖頁面（標題：「${content.title}」），無法取得真實內容`;
  }
  const sample = content.text.slice(0, 600);
  if (CAPTCHA_CONTENT_RE.test(sample)) {
    return '擷取到安全驗證或網路錯誤頁面，無法取得真實內容';
  }
  return null;
}

/** Filter out noise: too short, pure emoji, or generic one-word reactions */
function isMeaningfulComment(c: { text: string }): boolean {
  const t = c.text.trim();
  if (!t) return false;
  if (/https?:\/\/\S+|(?:^|\s)\w+\.\w{2,}\/\S+/.test(t)) return true;
  if (t.length < 15) return false;
  if (/^[\p{Emoji}\s!?.\u3002\uFF0C\uFF01\uFF1F]+$/u.test(t)) return false;
  if (/^(great|nice|wow|lol|haha|yes|ok|okay|cool|love|good|awesome|amazing|thanks|congrats?)[\s!.\uFF01\u3002]*$/i.test(t)) return false;
  return true;
}

/** Hard cap on extraction time (covers all fallback tiers). */
const EXTRACT_TIMEOUT_MS = 60_000;

export async function extractContentWithComments(
  url: string,
  extractor: ExtractorWithComments,
): Promise<ExtractedContent> {
  const hasComments = typeof extractor.extractComments === 'function';

  // Wrap extraction with a hard timeout so cascading fallback tiers
  // (fetch → Jina → Camoufox → BrowserUse) cannot exceed 60 s total.
  const extractWithTimeout = Promise.race([
    extractor.extract(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`擷取超時（>${EXTRACT_TIMEOUT_MS / 1000}s）：${url}`)), EXTRACT_TIMEOUT_MS),
    ),
  ]);

  const [contentResult, commentsResult] = await Promise.allSettled([
    extractWithTimeout,
    hasComments ? extractor.extractComments(url, 30) : Promise.resolve([]),
  ]);

  let content: ExtractedContent;

  if (contentResult.status === 'rejected') {
    const originalError = contentResult.reason as Error;

    if (shouldFallbackToWeb(originalError, extractor.platform)) {
      logger.warn('extract', `${extractor.platform} 失敗，嘗試 web-extractor 降級`, {
        error: originalError.message.slice(0, 100),
      });
      try {
        content = await webExtractor.extract(url);
        logger.info('extract', `web-extractor 降級成功：${url}`);
      } catch {
        throw originalError;
      }
    } else {
      throw originalError;
    }
  } else {
    content = contentResult.value;
  }

  logger.info('msg', 'extracted', { title: content.title });

  // Reject CAPTCHA / bot-block / connection-error pages immediately
  const uselessReason = detectUselessPage(content);
  if (uselessReason) {
    logger.warn('extract', '偵測到無效頁面，拒絕儲存', { title: content.title, reason: uselessReason });
    throw new Error(uselessReason);
  }

  if (commentsResult.status === 'fulfilled' && commentsResult.value.length > 0) {
    const meaningful = commentsResult.value.filter(isMeaningfulComment);
    if (meaningful.length > 0) {
      content.comments = meaningful;
      content.commentCount = commentsResult.value.length;
    }
  }

  return content;
}
