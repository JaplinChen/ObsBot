/**
 * Body text structural reformatter.
 * Transforms wall-of-text into readable Markdown with proper lists and paragraphs.
 * Pure rule-based — no LLM calls. Applied after cleanAdSpeak() in assembleNote().
 */

/** Circled number → arabic mapping */
const CIRCLED_MAP: Record<string, string> = {
  '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5',
  '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9', '⑩': '10',
  '⑪': '11', '⑫': '12', '⑬': '13', '⑭': '14', '⑮': '15',
  '⑯': '16', '⑰': '17', '⑱': '18', '⑲': '19', '⑳': '20',
};
const CIRCLED_RE = new RegExp(`([${Object.keys(CIRCLED_MAP).join('')}])\\s*`, 'g');

/** Keycap emoji number → arabic mapping (1️⃣ → 1) */
const KEYCAP_MAP: Record<string, string> = {};
for (let i = 0; i <= 9; i++) {
  KEYCAP_MAP[`${i}\uFE0F\u20E3`] = String(i); // N️⃣
  KEYCAP_MAP[`${i}\u20E3`] = String(i);         // N⃣ (without VS16)
}
const KEYCAP_RE = /(\d)\uFE0F?\u20E3\s*/g;

/**
 * Normalize slash-numbered (1/ 2/), circled (① ②), and keycap emoji (1️⃣ 2️⃣)
 * to dot-numbered (1. 2.)
 */
function normalizeNumbering(text: string): string {
  // 1/ 2/ 3/ → 1. 2. 3.
  let result = text.replace(/(\d{1,2})\/\s+/g, '$1. ');
  // ① ② → 1. 2.
  result = result.replace(CIRCLED_RE, (_, c: string) => `${CIRCLED_MAP[c]}. `);
  // 1️⃣ 2️⃣ → 1. 2.
  result = result.replace(KEYCAP_RE, (_, digit: string) => `${digit}. `);
  return result;
}

/**
 * Count how many "N. " patterns appear in a single line.
 * Ignores numbers inside markdown links [text](url).
 */
function countInlineNumbers(line: string): number {
  // Strip markdown links to avoid false positives on URLs containing numbers
  const stripped = line.replace(/\[[^\]]*\]\([^)]*\)/g, '');
  const matches = stripped.match(/(?:^|(?<=\s))\d{1,2}\.\s+/g);
  return matches?.length ?? 0;
}

/**
 * Rule 1: Break inline numbered items into separate lines.
 * Detects lines with 3+ sequential "N. " and splits them.
 */
function breakInlineNumberedItems(text: string): string {
  return text.split('\n').map(line => {
    if (countInlineNumbers(line) < 3) return line;

    // Protect markdown links with placeholders
    const links: string[] = [];
    let protected_ = line.replace(/\[[^\]]*\]\([^)]*\)/g, (match) => {
      links.push(match);
      return `\x01LINK${links.length - 1}\x01`;
    });

    // Insert newline before each numbered item (except the first occurrence)
    let firstFound = false;
    protected_ = protected_.replace(/(\d{1,2})\.\s+/g, (match) => {
      if (!firstFound) {
        firstFound = true;
        return match;
      }
      return '\n' + match;
    });

    // Restore links
    return protected_.replace(/\x01LINK(\d+)\x01/g, (_, i) => links[Number(i)]);
  }).join('\n');
}

/**
 * Rule 1.5: Break inline markdown headings and list markers.
 * Detects "text ## Heading" or "text - item" patterns within a single line.
 */
