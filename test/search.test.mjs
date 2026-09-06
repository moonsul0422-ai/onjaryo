// 검색 로직 회귀 테스트.  실행: npm run sync && node --test test/
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalize, buildIndex, tokenize, prepareIndex, search, applyFilters, facetCounts,
} from '../src/lib/search.js';

const resources = JSON.parse(readFileSync(new URL('../src/data/resources.json', import.meta.url), 'utf8'));
const orgs = JSON.parse(readFileSync(new URL('../src/data/organizations.json', import.meta.url), 'utf8'));
const idx = prepareIndex(buildIndex(resources, orgs));

// 정규화
assert.equal(normalize('안전 교육'), normalize('안전교육'), '띄어쓰기 흡수');
assert.equal(normalize('디지털·AI'), '디지털ai', '가운뎃점 제거 + 소문자');
assert.equal(normalize('(IEP) 작성!'), 'iep작성');
assert.deepEqual(tokenize('  안전 교육  AI '), ['안전', '교육', 'ai']);

// 띄어쓰기 차이 흡수: 자료 쪽 띄어쓰기와 무관하게 잡힌다.
// (질의를 띄우면 조각이 늘어 AND 범위가 넓어지는 것은 별개다.)
const spaced = prepareIndex(buildIndex(
  [{ id: 'x1', title: '안전 교육 길잡이', summary: '요약', tip: null,
     orgCode: 'moe', publishedAt: '2026-01-01', topics: ['안전'], tags: [],
     schoolLevels: ['초등'], resourceType: '연수자료' }],
  orgs));
assert.equal(search(spaced, '안전교육').length, 1, '자료가 띄어 써도 붙여 쓴 질의로 잡힌다');
assert.equal(search(spaced, '안전 교육').length, 1, '띄어 쓴 질의로도 잡힌다');
assert.equal(search(spaced, '교육안전').length, 0, '순서가 다르면 한 조각으로는 안 잡힌다');

const a = search(idx, '안전교육');
const b = search(idx, '안전 교육');
assert.ok(a.length > 0, '안전교육 결과 있음');
const bIds = new Set(b.map(h => h.entry.i));
assert.ok(a.every(h => bIds.has(h.entry.i)), '붙여 쓴 질의 결과는 띄어 쓴 질의 결과에 포함된다');

// AND 매칭
const and = search(idx, '안전 제주');
assert.ok(and.length >= 1);
for (const h of and) assert.ok(h.entry.k.includes('안전') && h.entry.k.includes('제주'), 'AND 성립');
const both = search(idx, '안전').length;
assert.ok(and.length < both, 'AND 로 좁혀짐');

// 없는 조합은 0건
assert.equal(search(idx, '안전 존재하지않는낱말').length, 0);

// 점수: 제목에 있으면 3점
const t = search(idx, '텃밭');
const top = t[0];
assert.ok(normalize(top.entry.t).includes('텃밭'), '제목 일치가 위로');
assert.equal(top.score, 3);
const notInTitle = t.find(h => !normalize(h.entry.t).includes('텃밭'));
if (notInTitle) assert.equal(notInTitle.score, 1);

// 정렬: 점수 → 발행일
for (let i = 1; i < t.length; i++) {
  const p = t[i-1], c = t[i];
  assert.ok(p.score > c.score || (p.score === c.score && p.entry.d >= c.entry.d), '정렬 규칙');
}

// 상한
assert.ok(search(idx, '교육', { limit: 100 }).length <= 100);

// 기관명으로도 잡힌다
assert.ok(search(idx, '강원교육청').length > 0, '기관 약칭 검색');
assert.ok(search(idx, '한국교육학술정보원').length > 0, '기관 정식명 검색');

// 태그로도 잡힌다
assert.ok(search(idx, '해양안전').length > 0, '태그 검색');

// 활용팁으로도 잡힌다 ("파종 시기표" 는 팁에만 있다)
assert.ok(search(idx, '파종시기표').length > 0, '활용팁 검색');

// 필터
const safety = search(idx, '안전');
const elementary = applyFilters(safety, { level: '초등' });
assert.ok(elementary.length > 0 && elementary.length <= safety.length);
for (const h of elementary) assert.ok(h.entry.l.includes('초등'));
const f = facetCounts(safety);
assert.ok(f.level.get('초등') === elementary.length, '패싯 건수 일치');
assert.deepEqual(applyFilters(safety, {}), safety, '빈 필터는 통과');

// 빈 질의
assert.deepEqual(search(idx, '   '), []);

// 색인 항목 모양
for (const e of idx) {
  assert.ok(typeof e.i === 'string' && e.i);
  assert.ok(typeof e.t === 'string' && e.t);
  assert.ok(typeof e.k === 'string' && e.k);
  assert.ok(!/\s/.test(e.k), '검색키에 공백 없음');
}

console.log(`통과: 색인 ${idx.length}건`);
