# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

KnowPipe is a Telegram Bot that extracts content from 10+ social platforms (X, Threads, Reddit, Bilibili, YouTube, TikTok, GitHub, 微博, 小紅書, 抖音, generic web) and saves it as Markdown notes into an Obsidian Vault. It uses Telegraf, TypeScript/ESM, and a `tsx`-based dev runtime. LLM enrichment is done via an external CLI (OpenCode/Claude/Codex) — no Anthropic/OpenAI SDK is used.

## Commands

```bash
npm run dev          # Start bot in dev mode (tsx, no build step needed)
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled output (requires build first)
npx tsc --noEmit     # Type-check only — MUST pass zero errors after any .ts change
npm run lint         # ESLint
npm run lint:fix     # ESLint with auto-fix
npm run test         # Run all tests (vitest)
npm run test:watch   # Run tests in watch mode
```

Run a single test file:
```bash
npx vitest run -c vitest.config.ts src/path/to/file.test.ts
```

Pre-commit check (all three must pass):
```bash
npm run lint && npm run test && npm run build
```

First-time setup for platforms requiring a browser (Threads, 小紅書, 抖音):
```bash
npx camoufox-js fetch
```

## Architecture

### Boot Sequence

`src/index.ts` boots config, extractors, knowledge cache, and ProcessGuardian → `src/bot.ts` registers Telegraf commands and message handlers.

### URL Processing Pipeline

Incoming URLs flow through:

1. `src/messages/force-reply-router.ts` — rewrites ForceReply inputs into command text
2. `src/messages/url-processing-handler.ts` — orchestrates the full pipeline
3. `src/extractors/<platform>-extractor.ts` — fetches and normalizes platform content into `ExtractedContent` (defined in `src/extractors/types.ts`)
4. `src/messages/services/enrich-content-service.ts` — classifies (`src/classifier.ts`), AI-enriches via LLM CLI, and post-processes
5. `src/messages/services/save-content-service.ts` → `src/saver.ts` — writes Markdown note to the Obsidian Vault

`ExtractedContent` is the **system boundary contract**. It must be fully platform-normalized before entering enrichment or saver. Never introduce platform-specific fields into pipeline modules — extend `ExtractedContent` first.

### Command Layer

- `src/commands/register-commands.ts` — top-level command + callback action wiring (keep this as orchestration only, no business logic)
- `src/commands/command-runner.ts` — shared async wrapper with unified error handling (`runCommandTask`)
- Adding a command: implement logic in `src/commands/<feature>-command.ts`, register via `registerAsyncCommand` / `registerAsyncAction`, use `runCommandTask` + `formatErrorMessage` for all errors

### Core Shared Modules

- `src/core/errors.ts` — exception classification and user-facing fallback messages
- `src/core/logger.ts` — structured logging; **no raw `console.*`** anywhere else in the codebase
- `src/utils/config.ts` — env parsing and startup validation
- `src/utils/url-canonicalizer.ts` — canonical URL normalization for dedup; never reimplement elsewhere
- `src/utils/camoufox-pool.ts` — shared browser pool for login-required platforms (max 2, idle 10 min)

### Formatter Registry

`src/formatters/index.ts` maps platform → formatter. `src/formatters/base.ts` assembles frontmatter + body + stats. Add a new platform formatter here instead of branching inside saver.

### Background Systems

- `src/knowledge/` — entity extraction, knowledge graph, gap analysis, preference model, distillation, memory consolidation
- `src/radar/` — scheduled content search (DDG, GitHub Trending, RSS) → Vault
- `src/proactive/` — scheduled digest + trend keyword alerts pushed to Telegram
- `src/monitoring/` — Vault auto-repair, extractor health probing, enrichment benchmark scoring

Long-running operations (timeline, monitor, learn, reclassify) use fire-and-forget: reply "processing" immediately, run in background, notify on completion.

### Telegram Callback Data

Telegram limits `callback_data` length. Use `buildCallbackData` / `resolveCallbackPayload` from `knowledge-query-command.ts`. Never put long strings directly in `callback_data`.

## Key Rules

- **Type-check after every `.ts` change**: `npx tsc --noEmit` must report zero errors before the task is complete.
- **File size limit**: All TypeScript files ≤ 300 lines. Split overlong files rather than exceeding this.
- **No API SDKs**: Do not add the Anthropic SDK, OpenAI SDK, or equivalent. LLM calls go through the external CLI (`src/utils/local-llm.ts`) with DDG Chat as fallback.
- **Type-only imports**: Use `import type` for type-only imports.
- **No `any`**: Avoid unless there is truly no alternative.
- **New features go into the pipeline**: Integrate into the URL processing pipeline rather than creating standalone commands, unless the user explicitly requests a new command.
- **Post-fix obligation**: After modifying an extractor or formatter, also update affected already-saved Vault notes. After modifying the classifier, run regression tests and watch for substring-matching false positives (e.g. `ads` matching `attachments`).
- **No unrelated refactors in same commit**: Do not refactor unrelated modules in the same commit or PR.
- **Commit messages in Traditional Chinese**: `<type>: <描述>`. Update `README.md` on significant changes.

## Tests

Test files live at `src/**/*.test.ts`. Key files to update when touching related code:
- `src/utils/url-canonicalizer.test.ts` — URL normalization
- `src/commands/knowledge-query-command.test.ts` — callback token/payload mapping
- `src/messages/*.test.ts` and `src/messages/services/*.test.ts` — message pipeline

Always add or update tests when touching URL normalization, callback payloads, or message pipeline behavior.

## Environment

Required `.env` keys (see `.env.example`):
- `BOT_TOKEN` — Telegram Bot Token (from @BotFather)
- `VAULT_PATH` — Absolute path to the Obsidian Vault

Optional:
- `ALLOWED_USER_IDS` — Comma-separated Telegram user IDs (empty = allow all)
- `ENABLE_TRANSLATION` — `true` to enable Simplified → Traditional Chinese translation
- `MAX_LINKED_URLS` — Max external URLs to fetch per post (default: 5)
- `SAVE_VIDEOS` — `false` (default) skips saving videos to Vault
- `LLM_PROVIDER` — `opencode` / `claude` / `codex`

## Troubleshooting

| Symptom | Action |
|---------|--------|
| 409 Telegram Conflict | ProcessGuardian auto-heals (exponential backoff → logOut + cooldown). If persistent, kill the node process manually and restart. |
| tsc errors | Fix before marking task complete — do not skip or suppress. |
| Fetch failure | `curl` the target URL manually to check reachability before modifying extractor logic. |
| File over 300 lines | Split into focused modules before adding more code. |
| Classifier regression | Check for substring-matching false positives; use word boundaries. |
