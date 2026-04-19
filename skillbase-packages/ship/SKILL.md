---
title: /ship — 驗證 + 提交 + 推送
description: 開發完成一鍵交付：自動偵測修改範圍 → 驗證 → 調試碼掃描 → commit → push，任何驗證失敗自動停止。
---

# /ship — 驗證 + 提交 + 推送

整合驗證、提交、推送的完整交付流程。自動偵測修改範圍，選擇對應驗證路徑。

## 使用方式

```
/ship              # 自動偵測（≥3 檔案 → 深度，<3 → 快速）
/ship --quick      # 強制快速路徑
/ship --deep       # 強制深度路徑（含測試 + 冒煙）
```

## 核心規則

- 任何驗證失敗 → **停止，先修復**
- Commit message 使用繁體中文，格式 `<type>: <描述>`
- 用戶確認後才 commit + push

---

## Phase 1：自動偵測修改範圍

```bash
git diff --stat HEAD
git status --short
```

- 修改 ≥ 3 個 `.ts` → **深度路徑**
- 修改 < 3 個 `.ts` → **快速路徑**
- 改動測試相關檔案 → 強制加入測試回歸

---

## Phase 2A：快速驗證（並行 4 項）

**1. TypeScript 編譯**
```bash
npx tsc --noEmit
```

**2. 行數掃描**
超過 300 行 → ❌ 建議 `/refactor --modularize`

**3. Secrets 掃描**
```bash
grep -rn "API_KEY\s*=\s*['\"][a-zA-Z0-9]" src/ | grep -v "process\.env\|config\|\.env" || echo "✅"
```

**4. 死引用檢查**
```bash
grep -rn "from '\.\." src/ --include="*.ts" -h | sed "s/.*from '//;s/'.*//" | sort -u | while read p; do
  f=$(echo "$p" | sed 's|\.js$|.ts|')
  [ -f "src/$f.ts" ] || [ -f "${f}.ts" ] || echo "MISSING: $p"
done
```

---

## Phase 2B：深度驗證（追加）

先執行 2A，再並行加入：

**5. 測試回歸**（若有 `*.test.ts` 或 `tests/`）：
```bash
npx vitest run 2>/dev/null || npx jest --passWithNoTests 2>/dev/null || echo "無測試框架"
```

**6. 冒煙測試**（若有 `scripts/smoke*.ts`）：
```bash
npx tsx scripts/smoke-test.ts 2>/dev/null || echo "無冒煙測試"
```

---

## Phase 3：調試碼掃描（警告，不阻塞）

```bash
grep -rn "console\.log" src/ --include="*.ts" | grep -v "node_modules"
grep -rn "TODO\|FIXME\|HACK\|XXX" src/ --include="*.ts"
```

---

## Phase 4：暫存與提交

- `git add`（排除 .env、data/、temp/、*.log）
- 繁體中文 commit message：`<type>: <描述>`
  - type：feat / fix / refactor / docs / chore
- 展示完整報告，詢問確認

---

## Phase 5：推送

```bash
git push origin main
```

---

## 輸出摘要

```
✅ /ship 完成（深度模式）

驗證：TypeScript: ✅ | 行數: ✅ | Secrets: ✅ | Import: ✅
調試碼: ✅ 無殘留

變更摘要（N 檔案）：
  ✏️ src/foo.ts (+25, -40)
  🆕 src/bar.ts (+183)

Commit: abc1234 — feat: 描述
Push: ✅ origin/main
```

---

## 失敗處理

| 失敗項目 | 處理方式 |
|---------|---------|
| TypeScript | 修復後重新 `/ship` |
| 行數超標 | `/refactor --modularize` |
| Hardcoded secret | 立即移除 |
| 測試回歸 | 修復對應測試 |
