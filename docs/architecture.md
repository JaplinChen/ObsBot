# Architecture

This document defines the current module boundaries, data flow, and engineering guardrails for GetThreads.

## Runtime Flow

1. `src/index.ts` boots config, extractors, knowledge cache, and process guardian.
2. `src/bot.ts` builds Telegraf bot and registers commands + message handlers.
3. `src/messages/` handles inbound messages:
   - `force-reply-router.ts` rewrites ForceReply input into command text.
   - `url-processing-handler.ts` orchestrates URL pipeline.
   - `services/` contains pure pipeline stages.
4. `src/extractors/` fetches and normalizes platform content into `ExtractedContent`.
5. `src/messages/services/enrich-content-service.ts` classifies, AI-enriches, and post-processes content.
6. `src/messages/services/save-content-service.ts` persists notes/assets via `src/saver.ts`.

## Command Layer

- `src/commands/register-commands.ts`: top-level command wiring and callback action wiring.
- `src/commands/command-help.ts`: help text and menu metadata.
- `src/commands/register-learning-commands.ts`: `/learn`, `/reclassify`, `/translate`.
- `src/commands/register-info-commands.ts`: `/status`, `/recent`.
- `src/commands/command-runner.ts`: common async command wrapper with unified error handling.

## Core Shared Modules

- `src/core/errors.ts`: exception classification and user-facing fallback messages.
- `src/core/logger.ts`: shared structured logging.
- `src/utils/config.ts`: environment parsing and startup validation.
- `src/utils/url-canonicalizer.ts`: canonical URL normalization for dedup and knowledge indexing.

## Data Contracts

- `src/extractors/types.ts` is the system boundary contract for extracted payloads.
- `ExtractedContent` must be fully platform-normalized before entering enrichment/saver.
- Do not introduce platform-specific fields in pipeline modules; extend `ExtractedContent` first.

## Standardization Rules

- No raw `console.*` outside `src/core/logger.ts` and explicit startup UX output.
- Use `formatErrorMessage` for user-facing errors in command/message paths.
- Keep business logic out of registration files; move implementation into service/feature modules.
- Add tests for any changes touching URL normalization, callback payloads, or message pipeline behavior.

## Test Strategy

Current tests cover:
- URL canonicalization
- callback token/payload mapping
- message formatting
- message extract/enrich/save service behavior

Recommended next coverage:
- `src/saver.ts` duplicate/race behavior
- extractor error mapping paths
- command registration smoke tests
