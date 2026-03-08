# GetThreads

## 專案說明
GetThreads 是一個 Telegram Bot，接收社群連結後，自動擷取內容、下載圖片/影片、進行分類與摘要，最後存成 Obsidian 可用的 Markdown 筆記。

## 快速開始
1. 安裝依賴
```bash
npm install
```
2. 複製環境變數
```bash
cp .env.example .env
```
3. 設定 `.env`
```env
BOT_TOKEN=your_telegram_bot_token
VAULT_PATH=C:/Users/yourname/ObsidianVault
ALLOWED_USER_IDS=123456789
ENABLE_TRANSLATION=true
MAX_LINKED_URLS=5
```
4. 啟動
```bash
npm run dev
```

## 常用指令
- `npm run dev`: 開發模式
- `npm run build`: 編譯 TypeScript
- `npm run test`: 跑測試
- `npm run lint`: 程式碼檢查

## 支援平台

| 平台 | 擷取 | 評論 | 逐字稿 | 備註 |
|------|:----:|:----:|:------:|------|
| X / Twitter | ✅ | ✅ | — | fxTweet API |
| Threads | ✅ | ✅ | — | Camoufox，無需登入 |
| Reddit | ✅ | ✅ | — | 公開 API，遞迴樹 |
| Bilibili | ✅ | ✅ | — | 公開 API |
| YouTube | ✅ | — | ✅ | yt-dlp，720p mp4 + 自動字幕 |
| TikTok | ✅ | — | ✅ | yt-dlp + whisper.cpp STT |
| GitHub | ✅ | — | — | REST API |
| 微博 | ✅ | — | — | Camoufox |
| 小紅書 | ✅ | — | — | Camoufox，需登入 |
| 抖音 | ✅ | — | — | Camoufox，需登入 |
| 一般網頁 | ✅ | — | — | Jina Reader fallback |

## 摘要產生管線

```
URL → Extractor（擷取內容 + 逐字稿）
   → Classifier（自動分類）
   → AI Enricher（CLI LLM: claude/codex）
   → Formatter（品質守門 + fallback）
   → Saver（Obsidian Markdown 筆記）
```

每篇筆記包含：
- Frontmatter（來源、作者、分類、關鍵字、摘要）
- 正文與連結
- 圖片 / 影片附件
- **重點摘要**（AI 生成或 transcript fallback）
- **內容分析**（AI 生成或結構化摘取）
- **重點整理（條列）**（AI 生成或逐句摘取）

## Telegram 指令
- 傳送 URL → 自動擷取儲存（含評論）
- `/search <查詢>` → 網頁搜尋
- `/monitor <關鍵字>` → 跨平台搜尋提及
- `/timeline @username [數量]` → 抓取用戶最近貼文
- `/recent` → 本次啟動已儲存的內容
- `/status` → Bot 運行狀態
- `/learn` → 重新掃描 Vault 更新分類規則
- `/help` → 顯示說明

## 故障排除
- `yt-dlp is not installed`: 先安裝 `yt-dlp`
- `ffmpeg` 找不到：安裝 `ffmpeg` 並加入 PATH
- TikTok 短連結失敗：先展開成完整 `tiktok.com/@.../video/...` 再重跑
- `409 Conflict`: 前一個 bot 未終止，執行 `taskkill /F /IM node.exe` 後重啟

## 授權
ISC
