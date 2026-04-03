import { describe, it, expect } from 'vitest';
import { classifyError, formatErrorMessage, AppError } from './errors.js';

describe('classifyError', () => {
  it('辨識超時錯誤', () => {
    expect(classifyError(new Error('Request timed out'))).toBe('TIMEOUT');
    expect(classifyError(new Error('AbortError: timeout'))).toBe('TIMEOUT');
  });

  it('辨識認證錯誤', () => {
    expect(classifyError(new Error('Please login first'))).toBe('AUTH_REQUIRED');
    expect(classifyError(new Error('visitor access only'))).toBe('AUTH_REQUIRED');
  });

  it('辨識封鎖錯誤', () => {
    expect(classifyError(new Error('403 Forbidden'))).toBe('FORBIDDEN');
  });

  it('辨識找不到錯誤', () => {
    expect(classifyError(new Error('404 Not Found'))).toBe('NOT_FOUND');
  });

  it('辨識網路錯誤', () => {
    expect(classifyError(new Error('ENOTFOUND api.example.com'))).toBe('NETWORK');
    expect(classifyError(new Error('ECONNREFUSED 127.0.0.1'))).toBe('NETWORK');
    expect(classifyError(new Error('network error'))).toBe('NETWORK');
  });

  it('AppError 直接回傳 code', () => {
    expect(classifyError(new AppError('TIMEOUT', 'custom'))).toBe('TIMEOUT');
  });

  it('未知錯誤歸類為 UNKNOWN', () => {
    expect(classifyError(new Error('something weird'))).toBe('UNKNOWN');
  });
});

describe('formatErrorMessage', () => {
  it('各類錯誤都有繁體中文訊息', () => {
    expect(formatErrorMessage(new Error('timeout'))).toContain('超時');
    expect(formatErrorMessage(new Error('login'))).toContain('登入');
    expect(formatErrorMessage(new Error('403'))).toContain('封鎖');
    expect(formatErrorMessage(new Error('404'))).toContain('找不到');
    expect(formatErrorMessage(new Error('ECONNREFUSED'))).toContain('網路');
  });
});
