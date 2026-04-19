---
title: dev
description: 功能開發全流程：設計確認 → 實作 → 冒煙測試 → 驗證提交，一條龍完成
---

# /dev — 功能開發全流程

整合 `/design` → 實作 → `/test smoke` → `/ship` 的完整開發週期。
用戶只需描述需求，自動引導完成整個流程。

## 使用方式

```
/dev <功能描述>           # 完整流程（設計→實作→測試→提交）
/dev --skip-design <描述>  # 跳過設計（已確認方向，直接實作）
/dev --resume             # 接續上次中斷的開發流程
```

---

## 核心規則

- 每個 Phase 結束必須確認才進入下一步
- 任何 Phase 失敗 → 停止，修復後可用 `--resume` 接續
- 自動追蹤進度（TodoWrite），中斷後可恢復
- 遵守所有子技能的規則（300 行、tsc 零錯誤等）

---

## Phase 1：設計確認（/design 核心邏輯）

### 1.1 需求分析
- 從用戶描述提取：目標、受影響模組、技術約束
- 用 Grep/Glob 掃描相關檔案，確認現有架構

### 1.2 決策表
輸出格式：
```
設計確認

目標：<一句話描述>

| 項目 | 內容 |
|------|------|
| 入口點 | src/xxx.ts |
| 新增檔案 | src/yyy.ts |
| 修改檔案 | src/zzz.ts (+20行) |
| 影響範圍 | extractor, formatter |
| 預估行數 | 各檔案皆 ≤ 300 行 |

方案：<簡述技術方案>
```

### 1.3 確認
詢問用戶：「設計確認，開始實作嗎？」
- 用戶確認 → Phase 2
- 用戶有疑問 → 調整設計
- `--skip-design` → 直接跳到 Phase 2

---

## Phase 2：實作

### 2.1 建立待辦
用 TodoWrite 建立具體任務清單，按修改順序排列。

### 2.2 逐步實作
- 每完成一個檔案 → `npx tsc --noEmit` 驗證
- 每完成一個任務 → TodoWrite 標記 completed
- 新增/修改檔案時檢查行數 ≤ 300 行

### 2.3 實作完成確認
```
實作完成
修改檔案：
  src/xxx.ts (+30, -10)
  src/yyy.ts (85 行)
TypeScript：零錯誤

進入冒煙測試嗎？
```

---

## Phase 3：冒煙測試（/test smoke 核心邏輯）

### 3.1 判斷測試範圍
- 改動 `extractors/` 或 `formatters/` → 執行 `/test smoke`
- 改動 `classifier.ts` → 執行 `/test classify`
- 改動 `search-service.ts` → 搜尋引擎測試
- 其他 → 只跑 TypeScript 編譯 + 行數檢查

### 3.2 執行測試
建立 `smoke-test.ts` 暫存腳本：
```typescript
import { registerAllExtractors } from './src/extractors/index.js';
import { findExtractor } from './src/utils/url-parser.js';
import { classifyContent } from './src/classifier.js';
import { formatAsMarkdown } from './src/formatters/index.js';

registerAllExtractors();
// 對 GitHub URL 執行 extract → classify → format
```

```bash
npx tsx --tsconfig tsconfig.json smoke-test.ts
rm smoke-test.ts
```

### 3.3 測試結果
- 全部通過 → Phase 4
- 失敗 → 回到 Phase 2 修復，修復後重新 Phase 3

---

## Phase 4：驗證提交（/ship 核心邏輯）

### 4.1 驗證（並行）
- TypeScript 編譯
- 行數掃描
- Secrets 掃描
- 死引用檢查
- 調試碼掃描

### 4.2 Commit Message
生成繁體中文 commit message，格式：`<類型>: <描述>`

### 4.3 確認提交
```
/dev 完成報告
設計：已確認
實作：3 個檔案修改
測試：smoke 通過
驗證：全部通過

建議 commit message：
  feat: 新增 Mastodon 平台支援

確認提交嗎？
```

用戶確認 → `git add` + `git commit`

---

## 中斷與恢復

若任何 Phase 中斷（用戶離開、錯誤需要研究等）：
1. 當前進度自動保存在 TodoWrite
2. 下次用 `/dev --resume` 從中斷點繼續
3. 自動偵測上次停在哪個 Phase

---

## 與子技能的關係

| Phase | 對應子技能 | 可單獨使用 |
|-------|----------|-----------|
| 1 | `/design` | 是 |
| 2 | 手動實作 | - |
| 3 | `/test smoke` | 是 |
| 4 | `/ship` | 是 |

`/dev` 是編排層，不重複實作子技能邏輯，而是按順序呼叫。
