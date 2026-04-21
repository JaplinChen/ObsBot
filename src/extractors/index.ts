import { registerExtractor, getRegisteredExtractors } from '../utils/url-parser.js';

export { getRegisteredExtractors };
import { xExtractor } from './x-extractor.js';
import { threadsExtractor } from './threads-extractor.js';
import { youtubeExtractor } from './youtube-extractor.js';
import { githubExtractor } from './github-extractor.js';
import { bilibiliExtractor } from './bilibili-extractor.js';
import { weiboExtractor } from './weibo-extractor.js';
import { xiaohongshuExtractor } from './xiaohongshu-extractor.js';
import { douyinExtractor } from './douyin-extractor.js';
import { tiktokExtractor } from './tiktok-extractor.js';
import { ithomeExtractor } from './ithome-extractor.js';
import { zhihuExtractor } from './zhihu-extractor.js';
import { directVideoExtractor } from './direct-video-extractor.js';
import { webExtractor } from './web-extractor.js';
import { loadPlugins } from '../plugins/plugin-loader.js';
import { logger } from '../core/logger.js';
import { getEnabledPlatforms } from '../utils/user-config.js';
import type { Extractor } from './types.js';

/** Platform key → extractor mapping. */
const PLATFORM_EXTRACTORS: Record<string, Extractor> = {
  x: xExtractor,
  threads: threadsExtractor,
  youtube: youtubeExtractor,
  github: githubExtractor,
  bilibili: bilibiliExtractor,
  weibo: weiboExtractor,
  xiaohongshu: xiaohongshuExtractor,
  douyin: douyinExtractor,
  tiktok: tiktokExtractor,
  ithome: ithomeExtractor,
  zhihu: zhihuExtractor,
  'direct-video': directVideoExtractor,
};

/** Register all extractors — respects user-config disabled list.
 *  Order matters: plugins before webExtractor, webExtractor last (fallback). */
export async function registerAllExtractors(): Promise<void> {
  const enabled = new Set(getEnabledPlatforms());
  const skipped: string[] = [];

  for (const [key, extractor] of Object.entries(PLATFORM_EXTRACTORS)) {
    if (enabled.has(key)) {
      registerExtractor(extractor);
    } else {
      skipped.push(key);
    }
  }

  if (skipped.length > 0) {
    logger.info('extractors', `已停用 ${skipped.length} 個平台`, { platforms: skipped.join(', ') });
  }

  // Load plugins before fallback extractor
  const plugins = await loadPlugins();
  if (plugins.length > 0) {
    logger.info('extractors', `已載入 ${plugins.length} 個插件 extractor`);
  }

  // web extractor is always registered as fallback (unless explicitly disabled)
  if (enabled.has('web')) {
    registerExtractor(webExtractor);
  }
}
