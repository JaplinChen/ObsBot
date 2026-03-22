# GetThreads 專案規則

## Hard Rules（硬規則——絕對不可違反）

### 建置驗證
- 修改任何 `.ts` 檔案後，**必須執行 `npx tsc --noEmit`** 確認零錯誤才算完成。
- Hook 已自動檢查，但手動確認仍為最終標準——不要忽略 hook 輸出的錯誤。
- 所有 TypeScript 檔案 **≤ 300 行**，超過必須拆分。

### 程式碼品質
- **不使用任何 API SDK**（無 Anthropic SDK / OpenAI SDK / 任何 LLM SDK）。LLM 呼叫走外部 CLI。
- **不使用本地 LLM / Ollama**。
- 使用 `import type` 處理純型別引入。
- 避免使用 `any`，除非真的無替代方案。
- 不在同一 commit 做無關重構。

### 架構原則
- 新功能**整合進現有 URL 處理 pipeline**（extractor → classifier → formatter → saver），不另建獨立 command（除非用戶明確要求）。
- 新 extractor 用 `/extractor-scaffold` 腳手架生成，不從零手寫。

### 語言與溝通
- 所有回覆使用**繁體中文**。
- Commit message 格式：`<type>: <描述>`（繁體中文）。
  - type：feat / fix / refactor / docs / chore

### Debug 策略
- 遇到 runtime 問題時，**先診斷、再修復**——不要直接猜測修改。
- 一次只驗證一個假設。
- 不重試相同失敗方法超過 **2 次**。

---

## Guidelines（軟指引——最佳實踐）

### Post-Fix Checklist
- 修改 extractor 或 formatter 後，**必須同時檢查並修復**已存在的 Obsidian vault 筆記。
- 不要只修 code——也要修 output。用修正後的邏輯重新處理受影響的筆記。
- 修復完成後確認：無空白摘要、無壞連結、無 HTML 殘留。

### Classifier / Vault 組織
- 修改分類器關鍵字後，**必須跑回歸測試**（`/test classify`）檢查 false positives。
- 特別注意 **substring 匹配陷阱**（如 `ads` 會匹配 `attachments`）——用 word boundary 或完整比對。
- 搬移檔案前先做 **dry-run**：列出所有檔案的新分類，人工確認後再執行。

### Git Workflow
- 功能完成後，將 commit + push 視為標準流程的一部分（除非用戶另有指示）。
- 功能有顯著變更時，同步更新 README。
- 使用 `/ship` 完成標準提交流程。

### Telegram Bot 管理
- 啟動 Bot 前**必須先檢查現有進程**：`ps aux | grep getthreads`，有舊進程則先 kill。
- Mac 環境使用 **polling mode**（非 webhook）。
- 遇到 **409 Conflict** 錯誤，表示有重複 Bot 實例——先 `kill` 舊進程再重啟。
- 使用 `/launch` skill 管理 Bot 生命週期，不直接跑 `npm run dev &`。

### CLI 模式
- 開發/測試時優先使用 CLI 模式（`npm run cli:fetch <url>`），避免啟動完整 Bot。
- CLI 是無狀態的，不會產生 409 衝突。

### macOS 環境
- 開發環境為 macOS (Apple Silicon)，不使用 Windows 特定命令。
- 路徑分隔符：TypeScript 中用 `path.join()`，Shell 中用正斜線。
- 外部 CLI 工具透過 Homebrew 安裝（opencode、yt-dlp、ffmpeg）。

### 自訂技能規範
- 建立 `.claude/skills/` 下的 SKILL.md 時，**必須包含 YAML frontmatter**（title、description 等）。
- 新技能建立後提醒用戶：**需要重啟 Claude Code** 才會出現在 `/` 選單。
- 技能的 prompt 必須具體、可執行，避免模糊指令。
