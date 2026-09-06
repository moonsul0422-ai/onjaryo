// 색인 생성(빌드)과 매칭(브라우저)을 한 파일에 둔다.
// 두 쪽 규칙이 갈라지면 검색이 조용히 어긋나기 때문이다.
// Node 전용 API를 쓰지 않는다. 이 파일은 클라이언트 번들에도 들어간다.

/**
 * 공백과 문장부호를 모두 지우고 소문자로 만든다.
 * "안전 교육"과 "안전교육"이 같은 키가 되게 하려는 것이 목적이다.
 * 글자·숫자가 아닌 것은 전부 버린다(·, ㆍ, (), -, ~ 등).
 */
export function normalize(text) {
  if (!text) return '';
  return String(text)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** 검색키 = 제목 + 요약 + 활용팁 + 태그 + 영역 + 기관명 */
export function buildSearchKey(resource, org) {
  return normalize(
    [
      resource.title,
      resource.summary,
      resource.tip || '',
      ...(resource.tags || []),
      ...(resource.topics || []),
      org?.name || '',
      org?.shortName || '',
    ].join(' ')
  );
}

/**
 * 색인 항목.
 *   i 아이디 · t 제목 · o 기관 약칭 · d 발행일 · k 검색키
 * 뒤의 셋은 검색 결과 화면의 필터 바(학교급 / 영역 / 자료유형) 전용이다.
 * 필터를 클라이언트에서 거는 이상 이 값들이 없으면 필터를 만들 수 없다.
 *   l 학교급 · p 영역 · y 자료유형
 */
export function buildIndex(resources, organizations) {
  const orgByCode = new Map((organizations || []).map((o) => [o.code, o]));
  return resources.map((r) => {
    const org = orgByCode.get(r.orgCode) || null;
    const entry = {
      i: r.id,
      t: r.title,
      o: org?.shortName || r.orgCode,
      d: r.publishedAt || '',
      k: buildSearchKey(r, org),
    };
    if (r.schoolLevels?.length) entry.l = r.schoolLevels;
    if (r.topics?.length) entry.p = r.topics;
    if (r.resourceType) entry.y = r.resourceType;
    return entry;
  });
}

/** 질의를 공백으로 나눈 뒤 조각마다 정규화. 빈 조각은 버린다. */
export function tokenize(query) {
  return String(query || '')
    .split(/\s+/)
    .map(normalize)
    .filter(Boolean);
}

/** 색인을 받아 매칭에 필요한 정규화 제목(nt)을 미리 붙여 둔다. 로드 시 한 번. */
export function prepareIndex(entries) {
  return entries.map((e) => (e.nt === undefined ? { ...e, nt: normalize(e.t) } : e));
}

export const MAX_RESULTS = 100;
export const PAGE_SIZE = 20;

/**
 * 모든 조각이 검색키에 들어 있는 항목만 통과(AND).
 * 점수는 조각별로 제목에 있으면 3점, 그 밖이면 1점을 더한다.
 * 정렬은 점수 내림차순 → 발행일 최신순.
 */
export function search(entries, query, options = {}) {
  const limit = options.limit ?? MAX_RESULTS;
  const pieces = options.pieces ?? tokenize(query);
  if (pieces.length === 0) return [];

  const hits = [];
  for (const e of entries) {
    let score = 0;
    let matched = true;
    for (const piece of pieces) {
      if (!e.k.includes(piece)) { matched = false; break; }
      const title = e.nt !== undefined ? e.nt : normalize(e.t);
      score += title.includes(piece) ? 3 : 1;
    }
    if (matched) hits.push({ entry: e, score });
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      (b.entry.d || '').localeCompare(a.entry.d || '') ||
      a.entry.i.localeCompare(b.entry.i)
  );

  return hits.slice(0, limit);
}

/** 필터 바에서 고른 값으로 결과를 좁힌다. 빈 값은 조건 없음. */
export function applyFilters(hits, filters = {}) {
  const { level, topic, type } = filters;
  if (!level && !topic && !type) return hits;
  return hits.filter(({ entry }) => {
    if (level && !(entry.l || []).includes(level)) return false;
    if (topic && !(entry.p || []).includes(topic)) return false;
    if (type && entry.y !== type) return false;
    return true;
  });
}

/** 현재 결과에서 실제로 고를 수 있는 값과 건수. 0건인 선택지는 만들지 않는다. */
export function facetCounts(hits) {
  const bump = (map, key) => { if (key) map.set(key, (map.get(key) || 0) + 1); };
  const level = new Map();
  const topic = new Map();
  const type = new Map();
  for (const { entry } of hits) {
    for (const l of entry.l || []) bump(level, l);
    for (const p of entry.p || []) bump(topic, p);
    bump(type, entry.y);
  }
  return { level, topic, type };
}
