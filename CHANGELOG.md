# Changelog

All notable changes to KnowPipe are documented here.

Format: [MAJOR.MINOR.PATCH] — YYYY-MM-DD

## [1.0.1] — 2026-04-19

### Fixed

- **URL 索引競態條件**：並發儲存同一 URL 時，第二個呼叫現在等待第一個 Promise 完成，不再重複執行完整儲存流程。`indexBuilding` 失敗後會自動清除，允許下次呼叫重試。
- **原子寫入**：Markdown 筆記改用 `safeWriteFile`（tmp + rename），寫入中途 crash 不會產生損壞的 .md 檔案。
- **圖片下載並發限制**：新增 Semaphore 限制最多 3 個圖片同時下載，防止資源耗盡。
- **錯誤分類優先級**：`classifyError` 現在優先檢查 HTTP 狀態碼（`.status`/`.statusCode`），避免訊息正則誤判。
- **動態 JSON 規則驗證**：`dynamic-classifier` 載入規則前驗證結構，防止格式錯誤的規則檔導致 crash。
- **全局例外保護**：在 `process` 層安裝 `unhandledRejection` 與 `uncaughtException` 處理器，確保靜默失敗寫入 stderr。
- **死碼清理**：移除 `extractPostId` 未使用函式及相關 `void postId` 壓制。靜態化 `import('node:path')` 動態呼叫。

### Changed

- **URL 索引 TTL**：Index 超過 30 分鐘自動失效重建，確保 Vault 手動修改後下次儲存能偵測到變化。
- **檔案大小合規**：`saver.ts`、`patrol-command.ts`、`radar-service.ts`、`classifier-categories.ts` 各拆分為子模組，所有 TypeScript 檔案符合 ≤ 300 行規範。
- **Logger 一致性**：`admin/server.ts` 與 `utils/omlx-client.ts` 的 `console.log/warn/error` 全數改為 `logger`。

### Added

- `src/saver-url-index.ts` — URL 去重索引模組（含 TTL、並發防護、持久化）
- `src/saver-image-downloader.ts` — 圖片下載模組（含 Semaphore 並發限制）
- `src/radar/radar-query.ts` — Radar 查詢邏輯模組（從 radar-service 拆出）
- `src/commands/patrol-extra-commands.ts` — Patrol 擴充指令模組（devil/predictions）
- `src/classifier-categories-general.ts` — 通用分類規則模組（從 classifier-categories 拆出）
- 單元測試覆蓋提升：新增 `saver-url-index.test.ts`、`saver-image-downloader.test.ts` 及 `errors.test.ts` HTTP 狀態碼測試。測試數從 57 增至 68。

## [1.0.0] — Initial release