function breakInlineStructure(text: string): string {
  return text.split('\n').map(line => {
    if (line.trim().length < 200) return line;
    // Break before inline ## headings (but not at line start)
    let result = line.replace(/(?<=\S)\s+(#{1,6}\s+)/g, '\n\n$1');
    // Break before inline list markers (- or * followed by space and text)
    // Only if the line is long and has multiple list items
    const listMatches = result.match(/(?:^|\s)-\s+\S/g);
    if (listMatches && listMatches.length >= 3) {
      let first = true;
      result = result.replace(/(?<=\S)\s+(-\s+)/g, (match, marker) => {
        if (first) { first = false; return '\n' + marker; }
        return '\n' + marker;
      });
    }
    return result;
  }).join('\n');
}

/**
 * Rule 2: Break long paragraphs at sentence boundaries.
 * Only triggers for paragraphs >500 chars with no internal line breaks.
 * Uses character count (not sentence count) to avoid splitting short examples.
 */
function breakLongParagraphs(text: string): string {
  return text.split('\n\n').map(paragraph => {
    const trimmed = paragraph.trim();
    if (trimmed.length < 500) return paragraph;
    if (trimmed.includes('\n')) return paragraph;
    if (/^\s*[-*]\s/.test(trimmed) || /^\s*\d+\.\s/.test(trimmed)) return paragraph;

    // Split at sentence-ending punctuation, but only when enough text has accumulated
    let lastBreakOffset = 0;
    return trimmed.replace(/([。！？!?])\s*/g, (match, punct: string, offset: number) => {
      const charsSinceBreak = offset - lastBreakOffset;
      const nextChar = trimmed[offset + match.length];
      // Only break if >150 chars since last break, and next char is actual content
      if (charsSinceBreak >= 150 && nextChar && !/[。！？!?：:；;>）\]\s]/.test(nextChar)) {
        lastBreakOffset = offset + match.length;
        return punct + '\n\n';
      }
      return match;
    });
  }).join('\n\n');
}

/**
 * Rule 3: Ensure numbered list items have proper spacing.
 * After breaking inline numbers, add blank line between items for readability.
 */
function spacedListItems(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isNumbered = /^\d{1,2}\.\s+/.test(line.trim());
    const prevLine = i > 0 ? lines[i - 1] : '';
    const prevIsBlank = prevLine.trim() === '';
    const prevIsNumbered = /^\d{1,2}\.\s+/.test(prevLine.trim());

    // Add blank line before a numbered item if previous line is non-blank content
    // (not another numbered item, not already blank)
    if (isNumbered && i > 0 && !prevIsBlank && !prevIsNumbered) {
      result.push('');
    }
    result.push(line);
  }

  return result.join('\n');
}

/**
 * Rule 4: Compress excessive blank lines.
 */
function normalizeBlankLines(text: string): string {
  return text.replace(/\n{4,}/g, '\n\n\n');
}

/**
 * Check if text already has reasonable formatting.
 * Returns true if text is well-structured and doesn't need reformatting.
 */
function isWellFormatted(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  // Short text with multiple lines — already formatted
  if (trimmed.length < 300) {
    const lineCount = trimmed.split('\n').filter(l => l.trim()).length;
    if (lineCount >= 3) return true;
  }

  // Check if all paragraphs are reasonably sized
  const paragraphs = trimmed.split(/\n\n+/);
  const hasWallOfText = paragraphs.some(p => {
    const singleLine = p.replace(/\n/g, '').trim();
    return singleLine.length > 500;
  });
  const hasInlineNumbers = paragraphs.some(p => {
    const lines = p.split('\n');
    return lines.some(l => countInlineNumbers(l) >= 3);
  });

  return !hasWallOfText && !hasInlineNumbers;
}

/**
 * Main entry: reformat body text for better readability.
 * Safe to call on already-formatted text — returns unchanged if not needed.
 */
export function reformatBody(text: string): string {
  if (isWellFormatted(text)) return text;

  let result = text;
  result = normalizeNumbering(result);
  result = breakInlineStructure(result);
  result = breakInlineNumberedItems(result);
  result = breakLongParagraphs(result);
  result = spacedListItems(result);
  result = normalizeBlankLines(result);
  return result;
}

/**
 * Reformat only the body section of a vault note (between frontmatter and first ## heading).
 * Used by the batch reformat command.
 */
export function reformatNoteBody(noteContent: string): string | null {
  // Find end of frontmatter
  const fmEnd = noteContent.indexOf('---', noteContent.indexOf('---') + 3);
  if (fmEnd === -1) return null;
  const afterFm = fmEnd + 3;

  // Find first ## heading (enrichment sections)
  const firstHeading = noteContent.indexOf('\n## ', afterFm);
  const bodyEnd = firstHeading !== -1 ? firstHeading : noteContent.length;

  const body = noteContent.slice(afterFm, bodyEnd);
  const reformatted = reformatBody(body);

  if (reformatted === body) return null; // No changes needed

  return noteContent.slice(0, afterFm) + reformatted + noteContent.slice(bodyEnd);
}
