import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:4321';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
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

// 결과 카드에 스타일이 실제로 먹었는가.
// 검색 결과는 ResourceCard 컴포넌트를 거치지 않고 클라이언트에서 그린다.
// 카드 CSS 가 컴포넌트 파일에 묶여 있으면 이 페이지에는 딸려 오지 않는다(한 번 그랬다).
const styled = await page.evaluate(() => {
  const list = document.getElementById('result-list');
  const card = list?.querySelector('.rcard');
  const chip = list?.querySelector('.chip');
  if (!card || !chip) return null;
  const cs = getComputedStyle(card);
  return {
    listStyle: getComputedStyle(list).listStyleType,
    display: getComputedStyle(list).display,
    borderWidth: parseFloat(cs.borderTopWidth) || 0,
    radius: parseFloat(cs.borderTopLeftRadius) || 0,
    chipRadius: parseFloat(getComputedStyle(chip).borderTopLeftRadius) || 0,
  };
});
assert.ok(styled, '결과 카드와 칩이 그려진다');
assert.equal(styled.listStyle, 'none', '목록 글머리표가 없다');
assert.equal(styled.display, 'grid', '.rlist 스타일이 먹었다');
assert.ok(styled.borderWidth >= 1, `카드 테두리가 있다 (${styled.borderWidth}px)`);
assert.ok(styled.radius >= 4, `카드 모서리가 둥글다 (${styled.radius}px)`);
assert.ok(styled.chipRadius >= 8, `칩이 알약 모양이다 (${styled.chipRadius}px)`);
console.log('결과 카드 스타일 적용 OK');

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
await page3.selectOption('#filter-grade', '초3');
await page3.waitForFunction((b) => document.querySelectorAll('#result-list > li').length < b, before, { timeout: 5000 });
const after = await page3.locator('#result-list > li').count();
console.log(`필터 전 ${before}건 → 초3 ${after}건`);
assert.ok(after > 0 && after < before);
assert.ok(new URL(page3.url()).searchParams.get('grade') === '초3', '필터가 URL 에 들어간다');
assert.ok(await page3.locator('[data-filter-reset]').isVisible(), '필터 해제 버튼이 나타난다');
// 옵션에 건수가 붙는가
const optText = await page3.locator('#filter-grade option[value="초3"]').textContent();
console.log('옵션 라벨:', optText);
assert.ok(/\(\d+\)/.test(optText), '옵션에 건수 표기');

// 필터 URL 로 바로 진입해도 상태가 살아 있는가
const page3b = await newPage(ctx);
await page3b.goto(`${BASE}/search/?q=${encodeURIComponent('안전')}&grade=${encodeURIComponent('초3')}`, { waitUntil: 'networkidle' });
await page3b.waitForFunction(() => document.querySelectorAll('#result-list > li').length > 0, null, { timeout: 5000 });
assert.equal(await page3b.inputValue('#q'), '안전');
assert.equal(await page3b.locator('#filter-grade').inputValue(), '초3');
assert.equal(await page3b.locator('#result-list > li').count(), after, '공유 URL 이 같은 결과를 낸다');
console.log('필터 포함 URL 재현 OK');

// 해제
await page3b.click('[data-filter-reset]');
await page3b.waitForFunction((a) => document.querySelectorAll('#result-list > li').length > a, after, { timeout: 5000 });
assert.equal(new URL(page3b.url()).searchParams.get('grade'), null, '해제하면 URL 에서도 빠진다');
console.log('필터 해제 OK');

// 화면에 없는 필터(level)를 URL 에 실어도 조용히 걸리면 안 된다.
// 보이지도 지워지지도 않는 조건이 되기 때문이다.
const page3c = await newPage(ctx);
await page3c.goto(`${BASE}/search/?q=${encodeURIComponent('안전')}&level=${encodeURIComponent('초등')}`, { waitUntil: 'networkidle' });
await page3c.waitForFunction(() => document.querySelectorAll('#result-list > li').length > 0, null, { timeout: 5000 });
const plain = await newPage(ctx);
await plain.goto(`${BASE}/search/?q=${encodeURIComponent('안전')}`, { waitUntil: 'networkidle' });
await plain.waitForFunction(() => document.querySelectorAll('#result-list > li').length > 0, null, { timeout: 5000 });
assert.equal(
  await page3c.locator('#result-list > li').count(),
  await plain.locator('#result-list > li').count(),
  '화면에 없는 필터는 URL 로도 걸리지 않는다'
);
assert.ok(!(await page3c.locator('[data-filter-reset]').isVisible()), '걸린 필터가 없으니 해제 버튼도 없다');
console.log('화면 밖 필터 무시 OK');

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

// 결과 수는 시드에 따라 달라진다. 버튼이 사라질 때까지 눌러 본다.
const statusText = await page6.locator('#result-status').textContent();
const totalHits = Number(/결과 (\d+)건/.exec(statusText)?.[1]);
assert.ok(totalHits > 20, `상태줄에서 총 건수를 읽는다 (${statusText})`);

let shown = first;
let clicks = 0;
while (await page6.locator('#more-btn').isVisible()) {
  await page6.click('#more-btn');
  clicks += 1;
  const now = await page6.locator('#result-list > li').count();
  assert.ok(now > shown, '더보기로 늘어난다');
  assert.ok(now - shown <= 20, '한 번에 20건까지만 늘어난다');
  shown = now;
  assert.ok(clicks < 20, '더보기가 끝나지 않는다');
}
console.log(`더보기 ${clicks}번 → ${shown}건`);
assert.equal(shown, totalHits, '다 눌렀으면 전체 결과가 나온다');

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
