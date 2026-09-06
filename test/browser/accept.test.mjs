// 브라우저 테스트.  playwright-core 와 크로미움이 필요하다.
//
//   npm run build && npx astro preview --port 4321 &
//   npm i --no-save playwright-core
//   npm run test:browser
//
// BASE_URL, CHROME_PATH 로 대상과 실행 파일을 바꿀 수 있다.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const BASE = process.env.BASE_URL || 'http://localhost:4321';
const EXE = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const enc = encodeURIComponent;

const PAGES = [
  ['홈', '/'],
  ['상세', '/r/jje-260304-k2p/'],
  ['영역', `/topic/${enc('디지털·AI')}/`],
  ['학교급', `/level/${enc('초등')}/`],
  ['기관', '/org/serii/'],
  ['태그', `/tag/${enc('안전교육')}/`],
  ['검색', '/search/'],
  ['소개', '/about/'],
  ['제보', '/submit/'],
];

const browser = await chromium.launch({ executablePath: EXE });
/** 외부 폰트 CDN 은 테스트에 필요 없다. 막아 두면 networkidle 이 빨리 끝나고
 *  결과가 네트워크 상태에 흔들리지 않는다. */
async function blockExternal(ctx) {
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    return route.abort();
  });
}

const fails = [];
const check = (name, cond, detail = '') => {
  if (cond) return;
  fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
};

/* ---- 1. 자바스크립트를 끈 상태 ---- */
{
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1100, height: 900 } });
  await blockExternal(ctx);
  const page = await ctx.newPage();
  for (const [name, path] of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    const text = (await page.locator('main').innerText()).trim();
    const links = await page.locator('main a[href]').count();
    if (path === '/search/') {
      // 검색만 JS 를 요구한다. 대신 안내와 분류 경로가 보여야 한다.
      check('무JS 검색 안내', /자바스크립트/.test(text), '안내문 없음');
      check('무JS 검색 분류 경로', links >= 20, `링크 ${links}개`);
      check('무JS 검색앱 숨김', !(await page.locator('#search-app').isVisible()), '검색 UI가 그대로 보임');
      continue;
    }
    check(`무JS ${name} 본문`, text.length > 200, `본문 ${text.length}자`);
    // 목록·상세는 다음 갈 곳이 본문 안에 있어야 한다.
    // 소개·제보는 읽는 페이지라 본문 링크가 적은 게 정상이다.
    if (!['소개', '제보'].includes(name)) {
      check(`무JS ${name} 링크`, links > 3, `링크 ${links}개`);
    }
  }
  // 목록이 실제로 서버에서 그려졌는가
  await page.goto(`${BASE}/topic/${enc('안전')}/`, { waitUntil: 'domcontentloaded' });
  const cards = await page.locator('.rlist > li').count();
  check('무JS 목록 카드', cards > 0, `카드 ${cards}개`);
  await page.goto(`${BASE}/r/jje-260304-k2p/`, { waitUntil: 'domcontentloaded' });
  check('무JS 상세 원문링크', await page.locator('a.btn[href^="https://"]').count() > 0);
  await page.goto(`${BASE}/submit/`, { waitUntil: 'domcontentloaded' });
  const submitText = await page.locator('main').innerText();
  check('무JS 제보 안내', /원문 주소/.test(submitText) && /영역/.test(submitText), '제보 안내가 안 읽힘');
  console.log('1. 자바스크립트 끈 상태 — 확인');
  await ctx.close();
}

/* ---- 2. 360px 가로 스크롤 ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2 });
  await blockExternal(ctx);
  const page = await ctx.newPage();
  for (const [name, path] of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const m = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      widest: (() => {
        let worst = null;
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.right > document.documentElement.clientWidth + 1) {
            if (!worst || r.right > worst.right) {
              worst = { right: Math.round(r.right), tag: el.tagName, cls: el.className?.toString().slice(0, 40) };
            }
          }
        }
        return worst;
      })(),
    }));
    check(`360px ${name}`, m.scroll <= m.client + 1,
      `scrollWidth ${m.scroll} > clientWidth ${m.client}${m.widest ? ` · ${m.widest.tag}.${m.widest.cls} right=${m.widest.right}` : ''}`);
  }
  // 검색 결과가 그려진 상태에서도
  await page.goto(`${BASE}/search/?q=${enc('교육')}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelectorAll('#result-list > li').length > 0, null, { timeout: 5000 });
  const m2 = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  check('360px 검색결과', m2.s <= m2.c + 1, `${m2.s} > ${m2.c}`);
  console.log('2. 360px 가로 스크롤 — 확인');
  await ctx.close();
}

/* ---- 3. 키보드 포커스가 항상 보인다 ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await blockExternal(ctx);
  const page = await ctx.newPage();
  for (const [name, path] of [PAGES[0], PAGES[1], PAGES[6]]) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.body.focus());
    let checked = 0;
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          cls: el.className?.toString().slice(0, 30),
          outlineWidth: parseFloat(cs.outlineWidth) || 0,
          outlineStyle: cs.outlineStyle,
          inViewport: r.top >= -1 && r.bottom <= innerHeight + 1 && r.width > 0,
          offscreen: r.width === 0 && r.height === 0,
        };
      });
      if (!info) continue;
      checked++;
      const visible = info.outlineWidth >= 2 && info.outlineStyle !== 'none';
      check(`포커스 ${name}`, visible, `${info.tag}.${info.cls} outline=${info.outlineWidth}px ${info.outlineStyle}`);
    }
    check(`포커스 대상 ${name}`, checked >= 8, `탭 가능한 요소 ${checked}개`);
  }
  console.log('3. 키보드 포커스 — 확인');
  await ctx.close();
}

await browser.close();
if (fails.length) {
  console.error(`\n실패 ${fails.length}건:`);
  for (const f of [...new Set(fails)]) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('\n수용 기준 1~3 통과');
