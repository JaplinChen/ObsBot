---
title: /health — 專案健康快照
description: 10 秒內完成 TypeScript 編譯、行數掃描、Git 狀態、進程、依賴過時檢查，一鍵掌握專案狀態。
---

# /health — 專案健康快照

快速全面的專案健康檢查，並行執行 5 個維度，10 秒內完成。

## 使用方式

```
/health            # 完整健康快照
/health --quick    # 只跑 TypeScript + Git 狀態
```

---

## 並行執行 5 個維度

### 1. TypeScript 編譯
```bash
npx tsc --noEmit 2>&1 | head -20
```
零錯誤 ✅ | 有錯誤 ❌ 列出前 10 條

### 2. 行數掃描（找超標檔案）
```bash
find src -name "*.ts" | xargs wc -l 2>/dev/null | sort -rn | head -10
```
超過 300 行 → ⚠️ 建議拆分

### 3. Git 狀態
```bash
git status --short
git log --oneline -5
```
顯示未提交變更 + 最近 5 個 commit

### 4. 進程狀態
```bash
ps aux | grep "node\|tsx" | grep -v grep | head -5
```
列出當前運行的 Node 進程

### 5. 依賴過時
```bash
npm outdated 2>/dev/null | head -10
```
列出有新版本的依賴

---

## 輸出格式

```
健康快照 2026-04-11 09:00

TypeScript   ✅ 零錯誤（104 個 .ts 檔）
行數掃描     ⚠️ 3 個檔案超過 300 行
Git 狀態     📝 2 個未提交變更 | 最新：feat: ...
進程         🟢 node src/index.ts 運行中
依賴         📦 2 個可更新

建議行動：
- src/foo.ts (342 行) → /refactor --modularize
- 執行 npm update 更新依賴
```

---

## 失敗處理

| 問題 | 行動 |
|------|------|
| TS 錯誤 | 立即修復，不提交 |
| 行數超標 | `/refactor --modularize` |
| 進程意外停止 | 查看日誌 → 重啟 |
