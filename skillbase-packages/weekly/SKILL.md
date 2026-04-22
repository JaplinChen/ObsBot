---
title: /weekly — 每週專案維護
description: 每週一鍵維護：健康檢查 + 依賴審計 + 代碼品質 + 超時保護審計，並行執行，輸出維護報告。
---

# /weekly — 每週專案維護

一週執行一次的維護例行程序，全部並行，快速完成。

## 使用方式

```
/weekly            # 完整週維護
/weekly --dry-run  # 只報告，不執行任何修復
```

---

## 並行執行 4 個維護項目

### 1. 專案健康報告
```bash
npx tsc --noEmit 2>&1 | grep -c "error" || echo 0
find src -name "*.ts" | xargs wc -l | awk '$1>300 {print $2, $1}' | sort -rn | head -5
git log --oneline --since="7 days ago" | wc -l
```

### 2. 依賴審計
```bash
npm outdated 2>/dev/null
npm audit --audit-level=high 2>/dev/null | tail -5
```

### 3. 代碼品質掃描
```bash
# 找殘留調試碼
grep -rn "console\.log\|TODO\|FIXME\|HACK" src/ --include="*.ts" | wc -l

# 找超大函數（超過 50 行的函數）
grep -n "^async function\|^function\|^export function\|^export async function" src/**/*.ts | head -20
```

### 4. 死引用 + 孤立檔案
```bash
# 找未被 import 的 .ts 檔案
find src -name "*.ts" | while read f; do
  name=$(basename "$f" .ts)
  grep -rq "$name" src/ --include="*.ts" && continue
  echo "可能孤立：$f"
done | head -10
```

---

## 輸出報告格式

```
週維護報告 2026-W15

健康          TS: ✅ | 行數超標: 2 個 | 本週 commit: 8
依賴          3 個可更新 | 高危漏洞: 0
代碼品質      調試碼殘留: 5 處 | TODO: 12 條
孤立檔案      1 個可能未使用

建議行動：
1. ⚠️ src/foo.ts (342 行) → /refactor --modularize
2. npm update 更新 3 個依賴
3. 清理 5 處 console.log（非必要）
```

---

## 自動修復（非 dry-run 模式）

- 行數超標 → 僅報告，不自動拆分（需 `/refactor`）
- 依賴更新 → 詢問確認後 `npm update`
- 死引用 → 列出清單讓用戶確認後刪除
