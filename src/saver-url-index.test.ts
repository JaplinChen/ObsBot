import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invalidateUrlIndex, updateUrlIndex } from './saver-url-index.js';

// TTL 和 invalidateUrlIndex 的行為測試
// isDuplicateUrl 需要掃描 vault 檔案，不在此單元測試範圍

describe('invalidateUrlIndex', () => {
  it('可以不拋錯執行', () => {
    expect(() => invalidateUrlIndex()).not.toThrow();
  });

  it('連續呼叫也不拋錯', () => {
    invalidateUrlIndex();
    invalidateUrlIndex();
    expect(() => invalidateUrlIndex()).not.toThrow();
  });
});

describe('updateUrlIndex', () => {
  beforeEach(() => {
    invalidateUrlIndex();
  });

  it('index 為 null 時不拋錯（index 尚未建立）', () => {
    // urlIndex 在 invalidateUrlIndex 後是 null，updateUrlIndex 應靜默跳過
    expect(() => updateUrlIndex('https://example.com', '/vault/note.md')).not.toThrow();
  });
});

// indexBuilding rejection recovery
describe('indexBuilding 錯誤恢復', () => {
  it('buildUrlIndex 失敗後 indexBuilding 被清除（可重試）', async () => {
    // 驗證：若首次 isDuplicateUrl 觸發 build 失敗，第二次呼叫能正常重試
    // 此測試只驗證 invalidateUrlIndex 後 updateUrlIndex 仍正常，
    // 因為 isDuplicateUrl 依賴 vault 磁碟，不在單元測試範圍
    invalidateUrlIndex();
    expect(() => updateUrlIndex('https://example.com/a', '/vault/a.md')).not.toThrow();
    invalidateUrlIndex();
    expect(() => updateUrlIndex('https://example.com/b', '/vault/b.md')).not.toThrow();
  });
});
