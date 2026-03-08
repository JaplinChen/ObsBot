const DROP_QUERY_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'igshid',
  'ref',
  'ref_src',
  'source',
]);

const TIKTOK_DROP_PARAMS = new Set([
  '_r',
  '_t',
  'is_copy_url',
  'is_from_webapp',
  'sender_device',
  'share_app_id',
  'share_iid',
  'share_link_id',
  'timestamp',
]);

const YOUTUBE_KEEP_PARAMS = new Set(['v', 'list', 'index', 't', 'start']);
const YOUTU_BE_KEEP_PARAMS = new Set(['list', 'index', 't', 'start']);

function normalizePath(pathname: string): string {
  const cleaned = pathname.replace(/\/+$/, '');
  return cleaned || '/';
}

function sortAndJoinParams(params: URLSearchParams): string {
  const pairs = [...params.entries()].sort(([ak, av], [bk, bv]) => {
    if (ak === bk) return av.localeCompare(bv);
    return ak.localeCompare(bk);
  });
  if (pairs.length === 0) return '';
  return pairs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const protocol = u.protocol.toLowerCase();
    const hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = normalizePath(u.pathname);
    const port = u.port && !((protocol === 'https:' && u.port === '443') || (protocol === 'http:' && u.port === '80'))
      ? `:${u.port}`
      : '';

    const filtered = new URLSearchParams();
    const isYoutubeWatch = (hostname === 'youtube.com' || hostname === 'm.youtube.com') && pathname === '/watch';
    const isYoutuBe = hostname === 'youtu.be';
    const isTiktok = hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com');

    for (const [key, value] of u.searchParams.entries()) {
      const lower = key.toLowerCase();
      if (DROP_QUERY_PARAMS.has(lower) || lower.startsWith('utm_')) continue;

      if (isTiktok && TIKTOK_DROP_PARAMS.has(lower)) continue;

      if (isYoutubeWatch) {
        if (YOUTUBE_KEEP_PARAMS.has(lower)) filtered.append(lower, value);
        continue;
      }

      if (isYoutuBe) {
        if (YOUTU_BE_KEEP_PARAMS.has(lower)) filtered.append(lower, value);
        continue;
      }

      filtered.append(key, value);
    }

    const query = sortAndJoinParams(filtered);
    return `${protocol}//${hostname}${port}${pathname}${query ? `?${query}` : ''}`;
  } catch {
    return raw.trim();
  }
}
