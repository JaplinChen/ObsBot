/**
 * 敏感資訊掃描與遮蔽
 * 在寫入 Vault 前過濾常見的 API Key、Token、私鑰等敏感模式
 */

const PATTERNS: Array<{ re: RegExp; label: string }> = [
  // OpenAI / Anthropic / generic sk- keys
  { re: /\bsk-(?:ant-|proj-)?[a-zA-Z0-9\-_]{20,}(?=[^a-zA-Z0-9\-_]|$)/g, label: 'API_KEY' },
  // GitHub tokens
  { re: /\bghp_[a-zA-Z0-9]{36}\b/g, label: 'GITHUB_TOKEN' },
  { re: /\bgithub_pat_[a-zA-Z0-9_]{82}\b/g, label: 'GITHUB_TOKEN' },
  // AWS Access Key ID
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: 'AWS_KEY' },
  // Google API keys
  { re: /\bAIza[0-9A-Za-z\-_]{35}\b/g, label: 'GOOGLE_KEY' },
  // Telegram bot tokens  (number:alphanumeric 35)
  { re: /\b\d{8,10}:[a-zA-Z0-9_-]{35}\b/g, label: 'BOT_TOKEN' },
  // PEM private key blocks
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, label: 'PRIVATE_KEY' },
  // JWT tokens (three-part base64url)
  { re: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, label: 'JWT' },
];

/**
 * 掃描 markdown 文字，遮蔽所有已知敏感資訊模式。
 * 回傳過濾後的文字，並附帶被遮蔽的項目數量。
 */
export function sanitizeContent(text: string): { result: string; redacted: number } {
  let result = text;
  let redacted = 0;
  for (const { re, label } of PATTERNS) {
    result = result.replace(re, (match) => {
      redacted++;
      return `[REDACTED_${label}]`;
    });
  }
  return { result, redacted };
}
