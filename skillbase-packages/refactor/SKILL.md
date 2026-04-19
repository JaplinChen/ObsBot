---
title: refactor
description: 重構全流程：影響分析 → 遷移計畫 → 逐步執行 → 冒煙測試 → 提交，零 regression 保證。含模組化拆分功能。
---

# /refactor — 重構全流程

影響分析 → 遷移計畫 → 逐步執行 → 冒煙測試 → 提交，零 regression 保證。

## 使用方式

```
/refactor <描述>             # 完整流程（分析→計畫→執行→測試→提交）
/refactor --dry-run <描述>   # 僅分析和計畫，不修改檔案
/refactor --resume           # 接續上次中斷的重構
/refactor --modularize       # 掃描超過 300 行的檔案並拆分
```

## 核心規則

- **先分析後行動**，絕不盲改
- 每步完成後 `npx tsc --noEmit`，確保零 regression
- 遷移順序：型別定義 → 生產者 → 消費者
- 任何步驟失敗 → 停止，不繼續
- 遵守 300 行限制，超標自動觸發模組化

---

## Phase 1：影響分析

### 1.1 識別變更目標
從用戶描述確認：要修改的檔案/函數/型別、變更類型（介面、重命名、搬移、刪除、拆分）

### 1.2 建立依賴圖
```bash
grep -rn "from '.*<module>" src/ --include="*.ts"
grep -rn "<TypeName>\|<functionName>" src/ --include="*.ts"
```

### 1.3 輸出影響圖
列出直接影響、間接影響、不受影響的檔案。`--dry-run` 到此停止。

---

## Phase 2：遷移計畫

根據影響圖生成有序步驟，遵循遷移順序原則：
1. **型別定義**先改（types.ts、interfaces）
2. **生產者**次改（extractor 等資料來源）
3. **消費者**最後改（formatter、saver 等下游）

---

## Phase 3：逐步執行

- 用 TodoWrite 追蹤每個步驟
- 每步修改後 `npx tsc --noEmit`
- 每個修改後的檔案檢查行數（> 300 行 → 暫停拆分）

---

## Phase 4：冒煙測試

根據改動範圍自動判斷：
- 改動 extractors/formatters → `/test smoke` 快速模式
- 改動 classifier → `/test classify`
- 改動 search-service → 搜尋引擎測試

---

## Phase 5：提交

TypeScript + 行數 + Secrets + Import 最終驗證 → 繁體中文 commit message → 確認提交。

---

## --modularize 模式（檔案拆分）

掃描並系統性拆分超過 300 行的 TypeScript 檔案。

### 流程

**Step 1：掃描超標檔案**
```bash
find . -name "*.ts" -o -name "*.tsx" | grep -v node_modules | grep -v dist | xargs wc -l | sort -rn | awk '$1 > 300'
```

**Step 2：建立批次計畫**
- 每批 5-8 個檔案，leaf modules 優先
- 跨 package 用 Task 並行處理

**Step 3：抽取標準流程**
1. 讀完整目標檔案，辨識可獨立的邏輯單元
2. 識別抽取候選：獨立 function groups、utility 函式群
3. 檢查依賴：哪些 type/function 需要 export
4. 建立新檔案，遷移程式碼
5. 更新父層 import
6. `npx tsc --noEmit` 驗證
7. 記錄：before 行數 → after 行數

---

## 中斷與恢復

- 進度保存在 TodoWrite
- `/refactor --resume` 從中斷點繼續
- 若中斷在 Phase 3（已部分修改），tsc 可能有錯誤 → 優先修復
