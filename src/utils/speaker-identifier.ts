/**
 * YouTube speaker identification — labels transcript segments with speaker names.
 * Inspired by baoyu-youtube-transcript's three-tier speaker inference logic:
 *   1. Video metadata (title often contains guest names, channel = host)
 *   2. Dialogue content (self-introductions, address forms)
 *   3. Generic fallback (Host / Guest / Speaker N)
 *
 * Only runs on YouTube content with a substantial transcript (≥500 chars).
 * Uses local LLM (flash tier) to keep cost low. Returns original on any failure.
 */
import { runLocalLlmPrompt } from './local-llm.js';
import { logger } from '../core/logger.js';

const MIN_TRANSCRIPT_CHARS = 500;
const MAX_TRANSCRIPT_CHARS = 5000;
const SPEAKER_TIMEOUT_MS = 45_000;

interface VideoMeta {
  title: string;
  author: string;
  description?: string;
}

/**
 * Attempt to label a YouTube transcript with speaker names.
 * Returns the labeled transcript string, or the original transcript if the
 * LLM call fails, times out, or produces unusable output.
 */
export async function identifySpeakers(
  transcript: string,
  meta: VideoMeta,
): Promise<string> {
  if (transcript.length < MIN_TRANSCRIPT_CHARS) return transcript;

  // Truncate to keep LLM cost predictable
  const slice = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  const truncated = slice.length < transcript.length;

  const descHint = meta.description
    ? `簡介：${meta.description.slice(0, 300)}`
    : '';

  const prompt = `你是影片字幕後處理專家。請根據影片元資料和對話內容，為以下字幕標注說話人。

影片資訊：
- 標題：${meta.title}
- 頻道/作者：${meta.author}
${descHint}

識別優先順序：
1. 從標題推斷嘉賓姓名（如「xxx vs yyy」「with xxx」「feat. xxx」）；頻道名通常是主持人
2. 從對話內容推斷（自我介紹、互相稱呼、角色描述）
3. 若無法確定，使用通用標籤：Host（主持人）、Guest（來賓）、Speaker（發言人）

輸出格式（每段說話人換行）：
**[說話人]：** 說話內容

若字幕是單一講者的演講，則直接在開頭標注 **[${meta.author}]：** 後輸出完整字幕，不需分段。
若字幕語言非中文，說話人標籤仍使用原文姓名，不翻譯。

字幕內容：
${slice}
${truncated ? '\n[後半部分已截斷]' : ''}`;

  try {
    const result = await runLocalLlmPrompt(prompt, {
      task: 'classify',
      timeoutMs: SPEAKER_TIMEOUT_MS,
      maxTokens: 2048,
    });

    if (!result || result.length < MIN_TRANSCRIPT_CHARS / 2) {
      logger.warn('speaker-id', 'LLM returned unusable output, using original transcript');
      return transcript;
    }

    const labeled = result.trim();
    logger.info('speaker-id', 'speaker identification complete', {
      inputChars: transcript.length,
      outputChars: labeled.length,
    });
    return labeled;
  } catch (err) {
    logger.warn('speaker-id', 'speaker identification failed', { err: String(err).slice(0, 120) });
    return transcript;
  }
}
