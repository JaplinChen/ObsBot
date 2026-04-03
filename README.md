# ObsBot

**An LLM-powered personal knowledge OS.**

Drop a link in Telegram — ObsBot extracts, classifies, enriches, and saves it as an Obsidian note. Then query your vault with AI, generate reports, and let knowledge compound over time. Not a bookmark tool — a full **ingest → compile → query → output** knowledge pipeline, fully automated.

<details>
<summary><strong>Quick Start</strong></summary>

```bash
git clone https://github.com/JaplinChen/ObsBot.git && cd ObsBot
npm install && cp .env.example .env
# Edit .env → set BOT_TOKEN and VAULT_PATH
./start.sh
```

Get your `BOT_TOKEN` from [@BotFather](https://t.me/BotFather) on Telegram. Set `VAULT_PATH` to your Obsidian vault directory. That's it — send any URL to your bot and it becomes a note.

**Supported platforms:** X / Threads / Reddit / YouTube / GitHub / TikTok / Bilibili / Weibo / Xiaohongshu / Douyin / Zhihu / iTHome + any webpage.

See [中文文件](#obsbot-1) below for full documentation.

</details>

---

<a id="obsbot-1"></a>

**LLM 驅動的個人知識作業系統。**

丟一個連結給 Telegram Bot，它會自動抓取、AI 分類、摘要豐富化、存入 Obsidian — 然後你可以對知識庫提問、生成報告、追蹤趨勢。知識不只是被收藏，而是被編譯、連結、持續增值。

---

<details>
<summary><strong>為什麼需要 ObsBot？</strong></summary>

你在 Twitter 看到一篇好文、Reddit 上有精彩討論、Threads 上有值得收藏的串文——
但你知道這些內容遲早會消失在時間線裡。

傳統做法是「人寫、機器讀」。ObsBot 反過來：**機器寫、人審閱**。

每次擷取都自動豐富化——AI 摘要、實體萃取、智慧分類。每次查詢的結果都回流知識庫——探索 → 沉澱 → 再探索，形成知識複利。你的 Vault 不是靜態筆記堆，而是一個持續成長的知識體。

</details>

<details open>
<summary><strong>架構哲學：知識流水線</strong></summary>

ObsBot 的設計圍繞一條完整的知識生命週期，從原始資料到可操作的知識：

```
攝取 ──→ 編譯 ──→ 查詢 ──→ 輸出 ──→ 自癒
Ingest   Compile   Query    Output    Lint
  ↑                                    │
  └────────── 知識複利閉環 ←───────────┘
```

| 階段 | ObsBot 做了什麼 | 指令 |
|------|-----------------|------|
| **攝取 Ingest** | 14 平台 Extractor + PDF + 通用網頁 + 雷達自動搜尋 + 多平台巡邏，全自動攝取 | 丟連結 / `/radar` / `/track` |
| **編譯 Compile** | 108 規則智慧分類 → AI 摘要 + 翻譯 → 實體萃取 + 知識圖譜 → 關係三元組 + Skill 生成 | 自動 / `/knowledge` / `/compile` |
| **查詢 Query** | Vault 知識問答、主題探索、深度合成、對比分析、語意搜尋、互動式研究 | `/ask` / `/explore` / `/research` |
| **輸出 Output** | 精華摘要 / 週報 / PPTX 簡報 / Anki 記憶卡 / PNG 資訊卡 / 趨勢警報，結果回流 Vault | `/digest` / `/slides` / `/anki` |
| **自癒 Lint** | 品質審查 + HTML 殘留修復 + 重複掃描 + Extractor 健康探測 + 失敗反思日誌 | `/vault` / 自動排程 |

</details>

<details>
<summary><strong>功能一覽</strong></summary>

#### 攝取（Ingest）
- **丟連結就存檔** — 穩定支援 14 個平台 + 通用網頁；中國平台需 Camoufox 登入 Cookie
- **連結深度抓取** — 推文中的外部連結自動抓取完整內容，AI 綜合分析產出有深度的筆記
- **內容雷達** — `/radar` 定期自動搜尋關注主題並存入 Vault（DDG / GitHub Trending / RSS / HN / Reddit / Dev.to / 自訂 JSON API）
- **追蹤系統** — `/track` 時間軸抓取、作者訂閱、多平台巡邏

#### 編譯（Compile）
- **智慧分類** — 計分制分類器，108 條規則覆蓋 24 大類（含 13 個 AI 子領域），支援 exclude 防誤判 + 動態學習
- **AI 豐富化** — 自動摘要、關鍵字萃取、圖片辨識、影片轉錄
- **知識圖譜** — 實體萃取、關係三元組（compares / builds_on / integrates 等）、缺口分析、Skill 自動生成
- **記憶整合** — 自動發現跨筆記關聯，LLM 語義合成，每週生成整合報告
- **批次翻譯** — 英文 / 簡中筆記自動翻譯為繁體中文

#### 查詢（Query）
- **知識問答** — `/ask` 用 Vault 筆記上下文 + AI 回答問題
- **知識探索** — `/explore` 推薦筆記、知識簡報、深度合成、主題對比
- **統一搜尋** — `/search` 一個入口搜 Vault 筆記、網頁、跨平台提及、影片字幕
- **影片語意搜尋** — `/vsearch` FTS5 三元組索引，支援中英文混合查詢
- **研究助理** — `/research` 互動式研究對話

#### 輸出（Output）
- **知識報告** — `/digest` 精華摘要、週報合成、知識蒸餾、跨筆記洞察
- **簡報生成** — `/slides` 自動產生 PPTX 簡報
- **記憶卡** — `/anki` 生成 Anki 記憶卡
- **資訊卡片** — 每則筆記自動生成視覺化 PNG 摘要卡
- **主動推理** — 每日自動推送知識摘要 + 趨勢警報 + 分類提醒
- **相關筆記推薦** — 兩層演算法（實體圖譜 → 關鍵字比對）自動附加 `[[wikilink]]` 連結

#### 自癒（Lint）
- **品質管理** — `/vault` 統一入口：品質報告（含自動修復按鈕）、重複掃描、AI 重處理、排版修正
- **自我修復** — 排程掃描自動修復 HTML 殘留 / 壞路徑，Extractor 健康探測 + 降級告警
- **失敗反思系統** — Extractor 失敗自動分類原因（`auth_blocked` / `timeout` / `structure_changed`），重試時輸出診斷日誌

#### 系統
- **10 個核心指令 + 32 個完整指令** — InlineKeyboard 按鈕引導
- **遠端管理** — `/admin` 狀態、診斷、日誌、重啟、遠端指令
- **Admin Web UI** — `http://localhost:3001` 即時儀表板、功能設定、多語系介面
- **Guardian Console** — `http://localhost:3199` 進程守護儀表板，監控本地 AI runtime 記憶體壓力、自動重啟、macOS LaunchAgent 開機自動運行
- **多模型智慧路由** — 依複雜度自動選 flash / standard / deep 免費模型；可選 oMLX 本地推理
- **功能開關** — `/config` 即時切換 11 項功能
- **跨裝置同步** — 搭配 [Remotely Save](https://github.com/remotely-save/remotely-save) + [InfiniCLOUD](https://infini-cloud.net/) 免費 WebDAV

</details>

<details>
<summary><strong>支援平台（14 個）</strong></summary>

### 穩定支援（無需登入）

| 平台 | 內容 | 評論 | 時間軸 | 備註 |
|------|:----:|:----:|:------:|------|
| X / Twitter | ✅ | ✅ | — | fxTweet API |
| Threads | ✅ | ✅ | ✅ | topic tag 自動偵測，智慧標題 |
| Reddit | ✅ | ✅ | — | 公開 API |
| YouTube | ✅ | — | — | yt-dlp 字幕擷取 + 播放清單 |
| GitHub | ✅ | — | — | Repo / Issue / PR |
| TikTok | ✅ | — | — | yt-dlp + whisper.cpp STT 逐字稿 |
| iTHome | ✅ | — | — | 台灣科技新聞 |
| 通用網頁 | ✅ | — | — | 4 層降級（Readability → Camoufox → Browser Use → Regex） |
| PDF 文件 | ✅ | — | — | 直接傳檔到 Telegram |
| 直連影片 | ✅ | — | — | MP4 / WebM / MKV 直連下載 + 轉錄 |

### 需登入（穩定度視平台封鎖狀態而定）

| 平台 | 內容 | 備註 |
|------|:----:|------|
| Bilibili | ⚠️ | 需 yt-dlp，部分內容需登入 Cookie |
| 微博 | ⚠️ | Camoufox + API，訪客驗證可能阻擋 |
| 小紅書 | ⚠️ | Camoufox，登入牆頻繁，常需更新 Cookie |
| 抖音 / 今日頭條 | ⚠️ | Camoufox，反爬偵測嚴格 |
| 知乎 | ⚠️ | Camoufox，需登入才能完整擷取 |

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
OMLX_API_KEY=                        # oMLX 本地推理（選配，需 macOS Apple Silicon）
```

```bash
# Camoufox 初始化（首次，Threads/小紅書/抖音需要）
npx camoufox-js fetch
```

### 3. 啟動

執行 `./start.sh`（或 `npm run dev`），保持終端機開啟即可。

</details>

<details>
<summary><strong>指令速查（32 個指令）</strong></summary>

Telegram `/` 選單只顯示 **10 個核心指令**，子功能透過按鈕展開。所有指令都可直接輸入使用。

#### 核心指令（選單顯示）

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

#### 所有指令一覽

| 類別 | 指令 | 用途 |
|------|------|------|
| **搜尋** | `/search` | 統一搜尋（Vault / 網頁 / 提及 / 影片） |
| | `/find <關鍵字>` | 快速搜尋 Vault 筆記 |
| | `/monitor <關鍵字>` | 跨平台提及搜尋 |
| | `/vsearch <關鍵字>` | 影片語意搜尋（FTS5） |
| **知識** | `/ask <問題>` | Vault 知識問答 |
| | `/explore <主題>` | 知識探索（推薦 / 簡報 / 合成 / 對比） |
| | `/digest` | 知識報告（精華 / 週報 / 蒸餾 / 整合） |
| | `/knowledge` | 知識圖譜（缺口 / 技能 / 分析 / 健康） |
| | `/compile` | 知識編譯（分析 + 技能生成） |
| | `/research` | 互動式研究對話 |
| | `/slides` | AI 自動生成簡報（PPTX） |
| | `/anki` | 生成 Anki 記憶卡 |
| **追蹤** | `/track` | 統一追蹤入口（時間軸 / 訂閱 / 巡邏） |
| | `/timeline @用戶` | 抓取用戶最近貼文 |
| | `/subscribe` | 訂閱管理（查看 / 新增 / 移除） |
| | `/patrol` | 多平台巡邏（HN / Reddit / Dev.to / GitHub） |
| **發現** | `/discover <關鍵字>` | GitHub 專案探索 |
| | `/radar` | 內容雷達（多來源自動搜尋） |
| | `/suggest` | 推薦相關筆記連結 |
| **Vault** | `/vault` | 統一維護入口（7 子功能） |
| | `/quality` | 品質報告 + 自動修復 |
| | `/dedup` | 重複筆記掃描 |
| | `/reprocess <路徑>` | 重新 AI 豐富筆記 |
| | `/reformat` | 修復排版問題 |
| | `/benchmark` | 品質基準報告 |
| | `/retry` | 重試失敗連結 |
| **系統** | `/admin` | 統一管理入口（8 子功能） |
| | `/config` | 功能開關即時切換 |
| | `/toolkit` | 開發工具箱 |
| | `/memory` | 匯出學習記憶 |
| | `/skillmgr` | AI 技能管理 |

> 所有指令缺參數時會自動引導輸入。統一入口使用 InlineKeyboard 按鈕選擇子功能。

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

</details>

<details>
<summary><strong>Guardian Console（本地 AI Runtime 守護器）</strong></summary>

ObsBot 內建一個可獨立啟動的本地 AI runtime 守護器，專門處理像 oMLX 這類長時間運行服務的記憶體暴衝、重啟與通知問題。

功能包含：

- **本地 dashboard** — 顯示 RSS、swap、事件與最近重啟紀錄
- **策略引擎** — 連續超標才重啟，避免瞬間尖峰誤判
- **macOS 通知** — 超標、冷卻、重啟成功或失敗都會通知
- **HTTP API** — 可擴充 menubar app、外部控制面板或 webhook
- **`launchd` 安裝器** — 可直接掛成背景常駐服務

### 啟動方式

**方法一：手動啟動（前景執行）**

```bash
npm run guardian:start
```

啟動後終端會顯示 `Guardian console running at http://127.0.0.1:3199`。

**方法二：安裝為 macOS 背景服務（推薦）**

```bash
npm run guardian:install-agent
```

安裝後 Guardian 會以 `ObsBot-Guardian` 名稱註冊為 macOS LaunchAgent，開機自動啟動、當機自動重啟。可在「系統設定 → 一般 → 登入項目」中查看。

### 查看 Dashboard

瀏覽器開啟 **http://127.0.0.1:3199** 即可看到即時儀表板，包含：

- 各服務記憶體用量（RSS / Swap）與趨勢圖
- 健康狀態標籤（Healthy / Warning / Restarting / Paused）
- 最近事件紀錄（重啟、超標、冷卻等）
- 操作按鈕 — 可直接在頁面上重啟、暫停或恢復監控

### 其他指令

```bash
npm run guardian:check     # 手動檢查一次（不啟動常駐）
npm run guardian:status    # 輸出當前狀態 JSON
```

設定檔位置：`data/guardian-config.json`

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
編輯 `.env` 檔案，或在 Telegram 使用 `/config` 即時切換功能開關。

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
npm test           # 執行測試（Vitest）
npm run lint       # ESLint 檢查
npm run format     # Prettier 排版
```

### 知識流水線實作

```
攝取                 編譯                    查詢               輸出
Ingest               Compile                 Query              Output
─────────────        ──────────────          ─────────────      ──────────────
14 平台 Extractor    108 規則分類器          /ask 知識問答      /digest 週報
+ PDF / 通用網頁     + AI 摘要 + 翻譯       /explore 探索      /slides 簡報
+ /radar 雷達        + 實體萃取              /research 研究     /anki 記憶卡
+ /track 巡邏        + 知識圖譜建構          /vsearch 語意搜    PNG 資訊卡
+ 連結深度抓取       + 動態學習              /search 統一搜     主動推理推送
                     + 記憶整合                                 wikilink 推薦
                                        自癒 Lint
                                        ──────────────
                                        Vault 品質審查
                                        HTML 自動修復
                                        Extractor 健康探測
                                        失敗反思 + 重試
```

### 技術架構

- **TypeScript** + ESM（`tsx` 執行），281 個檔案 / 31,670 行
- **Telegraf** — Telegram Bot API（10 指令 hub 架構 + InlineKeyboard + ForceReply）
- **Camoufox** — 反偵測瀏覽器（Firefox 基底），瀏覽器池最多 4 實例，閒置立即釋放
- **ProcessGuardian** — 三段式 409 自癒（指數退避 → 自動 logOut + 冷卻 → 退出）+ 殭屍進程自動清理
- **Guardian Console** — 獨立 AI runtime 守護器，策略引擎監控 + macOS 通知 + HTTP API + launchd 安裝
- **OpenCode CLI** + 多模型路由 — 依複雜度自動選 flash / standard / deep 免費模型；可選 oMLX 本地推理優先
- **知識系統** — 實體萃取、知識圖譜、缺口分析、Skill 自動生成、用戶偏好萃取、知識蒸餾、記憶整合、MOC 生成
- **研究助理** — 互動式研究對話、PPTX 簡報生成、Anki 記憶卡、壓縮快取、資源管理
- **資訊卡片** — 每則筆記自動生成 PNG 視覺摘要卡（標題 / 分類 / 關鍵字 / 分類色系）
- **分類系統** — 24 個分類模組、108 條規則（含 13 個 AI 子領域）+ 動態學習
- 所有長任務採 fire-and-forget：先回覆「處理中」→ 背景執行 → 完成通知
- 評論品質篩選：去除讚美/感謝語後不足 10 字的評論自動濾除
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
- Frontmatter 防護：`---` 關閉標記確保獨立成行，防止與後續內容黏合
- 外部呼叫必須有 timeout（HTTP 30s / yt-dlp 120s / Obsidian 10s）
- **輕量 Vault** — 影片預設不存入 Vault（`SAVE_VIDEOS=false`），僅保留原始 URL 連結

### 專案結構

```
src/
├── index.ts                    # 入口（ProcessGuardian 自動重試）
├── bot.ts                      # Telegram Bot（ForceReply 攔截 + URL 處理）
├── classifier.ts               # 內容智慧分類（108 規則 × 24 大類）
├── saver.ts                    # Obsidian 存檔 + 去重快取
├── process-guardian.ts         # 三段式 409 自癒 + 殭屍清理 + PID lockfile
├── categories/                 # 分類規則（24 模組）
│   ├── index.ts                # 匯總所有分類
│   ├── ai-*.ts                 # 13 個 AI 子領域分類
│   └── *.ts                    # 11 個通用分類（科技/程式/財經/設計…）
├── cards/                      # 資訊卡片
│   ├── card-renderer.ts        # PNG 卡片渲染引擎
│   └── card-templates.ts       # 卡片版型（標題/分類/關鍵字/色系）
├── commands/                   # 指令處理（32 指令 + InlineKeyboard）
│   ├── register-commands.ts    # 統一指令註冊 + callback 路由
│   ├── *-hub.ts                # 4 個統一入口（search/track/vault/admin）
│   └── *-command.ts            # 各功能 handler
├── extractors/                 # 各平台內容擷取器（14 平台）
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
│   ├── zhihu-extractor.ts      # 知乎（Camoufox）
│   ├── ithome-extractor.ts     # iTHome（台灣科技新聞）
│   ├── direct-video-extractor.ts # 直連影片（MP4/WebM/MKV）
│   └── web-extractor.ts        # 通用網頁（4 層降級 + 自動 fallback）
├── formatters/                 # 按平台分離的 Markdown 格式化
│   ├── base.ts                 # 組裝器（frontmatter + body + stats）
│   ├── shared.ts               # 共用工具（評論品質篩選, badge 過濾）
│   └── *.ts                    # 各平台 formatter
├── guardian/                   # AI Runtime 守護器
│   ├── service.ts              # 守護服務主邏輯
│   ├── policy-engine.ts        # 策略引擎（連續超標才重啟）
│   ├── dashboard-html.ts       # Web 儀表板
│   └── install-agent.ts        # launchd 安裝器
├── knowledge/                  # 知識系統
│   ├── knowledge-store.ts      # 知識庫讀寫
│   ├── knowledge-graph.ts      # 知識圖譜（缺口分析、實體關聯）
│   ├── skill-generator.ts      # 高密度主題 → Skill 自動生成
│   ├── distiller.ts            # 知識蒸餾
│   ├── consolidator.ts         # 記憶整合（跨筆記叢集 + LLM 洞察）
│   ├── moc-generator.ts        # Maps of Content 自動生成
│   ├── vault-analyzer.ts       # 增量 Vault 分析（實體萃取 + 關係抽取）
│   └── health-report.ts        # 知識健康報告
├── research/                   # 研究助理
│   ├── research-commands.ts    # /research /slides /anki 指令
│   ├── chat-service.ts         # 互動式研究對話引擎
│   ├── slide-pptx.ts           # PPTX 簡報生成
│   └── research-ui.html        # 研究介面 Web UI
├── enrichment/                 # 內容後處理（連結展開、翻譯）
├── learning/                   # 分類學習與 AI 增強
├── radar/                      # 內容雷達（多來源自動搜尋 → Vault）
├── patrol/                     # 多平臺巡邏（HN / Reddit / Dev.to / GitHub）
├── admin/                      # Admin Web UI（port 3001）
├── memory/                     # 使用者偏好記憶
├── video/                      # 影片語意搜尋（FTS5）
├── plugins/                    # 插件系統（動態載入）
├── proactive/                  # 主動推理（排程摘要 + 趨勢警報）
├── monitoring/                 # 自我修復 + 品質基準
├── vault/                      # Vault 維護工具
└── utils/                      # 共用工具（LLM 路由 / 搜尋 / 快取 / 瀏覽器池）
```

</details>

---

## 貢獻指南

詳見 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。歡迎使用 Claude Code / Codex 等 AI 輔助工具。

## 授權

[ISC License](https://opensource.org/licenses/ISC) — 可自由使用、複製、修改與散布，僅需保留版權聲明。
