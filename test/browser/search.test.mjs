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
const browser = await chromium.launch({ executablePath: EXE });
const errors = [];

async function newPage(ctx) {
  const page = await ctx.newPage();
  // 외부 폰트 CDN 은 이 샌드박스에서 프록시가 막는다. 사이트 문제가 아니라 무시한다.
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return;
    errors.push(`[console] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (u.startsWith(BASE)) errors.push(`[404?] ${u} ${r.failure()?.errorText}`);
  });
  return page;
}

const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await newPage(ctx);

// --- 1. 검색창 입력 → 결과
await page.goto(`${BASE}/search/`, { waitUntil: 'networkidle' });
assert.ok(await page.locator('#search-app').isVisible(), 'JS 켜지면 검색 영역이 보인다');
assert.ok(await page.locator('[data-filterbar]').isVisible(), '필터 바가 보인다');

await page.fill('#q', '안전교육');
await page.waitForFunction(() => document.querySelectorAll('#result-list > li').length > 0, null, { timeout: 5000 });
const n1 = await page.locator('#result-list > li').count();
console.log('안전교육 결과', n1, '건 ·', await page.locator('#result-status').textContent());
assert.ok(n1 > 0);

// URL 에 반영되는가
await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === '안전교육');
console.log('URL:', decodeURIComponent(new URL(page.url()).search));

// --- 2. 공유 URL 로 바로 진입
const page2 = await newPage(ctx);
await page2.goto(`${BASE}/search/?q=${encodeURIComponent('학급운영')}`, { waitUntil: 'networkidle' });
await page2.waitForFunction(() => document.querySelectorAll('#result-list > li').length > 0, null, { timeout: 5000 });
assert.equal(await page2.inputValue('#q'), '학급운영', '입력창이 채워진다');
console.log('?q= 진입 결과', await page2.locator('#result-list > li').count(), '건');

// --- 3. 필터가 결과를 좁히고 URL 에 반영된다
const page3 = await newPage(ctx);
await page3.goto(`${BASE}/search/?q=${encodeURIComponent('안전')}`, { waitUntil: 'networkidle' });
await page3.waitForFunction(() => document.querySelectorAll('#result-list > li').length > 0, null, { timeout: 5000 });
const before = await page3.locator('#result-list > li').count();
await page3.selectOption('#filter-level', '초등');
await page3.waitForFunction((b) => document.querySelectorAll('#result-list > li').length < b, before, { timeout: 5000 });
const after = await page3.locator('#result-list > li').count();
console.log(`필터 전 ${before}건 → 초등 ${after}건`);
assert.ok(after > 0 && after < before);
assert.ok(new URL(page3.url()).searchParams.get('level') === '초등', '필터가 URL 에 들어간다');
assert.ok(await page3.locator('[data-filter-reset]').isVisible(), '필터 해제 버튼이 나타난다');
// 옵션에 건수가 붙는가
const optText = await page3.locator('#filter-level option[value="초등"]').textContent();
console.log('옵션 라벨:', optText);
assert.ok(/\(\d+\)/.test(optText), '옵션에 건수 표기');

// 필터 URL 로 바로 진입해도 상태가 살아 있는가
const page3b = await newPage(ctx);
await page3b.goto(`${BASE}/search/?q=${encodeURIComponent('안전')}&level=${encodeURIComponent('초등')}`, { waitUntil: 'networkidle' });
await page3b.waitForFunction(() => document.querySelectorAll('#result-list > li').length > 0, null, { timeout: 5000 });
assert.equal(await page3b.inputValue('#q'), '안전');
assert.equal(await page3b.locator('#filter-level').inputValue(), '초등');
assert.equal(await page3b.locator('#result-list > li').count(), after, '공유 URL 이 같은 결과를 낸다');
console.log('필터 포함 URL 재현 OK');

// 해제
await page3b.click('[data-filter-reset]');
await page3b.waitForFunction((a) => document.querySelectorAll('#result-list > li').length > a, after, { timeout: 5000 });
assert.equal(new URL(page3b.url()).searchParams.get('level'), null, '해제하면 URL 에서도 빠진다');
console.log('필터 해제 OK');

// --- 4. 빈 결과 안내
const page4 = await newPage(ctx);
await page4.goto(`${BASE}/search/?q=${encodeURIComponent('존재하지않는낱말xyz')}`, { waitUntil: 'networkidle' });
await page4.waitForSelector('#empty-box:not([hidden])', { timeout: 5000 });
const emptyText = await page4.locator('#empty-box').innerText();
assert.ok(emptyText.includes('제보'), '빈 결과에 제보 안내가 있다');
assert.ok(await page4.locator('.topicnav a').count() >= 20, '빈 결과에서도 영역 목록이 보인다');
console.log('빈 결과 안내:', emptyText.split('\n')[0]);

// --- 5. 색인은 한 번만 받는가
const page5 = await newPage(ctx);
let indexHits = 0;
page5.on('request', (r) => { if (r.url().includes('search-index.json')) indexHits++; });
await page5.goto(`${BASE}/search/`, { waitUntil: 'networkidle' });
assert.equal(indexHits, 0, '입력 전에는 색인을 부르지 않는다');
await page5.type('#q', '안전', { delay: 30 });
await page5.waitForFunction(() => document.querySelectorAll('#result-list > li').length > 0, null, { timeout: 5000 });
await page5.type('#q', '교육', { delay: 30 });
await page5.waitForTimeout(600);
assert.equal(indexHits, 1, `색인 요청은 한 번 (실제 ${indexHits}회)`);
console.log('색인 fetch 횟수:', indexHits);

// --- 6. 더보기 (결과가 20건을 넘는 질의)
const page6 = await newPage(ctx);
await page6.goto(`${BASE}/search/?q=${encodeURIComponent('교육')}`, { waitUntil: 'networkidle' });
await page6.waitForFunction(() => document.querySelectorAll('#result-list > li').length > 0, null, { timeout: 5000 });
const first = await page6.locator('#result-list > li').count();
console.log(`"교육" 첫 페이지 ${first}건 ·`, await page6.locator('#result-status').textContent());
assert.equal(first, 20, '한 번에 20건');
assert.ok(await page6.locator('#more-btn').isVisible(), '남았으면 더보기가 보인다');
console.log('더보기 라벨:', await page6.locator('#more-btn').textContent());
await page6.click('#more-btn');
const second = await page6.locator('#result-list > li').count();
console.log('더보기 후', second, '건');
assert.ok(second > first, '더보기로 늘어난다');
assert.ok(!(await page6.locator('#more-btn').isVisible()), '다 보여 주면 더보기가 사라진다');

// 결과가 20건 이하이면 더보기가 처음부터 없다
const page7 = await newPage(ctx);
await page7.goto(`${BASE}/search/?q=${encodeURIComponent('안전')}`, { waitUntil: 'networkidle' });
await page7.waitForFunction(() => document.querySelectorAll('#result-list > li').length > 0, null, { timeout: 5000 });
assert.ok(!(await page7.locator('#more-btn').isVisible()), '남은 게 없으면 더보기 없음');
assert.ok(!(await page7.locator('[data-filter-reset]').isVisible()), '필터 없으면 해제 버튼도 없음');
console.log('더보기/해제 버튼 숨김 OK');

await browser.close();
if (errors.length) { console.error('\n브라우저 오류:\n' + errors.join('\n')); process.exit(1); }
console.log('\n검색 브라우저 테스트 통과');
