// Upstash Redis REST 클라이언트. Vercel KV 와 Upstash 마켓플레이스 연동이
// 각각 다른 이름으로 환경변수를 심어 줘서 둘 다 받는다.
//
// 자격증명이 없으면 enabled=false 가 되고, 호출부는 조용히 아무것도 하지 않는다.
// 카운터가 없다고 사이트가 멈추면 안 된다.

const TIMEOUT_MS = 2500;

/**
 * 자격증명은 부를 때마다 읽는다. 모듈을 불러오는 시점에 한 번만 읽으면
 * 모듈 캐시에 갇혀서, 환경변수를 바꿔도 반영되지 않는다(테스트에서 걸렸다).
 */
function config() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return { url: url.replace(/\/$/, ''), token, enabled: Boolean(url && token) };
}

export const isEnabled = () => config().enabled;

async function post(path, body) {
  const { url, token } = config();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`KV HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 명령 하나. cmd('INCR', 'click:abc') */
export async function cmd(...args) {
  if (!isEnabled()) return null;
  const out = await post('/', args.map(String));
  return out?.result ?? null;
}

/** 명령 여러 개를 한 번에. [['INCR','a'],['GET','b']] */
export async function pipeline(commands) {
  if (!isEnabled() || commands.length === 0) return [];
  const out = await post('/pipeline', commands.map((c) => c.map(String)));
  return Array.isArray(out) ? out.map((o) => o?.result ?? null) : [];
}

export const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 자료 id 형식. 아무 문자열이나 키로 만들어 주지 않기 위한 최소 방어. */
export const isResourceId = (v) =>
  typeof v === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+){0,4}$/.test(v) && v.length <= 48;

/** 오늘 날짜(KST). 방문자 집계 단위. */
export function todayKST() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}
