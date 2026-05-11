/** Content cleaning utilities — filter ad-speak, emoji spam, and title noise. */

/**
 * Promotional block signals — each matches a paragraph-level CTA or solicitation.
 * Non-global flags so `.test()` is safe to call repeatedly.
 */
const PROMO_BLOCK_SIGNALS: RegExp[] = [
  // 聯絡/合作邀請
  /私訊(?:我|一下)|加(?:我)?(?:微信|LINE|IG|WeChat|Telegram)|找我合作|商業合作|合作邀請|聯絡我|聯繫我/,
  // 課程/產品銷售（需要明確的銷售上下文，避免「課程學習」等術語被誤判）
  /(?:我的|本人)課程|(?:付費|收費)課程|課程(?:報名|購買|加入|連結)|報名(?:連結|鏈接|入口)|購買連結|下單連結|免費(?:領取|獲取)(?:資料|模板|工具|指南|教程)/,
  /限時(?:報名|優惠|折扣|購買|秒殺)|搶購(?:名額|資格)|特惠價|早鳥價/,
  // 強制關注 / 訂閱 CTA
  /(?:關注|追蹤|訂閱)(?:我的)?(?:頻道|帳號|主頁|公眾號|小紅書|抖音|微博).*(?:更多|乾貨|每天|精彩)/,
  /follow\s+(?:me|us|my).*(?:for more|更多|daily|content)/i,
  // 郵件/掃碼推廣
  /(?:發(?:郵件|email|mail)|掃(?:二維碼|QR碼?)).*(?:了解|諮詢|獲取|詳情)/i,
  // 引流話術
  /想(?:學|了解|掌握|入門).{0,15}(?:的朋友|的話)?[，,]?(?:私訊|加我|來找我|找我)/,
  /(?:感興趣|有興趣).{0,10}(?:歡迎)?(?:私訊|加我|留言)/,
  // 電子報/newsletter 訂閱 CTA（Threads、X 常見結尾廣告）
  /(?:免費|立即|馬上)?(?:訂閱|subscribe).{0,20}(?:電子報|newsletter|週報|日報)/i,
  /(?:\d+[\+\+k]?\s*(?:讀者|訂閱者|人)).{0,30}(?:都在看|收到|閱讀)/,
  // 👉 + URL / 訂閱連結（表情箭頭引流）
  /👉\s*(?:https?:\/\/|\w[\w.-]+\.[a-z]{2,})/i,
  // 「追一發」「追一波」「追一個」「記得追」type follow CTA
  /(?:記得|先)?(?:追一[發波下個]|follow一下|按追蹤)/,
];

/**
 * Remove entire paragraphs that are primarily promotional / solicitation content.
 * Runs AFTER cleanAdSpeak: targets blocks that survive phrase-level cleaning
 * because they're structurally promotional rather than just using ad words.
 *
 * Removal criteria (applied per double-newline block):
 *  - Block length < 120 chars AND ≥1 promo signal → standalone CTA, drop it
 *  - Block has ≥2 promo signals regardless of length → drop it
 *  - Block becomes < 8 chars after stripping (skeleton left by cleanAdSpeak) → drop it
 */
export function stripPromoBlocks(text: string): string {
  if (!text) return text;

  const blocks = text.split(/\n{2,}/);
  const kept: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Drop skeleton lines left by cleanAdSpeak (< 8 non-whitespace chars)
    const compact = trimmed.replace(/\s/g, '');
    if (compact.length < 8) continue;

    let signals = 0;
    for (const re of PROMO_BLOCK_SIGNALS) {
      if (re.test(trimmed)) signals++;
    }

    if (trimmed.length < 120 && signals >= 1) continue;  // short standalone CTA
    if (signals >= 2) continue;                           // high promo density

    // For longer blocks: filter individual promo lines (if block itself survived)
    if (signals === 1 && trimmed.includes('\n')) {
      const lines = trimmed.split('\n');
      const filtered = lines.filter(line => {
        const t = line.trim();
        if (!t) return false;
        let lineSigs = 0;
        for (const re of PROMO_BLOCK_SIGNALS) {
          if (re.test(t)) lineSigs++;
        }
        return lineSigs === 0 || t.length > 100; // keep long lines even with one signal
      });
      if (filtered.length > 0) kept.push(filtered.join('\n'));
      continue;
    }

    kept.push(trimmed);
  }

  return kept.join('\n\n');
}

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
