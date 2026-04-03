import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { safeWriteFile, safeWriteJSON, safeReadJSON } from './safe-write.js';

const TEST_DIR = join(process.cwd(), 'data', '__test_safe_write__');

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('safeWriteFile', () => {
  it('寫入檔案內容正確', async () => {
    const path = join(TEST_DIR, 'test.txt');
    await safeWriteFile(path, '測試內容');
    const content = await readFile(path, 'utf-8');
    expect(content).toBe('測試內容');
  });

  it('不留下 .tmp 檔案', async () => {
    const path = join(TEST_DIR, 'test.txt');
    await safeWriteFile(path, '內容');
    await expect(readFile(`${path}.tmp`, 'utf-8')).rejects.toThrow();
  });
});

describe('safeWriteJSON', () => {
  it('寫入有效 JSON', async () => {
    const path = join(TEST_DIR, 'data.json');
    const data = { version: 1, items: ['a', 'b'] };
    await safeWriteJSON(path, data);
    const raw = await readFile(path, 'utf-8');
    expect(JSON.parse(raw)).toEqual(data);
  });
});

describe('safeReadJSON', () => {
  it('讀取有效 JSON', async () => {
    const path = join(TEST_DIR, 'read.json');
    await writeFile(path, JSON.stringify({ key: 'value' }), 'utf-8');
    const result = await safeReadJSON(path, { key: 'default' });
    expect(result).toEqual({ key: 'value' });
  });

  it('檔案不存在回傳預設值', async () => {
    const path = join(TEST_DIR, 'nonexist.json');
    const result = await safeReadJSON(path, { fallback: true });
    expect(result).toEqual({ fallback: true });
  });

  it('檔案損壞時從備份恢復', async () => {
    const path = join(TEST_DIR, 'corrupt.json');
    await writeFile(path, '{broken json...', 'utf-8');
    await writeFile(`${path}.bak`, JSON.stringify({ recovered: true }), 'utf-8');
    const result = await safeReadJSON(path, { recovered: false });
    expect(result).toEqual({ recovered: true });
  });

  it('檔案和備份都損壞時回傳預設值', async () => {
    const path = join(TEST_DIR, 'both-corrupt.json');
    await writeFile(path, '{broken', 'utf-8');
    await writeFile(`${path}.bak`, '{also broken', 'utf-8');
    const result = await safeReadJSON(path, { safe: true });
    expect(result).toEqual({ safe: true });
  });
});
