import { describe, expect, it } from 'vitest';
import { canonicalizeUrl } from './url-canonicalizer.js';

describe('canonicalizeUrl', () => {
  it('keeps youtube watch identity and removes tracking params', () => {
    const got = canonicalizeUrl(
      'https://www.youtube.com/watch?v=abc123&utm_source=foo&utm_campaign=bar&t=60',
    );
    expect(got).toBe('https://youtube.com/watch?t=60&v=abc123');
  });

  it('normalizes host and trailing slash', () => {
    const got = canonicalizeUrl('https://www.Example.com/path/');
    expect(got).toBe('https://example.com/path');
  });

  it('keeps non-tracking query params for generic urls', () => {
    const got = canonicalizeUrl('https://example.com/post?id=42&lang=zh&utm_medium=social');
    expect(got).toBe('https://example.com/post?id=42&lang=zh');
  });

  it('keeps selected youtu.be params', () => {
    const got = canonicalizeUrl('https://youtu.be/abc123?list=PL1&utm_source=x');
    expect(got).toBe('https://youtu.be/abc123?list=PL1');
  });
});
