export type ErrorCode =
  | 'TIMEOUT'
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NETWORK'
  | 'UNKNOWN';

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Extract HTTP status code from error objects that carry one (e.g. fetch Response errors). */
function httpStatusOf(err: unknown): number | null {
  if (err && typeof err === 'object') {
    const status = (err as Record<string, unknown>).status ?? (err as Record<string, unknown>).statusCode;
    if (typeof status === 'number') return status;
  }
  return null;
}

export function classifyError(err: unknown): ErrorCode {
  if (err instanceof AppError) return err.code;

  // HTTP status codes take priority over message-pattern matching
  const status = httpStatusOf(err);
  if (status !== null) {
    if (status === 401 || status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status >= 500) return 'NETWORK';
  }

  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout|timed?\s*out|abort/i.test(msg)) return 'TIMEOUT';
  if (/login|sign.?in|登入|登录|visitor/i.test(msg)) return 'AUTH_REQUIRED';
  if (/403|forbidden|blocked/i.test(msg)) return 'FORBIDDEN';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(msg)) return 'NETWORK';
  if (/404|not.?found/i.test(msg)) return 'NOT_FOUND';
  if (/network/i.test(msg)) return 'NETWORK';
  return 'UNKNOWN';
}

export function formatErrorMessage(err: unknown): string {
  const code = classifyError(err);
  switch (code) {
    case 'TIMEOUT':
      return '抓取超時，請稍後用 /retry 重試。';
    case 'AUTH_REQUIRED':
      return '此平台需要登入才能存取。請確認內容是否公開，或嘗試其他連結。';
    case 'FORBIDDEN':
      return '被平台封鎖，請稍後用 /retry 重試。';
    case 'NOT_FOUND':
      return '找不到此內容，請確認連結是否正確。';
    case 'NETWORK':
      return '網路連線問題，請檢查網路後用 /retry 重試。';
    case 'UNKNOWN':
    default: {
      const msg = err instanceof Error ? err.message : String(err);
      return `處理失敗：${msg.slice(0, 100)}\n可用 /retry 重試。`;
    }
  }
}
