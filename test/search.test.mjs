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

// 실제 제목에서 붙어 있는 여섯 글자를 떼어 와 그대로 / 가운데를 띄워서 각각 찾아본다.
// 색인이 띄어쓰기를 지우므로 두 질의 모두 그 자료를 찾아야 한다.
const sample = resources.find((r) => normalize(r.title).length >= 8);
assert.ok(sample, '여덟 글자 이상인 제목이 하나는 있어야 한다');
const joined = normalize(sample.title).slice(0, 6);
const splitQuery = `${joined.slice(0, 3)} ${joined.slice(3)}`;
const a = search(idx, joined);
const b = search(idx, splitQuery);
assert.ok(a.length > 0, `붙여 쓴 질의 결과 있음: ${joined}`);
assert.ok(a.some((h) => h.entry.i === sample.id), '원래 자료가 걸린다');
const bIds = new Set(b.map((h) => h.entry.i));
assert.ok(a.every((h) => bIds.has(h.entry.i)), '붙여 쓴 질의 결과는 띄어 쓴 질의 결과에 포함된다');

// AND 매칭: 두 낱말을 모두 가진 자료만 남고, 한 낱말보다 좁아진다.
const wide = search(idx, '교육');
const pick = resources.find((r) => r.subjects.length > 0 && idx.find((e) => e.i === r.id).k.includes('교육'));
assert.ok(pick, 'AND 확인용 자료를 찾지 못했다');
const and = search(idx, `교육 ${pick.subjects[0]}`);
assert.ok(and.length >= 1, 'AND 결과 있음');
const second = normalize(pick.subjects[0]);
for (const h of and) {
  assert.ok(h.entry.k.includes('교육') && h.entry.k.includes(second), 'AND 성립');
}
assert.ok(and.length < wide.length, 'AND 로 좁혀짐');

// 없는 조합은 0건
assert.equal(search(idx, '교육 존재하지않는낱말xyz').length, 0);

// 점수: 제목에 있으면 3점, 그 밖이면 1점
// 제목에 있는 자료와 없는 자료가 함께 걸리는 낱말을 데이터에서 찾는다.
const probe = (() => {
  for (const r of resources) {
    for (const word of r.title.split(/\s+/)) {
      const q = normalize(word);
      if (q.length < 2) continue;
      const hits = search(idx, q);
      const inTitle = hits.filter((h) => normalize(h.entry.t).includes(q));
      const notInTitle = hits.filter((h) => !normalize(h.entry.t).includes(q));
      if (inTitle.length && notInTitle.length) return { q, hits };
    }
  }
  return null;
})();
assert.ok(probe, '제목 일치와 본문 일치가 섞이는 질의를 찾지 못했다');
assert.equal(probe.hits[0].score, 3, '제목 일치가 3점이고 맨 위');
assert.ok(normalize(probe.hits[0].entry.t).includes(probe.q), '맨 위는 제목 일치');
for (const h of probe.hits) {
  const expected = normalize(h.entry.t).includes(probe.q) ? 3 : 1;
  assert.equal(h.score, expected, `점수 규칙: ${h.entry.i}`);
}

// 정렬: 점수 내림차순 → 발행일 최신순
for (let i = 1; i < probe.hits.length; i++) {
  const p = probe.hits[i-1], c = probe.hits[i];
  assert.ok(p.score > c.score || (p.score === c.score && p.entry.d >= c.entry.d), '정렬 규칙');
}

// 상한
assert.ok(search(idx, '교육', { limit: 100 }).length <= 100);

// 검색키가 실제로 무엇을 담는지 — 고정된 낱말 대신 데이터에서 뽑아 확인한다.
// 시드가 바뀌어도 성질은 그대로여야 한다.
const usedOrgCodes = new Set(resources.map((r) => r.orgCode));
for (const org of orgs.filter((o) => usedOrgCodes.has(o.code)).slice(0, 5)) {
  assert.ok(search(idx, org.shortName).length > 0, `기관 약칭 검색: ${org.shortName}`);
  assert.ok(search(idx, org.name).length > 0, `기관 정식명 검색: ${org.name}`);
}

const someTag = resources.find((r) => r.tags.length > 0)?.tags[0];
assert.ok(someTag, '태그가 있는 자료가 하나는 있어야 한다');
assert.ok(search(idx, someTag).length > 0, `태그 검색: ${someTag}`);

const withTip = resources.find((r) => r.tip);
assert.ok(withTip, '활용팁이 있는 자료가 하나는 있어야 한다');
// 팁에만 있는 낱말이 아닐 수도 있으니, 팁 문장 자체가 색인에 들어갔는지로 본다.
assert.ok(
  idx.find((e) => e.i === withTip.id).k.includes(normalize(withTip.tip)),
  '활용팁이 검색키에 들어간다'
);

const someSubject = resources.find((r) => r.subjects.length > 0)?.subjects[0];
if (someSubject) assert.ok(search(idx, someSubject).length > 0, `과목명 검색: ${someSubject}`);

// 필터: 결과가 여럿인 질의를 하나 잡고, 그 결과에 실제로 있는 학교급으로 좁힌다.
const broad = search(idx, '교육');
assert.ok(broad.length > 1, '넓은 질의에 결과가 여럿');
const someLevel = broad.find((h) => h.entry.l?.length)?.entry.l[0];
assert.ok(someLevel, '결과 중에 학교급이 붙은 자료가 있어야 한다');
const narrowed = applyFilters(broad, { level: someLevel });
assert.ok(narrowed.length > 0 && narrowed.length <= broad.length, '필터가 좁힌다');
for (const h of narrowed) assert.ok(h.entry.l.includes(someLevel));
const f = facetCounts(broad);
assert.equal(f.level.get(someLevel), narrowed.length, '패싯 건수 일치');
assert.deepEqual(applyFilters(broad, {}), broad, '빈 필터는 통과');

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
