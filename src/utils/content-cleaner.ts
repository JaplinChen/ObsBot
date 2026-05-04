/** Content cleaning utilities — filter ad-speak, emoji spam, and title noise. */

/** Exaggerated modifiers to remove from body text */
const AD_SPEAK_PATTERNS: RegExp[] = [
  // 誇張修飾詞
  /(?:太|巨|超級?|極度?|瘋狂|史上最|業界最|全網最)?(?:震撼|好用|猛|強大|頂級|驚人|炸裂|離譜|逆天|恐怖|變態|無敵|頂流)[了的啊呀吧嗎！!]*/g,
  /(?:神器|天花板|炸裂|絕絕子|YYDS|yyds|永遠的神|殿堂級|王炸|核彈級|降維打擊)[！!]*/g,
  /猛到不[行真]|好用到[哭爆飛起]|強到[離譜沒朋友]/g,
  // 催促語
  /(?:趕快|趕緊|必須馬上|還不快|錯過後悔|再不.*就晚了|手慢無|速度|衝啊?)[！!]*/g,
  // 感嘆語助詞（獨立出現時）
  /(?:^|\s)(?:哇靠|我的天|天啊|我的媽|絕了|救命|瘋了|太絕了|太香了|真的絕|我哭了)[！!]*(?:\s|$)/gm,
  // 自我推銷
  /(?:(?:記得|快來|趕快|一定要)?(?:按讚|點贊|轉發|關注|收藏|追蹤|訂閱|分享|三連)(?:[一下喔唷哦]+)?[！!]*)/g,
  /(?:點擊(?:下方)?(?:連結|鏈接)|(?:戳|點)(?:這裡|這邊)(?:了解|查看))/g,
  // 數據炫耀
  /已有\s*\d+[萬w+]\s*人(?:關注|收藏|使用)/g,
];

/** Title-specific noise patterns */
const TITLE_NOISE_PATTERNS: RegExp[] = [
  // 行銷話術
  /(?:必看|爆款|獨家|限時|首發|重磅|突發|炸了|瘋了|火了)[！!：:]*/g,
  // 感嘆號（保留問號）
  /[！!]+/g,
  // 作者前綴 @xxx：或 xxx說：
  /^@[\w\u4e00-\u9fff]+[：:]\s*/,
  /^[\u4e00-\u9fff]{1,8}(?:說|表示)[：:]\s*/,
  // 方括號標籤（如 [必看] [獨家]）
  /\[(?:必看|獨家|重磅|突發|首發|限時|熱門|爆款)\]\s*/g,
];

/** Emoji regex — matches most common emoji ranges */
const EMOJI_RE = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FA9F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

/** Match 3+ consecutive emoji (with optional spaces between) */
const EMOJI_SPAM_RE = new RegExp(
  `(${EMOJI_RE.source}\\s*){3,}`,
  'gu',
);

/**
 * Clean advertising language from body text.
 * Removes exaggerated modifiers, urgency language, and self-promotion.
 * Preserves factual content and technical details.
 */
export function cleanAdSpeak(text: string): string {
  let result = text;

  for (const pattern of AD_SPEAK_PATTERNS) {
    result = result.replace(pattern, '');
  }

  // Reduce emoji spam (3+ consecutive → keep first one)
  result = result.replace(EMOJI_SPAM_RE, (match) => {
    const first = match.match(EMOJI_RE);
    return first ? first[0] + ' ' : '';
  });

  // Compress multiple blank lines to single
  result = result.replace(/\n{3,}/g, '\n\n');

  // Clean up leftover whitespace around removed content
  result = result.replace(/[ \t]+([。，、；：])/g, '$1');
  result = result.replace(/[ \t]{2,}/g, ' ');

  return result.trim();
}

/**
 * Pre-clean title before AI reformatting.
 * Removes emoji, ad prefixes, author names, and marketing buzzwords.
 * Truncates at semantic boundary if > 60 chars.
 */
export function cleanTitle(title: string): string {
  let result = title;

  // Remove all emoji from title
  result = result.replace(EMOJI_RE, '');

  for (const pattern of TITLE_NOISE_PATTERNS) {
    result = result.replace(pattern, '');
  }

  // Remove leading/trailing punctuation and whitespace
  result = result.replace(/^[\s,，、：:—\-–]+/, '').replace(/[\s,，、：:—\-–]+$/, '');

  // Truncate if too long
  if (result.length > 60) {
    result = truncateAtBoundary(result, 60);
  }

  return result.trim();
}

/** UI navigation / structural boilerplate patterns that indicate a bad summary */
const BOILERPLATE_PATTERNS: RegExp[] = [
  // Structural HTML tags
  /<[a-z][^>]*>/i,
  // UI navigation phrases
  /(?:首頁|主頁|登入|登錄|註冊|Sign\s*[Ii]n|Log\s*[Ii]n|Sign\s*[Uu]p|Menu|導航|導覽|跳過廣告|Skip\s*Ad)/,
  // Cookie / privacy banners
  /(?:Cookie|隱私政策|Privacy\s*Policy|使用條款|Terms\s*of\s*(?:Service|Use))/i,
  // Mostly non-Chinese/non-English (e.g. raw JSON fragments)
];

/**
 * Returns true when a summary looks like UI navigation, HTML fragments,
 * or other structural boilerplate rather than actual article content.
 */
export function isBoilerplateSummary(text: string): boolean {
  if (!text || text.trim().length === 0) return true;
  for (const re of BOILERPLATE_PATTERNS) {
    if (re.test(text)) return true;
  }
  // Ratio guard: if ≥40% of characters are ASCII punctuation / symbols it's likely garbage
  const symbolCount = (text.match(/[<>{}\[\]|\\\/=&%$#@^*;]/g) ?? []).length;
  if (symbolCount / text.length >= 0.4) return true;
  return false;
}

function truncateAtBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const boundaries = [
    cut.lastIndexOf('。'),
    cut.lastIndexOf('，'),
    cut.lastIndexOf('、'),
    cut.lastIndexOf('；'),
    cut.lastIndexOf(' '),
    cut.lastIndexOf('-'),
    cut.lastIndexOf('—'),
  ];
  const last = Math.max(...boundaries);
  return last > maxLen * 0.4 ? cut.slice(0, last) : cut;
}
