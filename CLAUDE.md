# KnowPipe

## 硬規則

- 回覆與 commit message 一律**繁體中文**。Commit 格式：`<type>: <描述>`（feat/fix/refactor/docs/chore）。
- **禁用 API SDK**（無 Anthropic/OpenAI/任何 LLM SDK）。LLM 呼叫走 oMLX REST API（native fetch）或外部 CLI。
- TypeScript 檔案 **≤ 300 行**，超過必須拆分。
- 新功能**整合進現有 pipeline**（extractor → classifier → enricher → reviewer → saver），不另建獨立 command。

## Bot 重啟協議

> **核心原則**：KnowPipe 由 `loop.mjs` supervisor 管理，直接 kill Bot 進程會被自動重啟。**必須先停 loop 父進程。**

### 標準重啟步驟

```bash
# 1. 停 loop（loop 會自動清理子進程和 PID 檔）
kill $(cat .loop.pid 2>/dev/null) 2>/dev/null; pkill -f "loop.mjs" 2>/dev/null; sleep 3

# 2. 確認所有進程已清理
pgrep -f "loop.mjs|tsx.*index|node.*dist/index" && echo "⚠️ 進程仍在" || echo "✅ 已清理"

# 3. TypeScript 編譯確認（有錯誤停止，不要啟動）
npx tsc --noEmit

# 4. 重啟
npm run dev:loop   # dev 模式（tsx 直跑）
# 或
npm run start:loop # prod 模式（需先 npm run build）

# 5. 確認啟動成功（等 8 秒後看 log）
sleep 8 && tail -5 /tmp/knowpipe-launch.log
```

### 常見錯誤
- ❌ `pkill -f "node.*index"` 單獨執行 → loop 3 秒後重啟子進程，問題不解決
- ❌ 改完程式碼直接重啟，沒跑 `tsc --noEmit` → 帶著型別錯誤啟動
- ❌ 在 worktree 目錄重啟 → loop 從 worktree 讀 code，主目錄不生效（hook 會 sync，但要等 commit）

## 踩坑教訓

- 修改 extractor 或 formatter 後，**同時修復** Vault 中受影響的筆記——不要只修 code 不修 output。
- 修改分類器關鍵字後，**必須跑** `/test classify` 回歸測試。注意 substring 陷阱（如 `ads` 匹配 `attachments`）。
- 搬移 Vault 檔案前先 **dry-run**，列出所有變更讓用戶確認。

## 路由索引

> 新任務先對照此表找入口，不確定再往下查代碼。

| 條件 | 優先選擇 |
|------|----------|
| URL 含 `reddit.com` | `reddit-extractor.ts` |
| URL 含 `github.com` | `github-extractor.ts` |
| URL 含 `youtube.com` / `youtu.be` | `youtube-extractor.ts` |
| 標題含「論文」「研究」「arxiv」 | 分類優先 `AI/研究對話` |
| 標題含「wiki」「知識庫」「知識圖」 | 分類優先 `karpathy` 子目錄 |
| 修改 extractor → 需同時驗證 | `formatter.ts` + Vault 受影響筆記 |
| 修改 classifier → 需同時跑 | `/test classify` 回歸 |
| 新增 `/vault` 子指令 → 入口在 | `src/commands/vault-hub.ts` |
| LLM 呼叫 → 統一走 | `src/utils/local-llm.ts` |
| 大型報告寫入 Vault → 統一走 | `src/knowledge/report-saver.ts` |

## 決策日誌

> 重要架構選擇記錄，避免未來重複討論同個問題。

| 日期 | 決策 | 原因 |
|------|------|------|
| 2026-03-30 | Harness = Evaluator + Generator 雙代理 | 品質提升，單代理自評存在 confirmation bias |
| 2026-03-31 | Browser pool 改為 idle 立即清理（原 10 分鐘）| 記憶體佔用過高，4 個 Camoufox 實例常駐不合理 |
| 2026-04-03 | oMLX 預設 port 11435（非 11434）| Homebrew service 預設值，避免與 Ollama 衝突 |
| 2026-04-04 | Karpathy wiki 編譯整合進 `/vault compile` | 不另建指令，符合整合進現有 pipeline 原則 |
| 2026-04-06 | classifier-tuner 只寫入 learned-patterns，不改 classifier-categories.ts | 靜態關鍵字由人工維護，動態學習走 learned-patterns |

## 個人工程原則（決策軌跡）

> 從實際工作中提煉的可重複使用原則。格式：**原則** — 情境 | 原因。
> 新增時機：解決一個有普遍性的問題後，或做了一個非顯而易見的選擇後立即記錄。

| 日期 | 原則 | 情境 | 原因 |
|------|------|------|------|
| 2026-04-14 | 先讀再改，不憑記憶改 | 修改任何現有邏輯前 | 架構細節容易記錯，讀檔再改比重工便宜 |
| 2026-04-14 | 功能旗標 > 條件編譯 | 新功能上線時 | flash tier 跳過 predictions 生成——用運行時條件比修改型別更安全 |
| 2026-04-14 | log 要有上限（slice -N）| 所有成長型 JSON log | corrections-log 每次 append，無限成長最終拖垮 healer 執行 |

## 品質閾值

> 低於閾值時的標準處置行為。

| 指標 | 閾值 | 處置 |
|------|------|------|
| enricher 摘要長度 | < 30 字 | 標記 `pending-review`，不寫入 Vault |
| 分類信心（learned rules）| < 0.75 | 降回靜態關鍵字分類器 |
| wiki 主題筆記數 | < 2 篇 | 跳過，不產出 wiki 文章 |
| classifier-tuner 改善幅度 | < 1% | 不自動套用建議 |
| TypeScript 編譯 | 任何錯誤 | 停止，不 commit |
| 單檔行數 | > 300 行 | 強制拆分後再 commit |

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
