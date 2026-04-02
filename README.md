# ObsBot

**Turn social content into your second brain.**

Drop a link to the Telegram Bot — it auto-extracts articles, comments, images & videos, classifies them, and saves Markdown notes to your Obsidian Vault.

<details>
<summary><strong>Quick Start (Docker)</strong></summary>

```bash
git clone https://github.com/user/obsbot.git && cd obsbot
cp .env.example .env
# Edit .env → set BOT_TOKEN and HOST_VAULT_PATH
docker compose up -d
```

Get your `BOT_TOKEN` from [@BotFather](https://t.me/BotFather) on Telegram. Set `HOST_VAULT_PATH` to your Obsidian vault directory. That's it — send any URL to your bot and it becomes a note.

**Supported platforms:** X / Threads / Reddit / YouTube / GitHub / TikTok / Bilibili / Weibo / Xiaohongshu / Douyin + any webpage.

See [中文文件](#obsbot-1) below for full documentation.

</details>

---

<a id="obsbot-1"></a>

**把社群內容變成你的第二大腦。**

丟一個連結給 Telegram Bot，它會自動抓取文章、評論、圖片與影片，智慧分類後存成 Markdown 筆記到你的 Obsidian Vault。

---

<details>
<summary><strong>為什麼需要 ObsBot？</strong></summary>

你在 Twitter 看到一篇好文、Reddit 上有精彩討論、Threads 上有值得收藏的串文——
但你知道這些內容遲早會消失在時間線裡。

ObsBot 讓你在 Telegram 裡丟一個連結，**3 秒後它就躺在你的 Obsidian 裡了**。
不只文章本體，連底下的評論討論也一起收。

</details>

<details open>
<summary><strong>亮點功能</strong></summary>

#### 內容收集
- **丟連結就存檔** — 穩定支援 X / Threads / Reddit / YouTube / GitHub / TikTok + 通用網頁；中國平台（微博 / B站 / 小紅書 / 抖音）需 Camoufox 登入 Cookie，穩定度視平台封鎖狀態而定
- **智慧分類** — 計分制分類器，自動歸檔到對的 Obsidian 資料夾，支援 20+ 分類 + exclude 防誤判
- **統一搜尋** — `/search` 一個入口搜 Vault 筆記、網頁、跨平台提及、影片字幕
- **內容雷達** — `/radar` 定期自動搜尋關注主題並存入 Vault（支援 DDG / GitHub Trending / RSS / HN / Reddit / Dev.to / 自訂 JSON API；影片連結自動排入非同步轉錄佇列）
- **追蹤系統** — `/track` 時間軸抓取、作者訂閱、多平台巡邏（HN / Reddit / Dev.to / GitHub Trending）
- **連結深度抓取** — 推文中的外部連結自動抓取完整內容，AI 綜合分析產出有深度的筆記

#### 知識系統
- **知識問答** — `/ask` 用 Vault 筆記上下文 + AI 回答問題
- **知識探索** — `/explore` 推薦筆記、知識簡報、深度合成、主題對比
- **知識報告** — `/digest` 精華摘要、週報合成、知識蒸餾、跨筆記洞察
- **知識圖譜** — 實體萃取、關係三元組（compares / builds_on / integrates 等）、缺口分析、Skill 自動生成
- **記憶整合** — 自動發現跨筆記關聯，LLM 語義合成，每週生成整合報告
- **主動推理** — 每日自動推送知識摘要 + 趨勢警報 + 分類提醒

#### Vault 維護
- **品質管理** — `/vault` 統一入口：品質報告（含自動修復按鈕）、重複掃描、AI 重處理、排版修正
- **自我修復** — 排程掃描自動修復 HTML 殘留 / 壞路徑，Extractor 健康探測 + 降級告警；品質評估器自動標記摘要過短 / 關鍵字不足的筆記（`pending-review` tag）
- **影片語意搜尋** — `/vsearch` 用自然語言搜尋 Vault 影片筆記（SQLite FTS5 三元組索引，支援中英文混合查詢）
- **失敗反思系統** — Extractor 失敗自動分類原因（`auth_blocked` / `timeout` / `structure_changed`），重試時輸出診斷日誌
- **相關筆記推薦** — 兩層演算法（實體圖譜 → 關鍵字比對）自動附加 `[[wikilink]]` 連結

#### 系統特性
- **10 個核心指令** — 整併 30+ 子功能，InlineKeyboard 按鈕引導，認知負擔降 65%
- **遠端管理** — `/admin` 狀態、診斷、日誌、重啟、遠端指令，搭配 loop 模式自動恢復
- **多模型智慧路由** — 依複雜度自動選 flash / standard / deep 免費模型；可選 oMLX 本地推理
- **自動降級擷取** — 平台 Extractor 失敗自動 fallback 到通用網頁擷取
- **批次翻譯** — 英文 / 簡中筆記自動翻譯為繁體中文
- **跨裝置同步** — 搭配 [Remotely Save](https://github.com/remotely-save/remotely-save) + [InfiniCLOUD](https://infini-cloud.net/) 免費 WebDAV

</details>

<details>
<summary><strong>支援平台</strong></summary>

### 穩定支援（無需登入）

| 平台 | 內容 | 評論 | 時間軸 | 備註 |
|------|:----:|:----:|:------:|------|
| X / Twitter | ✅ | ✅ | — | fxTweet API |
| Threads | ✅ | ✅ | ✅ | topic tag 自動偵測，智慧標題 |
| Reddit | ✅ | ✅ | — | 公開 API |
| YouTube | ✅ | — | — | yt-dlp 字幕擷取 + 播放清單 |
| GitHub | ✅ | — | — | Repo / Issue / PR |
| TikTok | ✅ | — | — | yt-dlp + whisper.cpp STT 逐字稿 |
| 通用網頁 | ✅ | — | — | 4 層降級（Readability → Camoufox → Browser Use → Regex） |
| PDF 文件 | ✅ | — | — | 直接傳檔到 Telegram |

### 需登入（穩定度視平台封鎖狀態而定）

| 平台 | 內容 | 備註 |
|------|:----:|------|
| Bilibili | ⚠️ | 需 yt-dlp，部分內容需登入 Cookie |
| 微博 | ⚠️ | Camoufox + API，訪客驗證可能阻擋 |
| 小紅書 | ⚠️ | Camoufox，登入牆頻繁，常需更新 Cookie |
| 抖音 / 今日頭條 | ⚠️ | Camoufox，反爬偵測嚴格 |

> ⚠️ 需登入的平台使用 [Camoufox](https://camoufox.com/)（反偵測瀏覽器），需手動維護登入 Cookie。平台封鎖策略頻繁變動，擷取可能間歇性失敗。
> 通用網頁擷取另支援 [Browser Use CLI](https://docs.browser-use.com/open-source/browser-use-cli) 作為 Camoufox 之後的降級方案。

</details>

<details>
<summary><strong>快速開始</strong></summary>

### 1. 申請 Telegram Bot Token

在 Telegram 找 **@BotFather** → 傳送 `/newbot` → 取得 Token（格式：`1234567890:AAFdFMgb...`）

### 2. 安裝

**一般使用者** — 執行 `npm install && cp .env.example .env`，編輯 `.env` 填入設定

**開發者** — 手動設定：

```bash
npm install
cp .env.example .env
```

編輯 `.env`：

```env
# 必填
BOT_TOKEN=your_telegram_bot_token
VAULT_PATH=/Users/yourname/ObsidianVault

# 選填
ALLOWED_USER_IDS=123456,789012      # 限制使用者（逗號分隔 Telegram user ID）
ENABLE_TRANSLATION=true             # 啟用簡轉繁翻譯
MAX_LINKED_URLS=5                   # 單則貼文最多抓取的外部連結數
SAVE_VIDEOS=false                   # 影片存入 Vault（預設 false，僅保留原始連結）
LLM_PROVIDER=opencode                # LLM CLI（預設 OpenCode + MiniMax M2.5 Free，DDG Chat 為備援）
OMLX_BASE_URL=http://localhost:10240/v1  # oMLX 本地推理（選配，優先於 opencode）
OMLX_MODEL=                          # oMLX 模型名稱（如 mlx-community/Qwen2.5-7B-Instruct-4bit）
```

```bash
# Camoufox 初始化（首次，Threads/小紅書/抖音需要）
npx camoufox-js fetch
```

### 3. 啟動

執行 `./start.sh`（或 `npm run dev`），保持終端機開啟即可。

</details>

<details>
<summary><strong>Docker 安裝（推薦）</strong></summary>

3 步即可啟動，無需安裝 Node.js 或其他依賴。

#### 1. 取得原始碼

```bash
git clone https://github.com/user/obsbot.git && cd obsbot
```

#### 2. 設定環境

```bash
cp .env.example .env
```

編輯 `.env`，填入必要設定：

```env
BOT_TOKEN=your_telegram_bot_token      # 必填：Telegram Bot Token
HOST_VAULT_PATH=/path/to/your/vault    # 必填：主機上的 Obsidian Vault 路徑
ALLOWED_USER_IDS=123456                # 選填：限制使用者
```

#### 3. 啟動

```bash
docker compose up -d
```

查看日誌：`docker compose logs -f`
停止：`docker compose down`
重新建置：`docker compose up -d --build`

#### 注意事項

- **oMLX 不可用**：oMLX 是 macOS 本機 LLM，容器內無法使用。AI 功能改用 OpenCode + DDG Chat（免費）
- **Admin UI**：首次啟動可訪問 `http://localhost:3001` 進行設定
- **資料持久化**：`./data/` 目錄會自動建立並保存分類規則、知識庫等狀態

</details>

<details>
<summary><strong>指令速查</strong></summary>

Telegram `/` 選單只顯示 **10 個核心指令**，子功能透過按鈕展開。所有舊指令（`/find`、`/monitor`、`/status` 等）仍可直接使用。

#### 核心指令

| 指令 | 用途 |
|------|------|
| 傳送 URL | 自動擷取內容與評論，分類後存到 Vault |
| 傳送 PDF | 自動擷取文字、AI 摘要、分類存入 Vault |
| `/search` | 統一搜尋入口（按鈕選：Vault / 網頁 / 提及 / 影片） |
| `/ask <問題>` | 用 Vault 知識回答問題（AI 結合筆記上下文） |
| `/explore <主題>` | 知識探索（推薦筆記 / 簡報 / 深度合成 / 對比） |
| `/digest` | 知識報告（精華 / 週報 / 蒸餾 / 跨筆記洞察） |
| `/discover <關鍵字>` | GitHub 專案探索（無參數=每日熱門掃描） |
| `/radar` | 內容雷達（自動搜尋+存入；`add custom` 可接 JSON API 自訂來源） |
| `/track` | 追蹤入口（按鈕選：時間軸 / 訂閱 / 巡邏） |
| `/vault` | Vault 維護入口（品質 / 重複 / 重處理 / 排版 / 基準 / 重試 / 推薦連結） |
| `/admin` | 系統管理入口（狀態 / 健康 / 診斷 / 日誌 / 重啟 / 指令 / 清除 / 學習） |
| `/help` | 分類式說明選單 |

#### 子指令速查

| 統一入口 | 子指令 | 用途 |
|----------|--------|------|
| `/search` | `vault <關鍵字>` | 搜尋 Vault 筆記（frontmatter + 全文） |
| | `web <查詢>` | 網頁搜尋（DuckDuckGo） |
| | `monitor <關鍵字>` | 跨平台搜尋提及 |
| | `video <關鍵字>` | 搜尋影片筆記（章節/轉錄） |
| `/track` | `timeline @用戶 [數量]` | 抓取用戶最近貼文 |
| | `subscribe` | 訂閱管理（查看/新增/移除） |
| | `patrol` | 多平台巡邏（HN/Reddit/Dev.to/GitHub） |
| `/vault` | `quality` | 品質報告 + 自動修復按鈕 |
| | `dedup` | 掃描重複筆記 |
| | `reprocess <路徑>` | 重新 AI 豐富筆記 |
| | `reformat` | 修復排版問題 |
| | `benchmark` | 品質基準報告 |
| | `retry` | 重試失敗連結 |
| | `suggest` | 推薦相關筆記連結 |
| `/admin` | `status` | Bot 狀態與統計 |
| | `health` | 系統健康報告 |
| | `doctor` | 全面即時診斷 |
| | `logs [n]` | 查看最近 log |
| | `restart` | 遠端重啟 Bot |
| | `code <action>` | 遠端執行指令 |
| | `clear` | 清除統計 |
| | `learn` | Vault 學習（分類/翻譯） |

> 所有指令缺參數時會自動引導輸入。統一入口使用 InlineKeyboard 按鈕選擇子功能。

</details>

<details>
<summary><strong>常見問題</strong></summary>

**Bot 沒有回應？**
在終端機按 `Ctrl+C` 停止，再執行 `npm run dev` 重新啟動。

**顯示「409 Conflict」？**
上次 Bot 未正確關閉。程式內建 ProcessGuardian 三段式自癒會自動處理：指數退避重試 → 自動 logOut + 冷卻 → 退出提示。通常無需人工介入。

**抓取超時或失敗？**
所有外部請求皆有超時保護（HTTP 30s / 影片 120s / 存檔 10s）。如果 DuckDuckGo 被限流，搜尋會自動降級到 Camoufox。

**想修改設定？**
編輯 `.env` 檔案即可。

</details>

<details>
<summary><strong>跨裝置同步（選配）</strong></summary>

Vault 預設不儲存影片（`SAVE_VIDEOS=false`），實際大小約數十 MB，非常適合雲端同步。

**推薦方案：[InfiniCLOUD](https://infini-cloud.net/)（免費 20GB WebDAV）+ [Remotely Save](https://github.com/remotely-save/remotely-save) 外掛**

1. 註冊 InfiniCLOUD → My Page → 開啟 **Apps Connection** → 取得 WebDAV 位址與專用密碼
2. Obsidian 安裝 **Remotely Save** 外掛 → Remote Service 選 **WebDAV** → 填入位址、帳號、WebDAV 密碼
3. 建議啟用 **Password-Based Encryption**（E2E 加密）
4. 三台裝置（Windows / Mac / iPhone）使用相同設定，首次同步後即可自動排程

> 其他相容後端：OneDrive、Dropbox、S3、Synology NAS WebDAV。

</details>

<details>
<summary><strong>開發資訊</strong></summary>

### 開發指令

```bash
npm run dev        # 開發模式（tsx 即時執行）
npm run dev:loop   # 開發模式 + 自動重啟（搭配 /restart 指令）
npm run build      # 編譯 TypeScript
npm start          # 生產模式（需先 build）
npm run start:loop # 生產模式 + 自動重啟
npx tsc --noEmit   # 型別檢查
```

### 技術架構

- **TypeScript** + ESM（`tsx` 執行）
- **Telegraf** — Telegram Bot API（10 指令 hub 架構 + InlineKeyboard + ForceReply）
- **Camoufox** — 反偵測瀏覽器（Firefox 基底），處理需 JS 渲染的平台
- **ProcessGuardian** — 三段式 409 自癒（指數退避 → 自動 logOut + 冷卻 → 退出）+ 殭屍進程自動清理
- **OpenCode CLI** + 多模型路由 — 依複雜度自動選 flash（MIMO v2）/ standard（MiniMax M2.5）/ deep（Nemotron 3 Super），全免費；可選 oMLX 本地推理優先
- **知識系統** — 實體萃取、知識圖譜、缺口分析、Skill 自動生成、用戶偏好萃取、知識蒸餾、記憶整合
- 所有長任務（timeline / monitor / learn / reclassify）採 fire-and-forget：先回覆「處理中」→ 背景執行 → 完成通知
- 評論品質篩選：去除讚美/感謝語後不足 10 字的評論自動濾除；Threads 作者回覆感謝訊息不混入主體
- URL 去重快取：避免重複儲存相同內容
- 批次翻譯：opencc-js（簡轉繁）+ Google Translate（英翻中），無需 API key

### Claude Code Skills（開發輔助）

14 個自訂技能，涵蓋開發全流程：

| 類別 | 技能 | 用途 |
|------|------|------|
| 開發流程 | `/design` `/dev` `/ship` `/improve` | 架構確認 → 開發 → 驗證提交推送 → 審計改善 |
| Session | `/resume` `/handoff` | 自動啟動 / 交接記錄 |
| 測試 | `/test` | classify / extractor / smoke / status |
| 重構 | `/refactor` | 影響分析 → 遷移 → 模組化拆分 |
| Vault | `/vault` | 維護 / 修復 / 知識萃取 |
| Bot 管理 | `/launch` | 啟動 / 停止 / 診斷 409 |
| 維護 | `/health` `/weekly` | 即時快照 / 週維護（含依賴檢查） |
| 新平台 | `/new-platform` | 腳手架 → 實作 → 測試 → 提交 |

### 設計原則

- 所有 TypeScript 檔案 **≤ 300 行**
- **不使用任何 API SDK**（無 Anthropic SDK、無 OpenAI SDK）
- LLM enrichment 來源：oMLX 本地推理（選配）→ OpenCode CLI 多模型路由（flash / standard / deep，全免費）→ DDG AI Chat（免費備援）
- Enrichment 輸出過濾廢話與廣告語，保持中性專業語氣；GitHub badge/shield 圖片自動清除
- GitHub 筆記 body 只顯示倉庫描述，README 內容去重至獨立區塊
- Frontmatter 防護：`---` 關閉標記確保獨立成行，防止與後續內容黏合
- 外部呼叫必須有 timeout（HTTP 30s / yt-dlp 120s / Obsidian 10s）
- **輕量 Vault** — 影片預設不存入 Vault（`SAVE_VIDEOS=false`），僅保留原始 URL 連結

### 專案結構

```
src/
├── index.ts                    # 入口（ProcessGuardian 自動重試）
├── bot.ts                      # Telegram Bot（ForceReply 攔截 + URL 處理）
├── classifier.ts               # 內容智慧分類（20+ 分類）
├── saver.ts                    # Obsidian 存檔 + 去重快取
├── process-guardian.ts         # 三段式 409 自癒 + 殭屍清理 + PID lockfile
├── commands/
│   ├── register-commands.ts    # 統一指令註冊 + InlineKeyboard callback
│   ├── search-hub.ts           # /search 統一搜尋入口（vault/web/monitor/video）
│   ├── track-hub.ts            # /track 統一追蹤入口（timeline/subscribe/patrol）
│   ├── vault-hub.ts            # /vault 統一維護入口（7 子功能）
│   ├── admin-hub.ts            # /admin 統一管理入口（8 子功能）
│   ├── knowledge-command.ts    # /knowledge（gaps/skills/analyze 子按鈕）
│   ├── knowledge-query-command.ts # /explore（推薦/簡報/深度合成/對比）
│   ├── digest-command.ts       # /digest（精華/週報/蒸餾/整合）
│   ├── ask-command.ts          # /ask Vault 知識問答
│   ├── discover-command.ts     # /discover GitHub 探索
│   ├── radar-command.ts        # /radar 內容雷達
│   └── *-command.ts            # 各子功能 handler（向後兼容）
├── extractors/                 # 各平台內容擷取器
│   ├── x-extractor.ts          # Twitter/X（fxTweet API）
│   ├── threads-extractor.ts    # Threads（Camoufox，topic tag 偵測）
│   ├── reddit-extractor.ts     # Reddit（公開 API）
│   ├── youtube-extractor.ts    # YouTube（yt-dlp + 播放清單）
│   ├── tiktok-extractor.ts     # TikTok（yt-dlp + whisper.cpp STT）
│   ├── github-extractor.ts     # GitHub（REST API）
│   ├── bilibili-extractor.ts   # B站（公開 API）
│   ├── weibo-extractor.ts      # 微博（API + Camoufox）
│   ├── xiaohongshu-extractor.ts # 小紅書（Camoufox）
│   ├── douyin-extractor.ts     # 抖音（Camoufox）
│   └── web-extractor.ts        # 通用網頁（4 層降級 + 平台失敗自動 fallback）
├── formatters/                 # 按平台分離的 Markdown 格式化
│   ├── index.ts                # Registry：platform → formatter
│   ├── base.ts                 # 組裝器（frontmatter + body + stats）
│   ├── shared.ts               # 共用工具（escape, linkify, 評論品質篩選, badge URL 過濾）
│   ├── x.ts / youtube.ts / ... # 各平台 formatter
│   └── default.ts              # 預設 formatter
├── knowledge/                  # 知識系統
│   ├── knowledge-store.ts      # 知識庫讀寫（vault-knowledge.json）
│   ├── knowledge-aggregator.ts # 統計聚合（Top 實體、洞察排序）
│   ├── knowledge-graph.ts      # 知識圖譜（缺口分析、實體關聯）
│   ├── skill-generator.ts      # 高密度主題 → Skill 自動生成
│   ├── preference-extractor.ts # 用戶偏好模型（零 LLM 純統計）
│   ├── distiller.ts            # 知識蒸餾（核心原則 + 歸檔候選）
│   ├── consolidator.ts         # 記憶整合（跨筆記實體叢集 + LLM 洞察）
│   ├── consolidation-report.ts # 整合報告格式化與 Vault 存檔
│   ├── vault-analyzer.ts       # 增量 Vault 分析（實體萃取 + 關係抽取）
│   ├── entity-classifier.ts    # Heuristic 實體分類（tool/platform/language/concept）
│   ├── relation-extractor.ts   # 關係三元組抽取（6 種關係類型）
│   └── types.ts                # 知識系統型別
├── enrichment/                 # 內容後處理
│   ├── post-processor.ts       # 連結展開、翻譯
│   └── link-enricher.ts        # 連結深度抓取（X Article + Readability）
├── learning/                   # 分類學習與 AI 增強
│   ├── dynamic-classifier.ts   # 動態分類規則快取
│   ├── vault-learner.ts        # Vault 掃描學習
│   ├── learn-command.ts        # /learn 指令
│   ├── ai-enricher.ts          # OpenCode + MiniMax AI 摘要
│   ├── reclassify-command.ts   # 重新分類（由 /learn 按鈕觸發）
│   └── batch-translator.ts     # 批次翻譯（由 /learn 按鈕觸發）
├── radar/                      # 內容雷達（自動搜尋+存入）
│   ├── radar-types.ts          # 型別定義
│   ├── radar-store.ts          # 設定持久化 + 自動查詢生成
│   ├── radar-service.ts        # 背景排程引擎（多來源 → Vault）
│   ├── radar-cycle-utils.ts    # Cycle 摘要建構 + 來源標籤
│   ├── video-queue.ts          # 非同步影片轉錄佇列（5 分鐘輪詢）
│   └── sources/                # 可擴展來源（DDG / GitHub Trending / RSS / HN / Reddit / Dev.to / 自訂 JSON API）
├── patrol/                     # 多平臺巡邏（HN / Reddit / Dev.to / GitHub Trending）
│   ├── patrol-service.ts       # 巡邏引擎（多來源 + AI 評分 + pipeline 整合）
│   ├── patrol-notifier.ts      # Telegram 通知格式化 + inline save buttons
│   ├── relevance-scorer.ts     # oMLX 批次相關性評分
│   ├── patrol-store.ts         # 設定持久化
│   ├── patrol-types.ts         # 型別定義
│   └── sources/                # 巡邏來源（HN Firebase / Reddit JSON / Dev.to API）
├── memory/                     # 使用者偏好記憶
│   ├── memory-store.ts         # JSON 持久化 + 事件追蹤
│   ├── memory-types.ts         # 型別定義
│   └── preference-summarizer.ts # oMLX 偏好摘要生成
├── video/                      # 影片語意搜尋
│   ├── video-index.ts          # Vault 影片索引（章節 + 轉錄解析）
│   └── video-search.ts         # 兩階段搜尋（關鍵字 → AI 排序）
├── plugins/                    # 插件系統
│   ├── plugin-types.ts         # 插件介面定義
│   ├── plugin-loader.ts        # 動態載入 + 註冊
│   └── plugin-context.ts       # 受限 API（fetch / AI / logger）
├── proactive/                  # 主動推理（排程摘要 + 趨勢警報）
│   ├── proactive-service.ts    # 排程推送 digest + 趨勢通知
│   ├── trend-detector.ts       # 關鍵字頻率突增偵測 + 分類缺口
│   ├── proactive-store.ts      # 設定持久化
│   └── proactive-types.ts      # 型別定義
├── monitoring/                 # 自我修復 + 品質基準
│   ├── vault-healer.ts         # Vault 自動修復（HTML/路徑/空行）
│   ├── extractor-probe.ts      # Extractor 健康探測（12 平台全覆蓋）
│   ├── monitor-service.ts      # 排程監控服務
│   ├── benchmark-scorer.ts     # enrichment 品質評分
│   ├── benchmark-store.ts      # 品質資料持久化 + 報告生成
│   └── health-types.ts         # 型別定義
├── vault/                      # Vault 維護工具
│   ├── frontmatter-utils.ts    # 共用 frontmatter 解析
│   ├── link-suggester.ts       # 相關筆記推薦（兩層 fallback）
│   ├── link-writer.ts          # 筆記寫入 + 索引生成
│   └── reprocess-helpers.ts    # 重處理輔助（備份、進度追蹤、fallback 重分類）
└── utils/
    ├── config.ts               # 環境設定
    ├── url-parser.ts           # URL 解析與路由
    ├── force-reply.ts          # ForceReply 標記/解析工具
    ├── fetch-with-timeout.ts   # 帶超時的 HTTP 請求
    ├── search-service.ts       # 搜尋服務（DDG + Camoufox）
    ├── ddg-chat.ts             # DuckDuckGo AI Chat 介面
    ├── local-llm.ts            # LLM 統一入口（oMLX → 多模型路由 → DDG Chat 三層降級）
    ├── vision-llm.ts           # 圖片辨識（OpenCode gpt-5-nano）
    ├── url-canonicalizer.ts    # URL 正規化（去重用）
    ├── ttl-cache.ts            # 通用 TTL 快取（callback token 用）
    ├── camoufox-pool.ts        # 反偵測瀏覽器池（max 4，閒置立即釋放）
    └── chapter-detector.ts     # Whisper 逐字稿合成章節偵測（120 秒窗口）
```

</details>

---

## 貢獻指南

詳見 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。歡迎使用 Claude Code / Codex 等 AI 輔助工具。

## 授權

[ISC License](https://opensource.org/licenses/ISC) — 可自由使用、複製、修改與散布，僅需保留版權聲明。
