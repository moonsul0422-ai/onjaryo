// 조회 카운터 엔드포인트 테스트.
// 배포하지 않고도 확인할 수 있게, Upstash REST 를 흉내 내는 서버를 띄워
// 실제 코드 경로(파이프라인·쿠키 중복 방지·실패 시 무해하게 끝나기)를 검증한다.
//
//   node --test test/api.test.mjs

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

/** 아주 작은 가짜 Upstash. INCR / GET / EXPIRE 만 안다. */
function startFakeKv() {
  const store = new Map();
  const seen = [];
  const run = ([op, key, ...rest]) => {
    seen.push([op, key, ...rest]);
    switch (String(op).toUpperCase()) {
      case 'INCR': {
        const next = (Number(store.get(key)) || 0) + 1;
        store.set(key, next);
        return next;
      }
      case 'GET':
        return store.has(key) ? String(store.get(key)) : null;
      case 'EXPIRE':
        return 1;
      default:
        return null;
    }
  };

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer test-token') {
        res.writeHead(401).end('{}');
        return;
      }
      const parsed = JSON.parse(body || '[]');
      const out = req.url.startsWith('/pipeline')
        ? parsed.map((c) => ({ result: run(c) }))
        : { result: run(parsed) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        store,
        seen,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/** Vercel 의 (req, res) 를 흉내 낸다. */
function fakeRes() {
  const out = { status: 0, body: null, headers: {} };
  const res = {
    setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; },
    status(code) { out.status = code; return res; },
    json(payload) { out.body = payload; return res; },
    end(payload) { if (payload !== undefined) out.body = payload; return res; },
  };
  return { res, out };
}

/** _kv.js 는 로드 시점에 환경변수를 읽는다. 매번 새로 불러온다. */
async function loadHandlers(env) {
  for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN',
                   'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    delete process.env[k];
  }
  Object.assign(process.env, env);
  const bust = `?t=${Date.now()}${Math.random()}`;
  const click = (await import(new URL(`../api/click.js${bust}`, import.meta.url))).default;
  const visit = (await import(new URL(`../api/visit.js${bust}`, import.meta.url))).default;
  return { click, visit };
}

test('카운터가 꺼져 있어도 요청은 무해하게 끝난다', async () => {
  const { click, visit } = await loadHandlers({});

  const a = fakeRes();
  await click({ method: 'POST', body: { id: 'abc-123' }, headers: {} }, a.res);
  assert.equal(a.out.status, 204, '클릭은 조용히 204');

  const b = fakeRes();
  await visit({ method: 'POST', headers: {} }, b.res);
  assert.equal(b.out.status, 200);
  assert.equal(b.out.body.enabled, false, '꺼져 있다고 알린다');
  assert.equal(b.out.body.today, undefined, '0 을 지어내지 않는다');
});

test('클릭은 POST 만 받고 id 형식을 검사한다', async (t) => {
  const kv = await startFakeKv();
  t.after(() => kv.close());
  const { click } = await loadHandlers({
    KV_REST_API_URL: kv.url, KV_REST_API_TOKEN: 'test-token',
  });

  const get = fakeRes();
  await click({ method: 'GET', headers: {} }, get.res);
  assert.equal(get.out.status, 405);
  assert.equal(get.out.headers.allow, 'POST');

  for (const bad of ['../etc', 'UPPER', 'a b', 'x'.repeat(60), '', null, 'a--b']) {
    const r = fakeRes();
    await click({ method: 'POST', body: { id: bad }, headers: {} }, r.res);
    assert.equal(r.out.status, 400, `잘못된 id 거부: ${JSON.stringify(bad)}`);
  }
  assert.equal(kv.seen.length, 0, '거부된 요청은 저장소를 건드리지 않는다');

  const ok = fakeRes();
  await click({ method: 'POST', body: { id: 'jje-260304-k2p' }, headers: {} }, ok.res);
  assert.equal(ok.out.status, 204);
  assert.equal(kv.store.get('click:jje-260304-k2p'), 1);

  // sendBeacon 은 문자열 본문으로 오기도 한다
  const asText = fakeRes();
  await click(
    { method: 'POST', body: JSON.stringify({ id: 'jje-260304-k2p' }), headers: {} },
    asText.res
  );
  assert.equal(asText.out.status, 204);
  assert.equal(kv.store.get('click:jje-260304-k2p'), 2, '문자열 본문도 센다');
});

test('방문자는 하루에 한 번만 센다', async (t) => {
  const kv = await startFakeKv();
  t.after(() => kv.close());
  const { visit } = await loadHandlers({
    KV_REST_API_URL: kv.url, KV_REST_API_TOKEN: 'test-token',
  });

  const first = fakeRes();
  await visit({ method: 'POST', headers: {} }, first.res);
  assert.equal(first.out.body.enabled, true);
  assert.equal(first.out.body.today, 1);
  assert.equal(first.out.body.total, 1);

  const cookie = first.out.headers['set-cookie'];
  assert.ok(/HttpOnly/.test(cookie) && /SameSite=Lax/.test(cookie), `쿠키 속성: ${cookie}`);
  const value = /onjaryo_v=([^;]+)/.exec(cookie)[1];
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/, '쿠키에는 날짜만 담는다');

  // 다른 브라우저
  const second = fakeRes();
  await visit({ method: 'POST', headers: {} }, second.res);
  assert.equal(second.out.body.today, 2);

  // 같은 브라우저가 다시 옴 — 세지 않고 현재 값만 돌려준다
  const again = fakeRes();
  await visit({ method: 'POST', headers: { cookie: `onjaryo_v=${value}` } }, again.res);
  assert.equal(again.out.body.today, 2, '같은 날 재방문은 세지 않는다');
  assert.equal(again.out.body.total, 2);
  assert.equal(again.out.headers['set-cookie'], undefined, '쿠키를 다시 심지 않는다');

  // 어제 쿠키를 들고 오면 다시 센다
  const stale = fakeRes();
  await visit({ method: 'POST', headers: { cookie: 'onjaryo_v=2000-01-01' } }, stale.res);
  assert.equal(stale.out.body.today, 3);

  assert.ok(kv.seen.some(([op]) => op === 'EXPIRE'), '날짜 키에 만료를 건다');
});

test('저장소가 죽어도 사이트는 멀쩡하다', async () => {
  const kv = await startFakeKv();
  const url = kv.url;
  await kv.close(); // 서버를 내려 연결 실패를 만든다

  const { click, visit } = await loadHandlers({
    KV_REST_API_URL: url, KV_REST_API_TOKEN: 'test-token',
  });

  const c = fakeRes();
  await click({ method: 'POST', body: { id: 'abc-123' }, headers: {} }, c.res);
  assert.equal(c.out.status, 204, '클릭 집계 실패는 삼킨다');

  const v = fakeRes();
  await visit({ method: 'POST', headers: {} }, v.res);
  assert.equal(v.out.status, 200);
  assert.equal(v.out.body.enabled, false, '실패하면 숫자를 지어내지 않는다');
});
