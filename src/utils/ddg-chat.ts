/**
 * DuckDuckGo AI Chat provider via Camoufox browser (UI interaction).
 * Free, no-login LLM access — navigates to duck.ai, interacts with chat UI.
 *
 * Flow: duck.ai → accept terms → select Claude → type prompt → extract response.
 */
import type { Page } from 'playwright-core';
import { camoufoxPool } from './camoufox-pool.js';

const DUCK_URL = 'https://duck.ai/';
const POLL_INTERVAL_MS = 800;
const STABLE_THRESHOLD = 2; // consecutive polls with same text → done

/** Wrap a promise with a timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Accept the DDG terms overlay if present. */
async function acceptTerms(page: Page): Promise<void> {
  const btn = page.locator('button:has-text("Agree and Continue")');
  if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(800);
  }
}

/**
 * Best-effort: try to switch to Claude via DDG model selector.
 * DDG model options may not be standard <button> elements, so this can fail silently.
 * Enricher applies opencc-js s2tw regardless, so GPT-4o mini output is also acceptable.
 */
async function trySelectClaude(page: Page): Promise<void> {
  try {
    const modelBtn = page.locator('button:has-text("4o-mini")').first();
    if (!await modelBtn.isVisible({ timeout: 1000 }).catch(() => false)) return;

    await modelBtn.click();
    await page.waitForTimeout(600);

    // Model options may be divs, spans, or other non-button elements
    const claudeOpt = page.locator('text=Claude Haiku').first();
    if (await claudeOpt.isVisible({ timeout: 1500 }).catch(() => false)) {
      await claudeOpt.click();
      await page.waitForTimeout(500);

      const startBtn = page.locator('button:has-text("Start New Chat")');
      if (await startBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await startBtn.click();
        await page.waitForTimeout(1000);
      }
    } else {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  } catch {
    // Best-effort — enricher has s2tw fallback
  }
}

/** Capture body text snapshot for diffing. */
async function getBodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
}

/**
 * Send a prompt to DuckDuckGo AI Chat via Camoufox UI interaction.
 * @returns AI response text, or null on any failure.
 */
export async function runViaDdgChat(prompt: string, timeoutMs = 30_000): Promise<string | null> {
  let release: (() => Promise<void>) | null = null;

  try {
    const acquired = await withTimeout(camoufoxPool.acquire(), 15_000, 'pool-acquire');
    release = acquired.release;
    const { page } = acquired;

    // 1. Navigate to duck.ai
    await page.goto(DUCK_URL, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(timeoutMs, 15_000),
    });
    await page.waitForTimeout(1500);

    // 2. Accept terms if shown
    await acceptTerms(page);

    // 3. Best-effort: try to use Claude model
    await trySelectClaude(page);

    // 4. Snapshot text before sending (for diffing later)
    const beforeText = await getBodyText(page);

    // 5. Type prompt and send
    const textarea = page.locator('textarea').first();
    if (!await textarea.isEnabled({ timeout: 3000 }).catch(() => false)) {
      return null; // textarea never became enabled
    }
    await textarea.fill(prompt);
    await page.waitForTimeout(200);
    await textarea.press('Enter');

    // 6. Poll for response — detect new text that wasn't there before
    const deadline = Date.now() + Math.max(timeoutMs - 5000, 15_000);
    let prevResponse = '';
    let stableCount = 0;

    while (Date.now() < deadline) {
      await page.waitForTimeout(POLL_INTERVAL_MS);
      const currentText = await getBodyText(page);

      // Find text that appeared after our prompt
      const promptIdx = currentText.lastIndexOf(prompt);
      if (promptIdx < 0) continue;

      const afterPrompt = currentText.slice(promptIdx + prompt.length).trim();
      // Strip trailing UI elements (model selector, disclaimers)
      const cleaned = stripUiArtifacts(afterPrompt);

      if (!cleaned) continue;

      if (cleaned === prevResponse) {
        stableCount++;
        if (stableCount >= STABLE_THRESHOLD) {
          return cleaned; // Response stabilized → done
        }
      } else {
        prevResponse = cleaned;
        stableCount = 0;
      }
    }

    // Return whatever we got, even if not fully stable
    return prevResponse || null;
  } catch {
    return null;
  } finally {
    if (release) await release();
  }
}

/** Remove DDG UI artifacts from extracted text. */
function stripUiArtifacts(text: string): string {
  // 1. Strip trailing UI elements (disclaimers, model selector, etc.)
  const trailingMarkers = [
    'AI may display inaccurate',
    'Pick a chat model',
    'All models are anonymously',
    'Cancel\nStart New Chat',
    'Created by Anthropic',
    'Created by OpenAI',
    'Created by Meta',
    'Created by Mistral',
  ];
  let result = text;
  for (const marker of trailingMarkers) {
    const idx = result.indexOf(marker);
    if (idx >= 0) result = result.slice(0, idx);
  }

  // 2. Strip leading model labels and UI elements
  const leadingPatterns = [
    /^(?:GPT[^\n]*|4o[^\n]*|mini[^\n]*|Claude[^\n]*|Llama[^\n]*|Mistral[^\n]*)\s*/i,
    /^Copy\s*Code\s*/gi,
  ];
  for (const pat of leadingPatterns) {
    result = result.replace(pat, '');
  }

  // 3. Strip inline "Copy Code" buttons and syntax labels (e.g. "json\n\nCopy Code\n")
  result = result.replace(/\b(?:json|typescript|javascript|python|bash|html|css|xml)\s*\n*Copy\s*Code\s*/gi, '');
  result = result.replace(/\nCopy\s*Code\s*/gi, '\n');

  return result.trim();
}
