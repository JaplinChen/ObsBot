# ObsBot

## 硬規則

- 回覆與 commit message 一律**繁體中文**。Commit 格式：`<type>: <描述>`（feat/fix/refactor/docs/chore）。
- **禁用 API SDK**（無 Anthropic/OpenAI/任何 LLM SDK）。LLM 呼叫走 oMLX REST API（native fetch）或外部 CLI。
- TypeScript 檔案 **≤ 300 行**，超過必須拆分。
- 新功能**整合進現有 pipeline**（extractor → classifier → enricher → reviewer → saver），不另建獨立 command。

## 踩坑教訓

- 修改 extractor 或 formatter 後，**同時修復** Vault 中受影響的筆記——不要只修 code 不修 output。
- 修改分類器關鍵字後，**必須跑** `/test classify` 回歸測試。注意 substring 陷阱（如 `ads` 匹配 `attachments`）。
- 搬移 Vault 檔案前先 **dry-run**，列出所有變更讓用戶確認。

<!-- AUTO-GENERATED-START — 由 scripts/sync-context.ts 自動產生，請勿手動編輯此區段 -->
## 專案即時狀態（自動同步）

> 上次同步：2026-04-03 01:43:54

### 提取器（14 個平台）
bilibili, direct-video, douyin, github, ithome, reddit, threads, tiktok, web, weibo, x, xiaohongshu, youtube, zhihu

### 指令（29 個）
admin, ask, benchmark, code, config, consolidate, dedup, digest, discover, distill, doctor, doctor-upgrade, explore-deep, find, knowledge, knowledge-query, memory-export, monitor, patrol, quality, radar, reformat, reprocess, retry, subscribe, suggest, timeline, toolkit, vsearch

### 處理管線
extractor → classifier → enricher → reviewer (Harness Evaluator→Generator) → saver

### 功能開關
| 功能 | 狀態 |
|------|------|
| translation | 啟用 |
| linkEnrichment | 啟用 |
| imageAnalysis | 啟用 |
| videoTranscription | 啟用 |
| comments | 啟用 |
| proactive | 啟用 |
| monitor | 啟用 |
| wall | 啟用 |
| patrol | 啟用 |
| consolidation | 啟用 |
| qualityReview | 啟用 |

### 近期變更（最近 14 天）
- 1c0c300 fix: 情報牆 AI 洞察強制繁體中文，移除 LLM thinking 輸出
- 30e7095 fix: 卡片中文亂碼 — 改用 Google Fonts web font 取代系統字型
- 6f3deec feat: 產品化功能改善 — 10 項可靠性與使用體驗提升
- 5d1c547 feat: OpenCode 模型改為下拉選單，列出 7 個免費模型可選
- d9b2907 fix: Admin UI 自動帶入 .env 的 API key，用戶不必重新輸入
- 6ae788d fix: oMLX 面板加入 API Key 輸入框，用戶可自行填入並儲存
- e85a492 fix: 模型偵測帶入 API key — 解決 oMLX 401 認證問題
- a2403dc fix: oMLX 預設 port 改為 11435（Homebrew service 預設值）
<!-- AUTO-GENERATED-END -->
