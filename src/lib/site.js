// 사이트 전역 상수. 도메인은 astro.config.mjs 의 site 와 같은 값을 쓴다.
export const SITE_NAME = '온자료';
export const SITE_TAGLINE = '전국 교육청 교육자료를 한곳에서';
export const SITE_DESCRIPTION =
  '시·도교육청과 산하기관이 공개한 교육자료를 영역·학교급·기관별로 정리한 아카이브입니다. 원문은 각 기관 사이트에 그대로 두고, 찾는 길만 모았습니다.';

// 이 파일은 클라이언트 번들에도 딸려 들어갈 수 있다. process 접근을 감싼다.
function readEnv(key) {
  const fromVite = import.meta.env?.[key];
  if (fromVite) return String(fromVite);
  if (typeof process !== 'undefined' && process?.env?.[key]) return String(process.env[key]);
  return '';
}

export const SITE_URL = (readEnv('SITE_URL') || 'https://onjaryo.vercel.app').replace(/\/$/, '');

// 제보용 구글 폼. 비어 있으면 submit 페이지가 임베드 대신 안내문을 보여준다.
export const SUBMIT_FORM_URL = readEnv('PUBLIC_SUBMIT_FORM_URL');

export const CONTACT_EMAIL = 'onjaryo.archive@gmail.com';

export const NAV = [
  { href: '/search', label: '검색' },
  { href: '/about', label: '소개' },
  { href: '/submit', label: '자료 제보' },
];

/** 분류 URL. 한글 값을 encodeURIComponent 로 인코딩해 그대로 쓴다. */
export const gradeUrl = (g) => `/grade/${encodeURIComponent(g)}/`;
export const subjectUrl = (s) => `/subject/${encodeURIComponent(s)}/`;
export const gradeSubjectUrl = (g, s) =>
  `/grade/${encodeURIComponent(g)}/${encodeURIComponent(s)}/`;
export const topicUrl = (t) => `/topic/${encodeURIComponent(t)}/`;
export const levelUrl = (l) => `/level/${encodeURIComponent(l)}/`;
export const tagUrl = (t) => `/tag/${encodeURIComponent(t)}/`;
export const orgUrl = (c) => `/org/${encodeURIComponent(c)}/`;
export const resourceUrl = (id) => `/r/${encodeURIComponent(id)}/`;
export const absolute = (path) => `${SITE_URL}${path}`;

/** "2026-03-04" → "2026년 3월 4일" */
export function formatDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일`;
}

/** "2026-03-04" → "2026.03.04" (카드처럼 좁은 자리에서) */
export function formatDateShort(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

/**
 * 한글 조사 선택. 마지막 글자의 받침 유무로 고른다.
 * 한글이 아닌 글자로 끝나면(영문 약칭 등) 받침 없는 쪽을 쓴다.
 */
export function particle(word, withBatchim, withoutBatchim) {
  const last = String(word || '').trim().slice(-1);
  const code = last.charCodeAt(0);
  const isHangul = code >= 0xac00 && code <= 0xd7a3;
  if (!isHangul) return withoutBatchim;
  return (code - 0xac00) % 28 !== 0 ? withBatchim : withoutBatchim;
}

/** "교육부" → "교육부는", "서울교육청" → "서울교육청은" */
export const withEun = (w) => `${w}${particle(w, '은', '는')}`;
export const withI = (w) => `${w}${particle(w, '이', '가')}`;

/**
 * 학년 배열을 짧은 표기로. 카드 한 줄에 들어가야 해서 칩 대신 글자로 쓴다.
 *   ['초3','초4']                     → '초3~4'
 *   ['초1'..'초6']                     → '초등 전체'
 *   ['초5','초6','중1']                → '초5~중1'
 *   ['중1','중3']                      → '중1·중3'
 */
const GRADE_SEQ = [
  '유아',
  '초1', '초2', '초3', '초4', '초5', '초6',
  '중1', '중2', '중3',
  '고1', '고2', '고3',
];
const LEVEL_FULL = {
  '초등': ['초1', '초2', '초3', '초4', '초5', '초6'],
  '중학': ['중1', '중2', '중3'],
  '고교': ['고1', '고2', '고3'],
};

export function formatGradeRange(grades) {
  if (!grades || grades.length === 0) return null;
  const rank = new Map(GRADE_SEQ.map((g, i) => [g, i]));
  const sorted = [...new Set(grades)].filter((g) => rank.has(g)).sort((a, b) => rank.get(a) - rank.get(b));
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];

  // 한 학교급을 통째로 덮으면 그렇게 말한다.
  for (const [level, members] of Object.entries(LEVEL_FULL)) {
    if (members.length === sorted.length && members.every((m) => sorted.includes(m))) {
      return `${level} 전체`;
    }
  }

  const contiguous = sorted.every((g, i) => i === 0 || rank.get(g) === rank.get(sorted[i - 1]) + 1);
  if (!contiguous) return sorted.join('·');

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  // 같은 학교급이면 뒤쪽 접두사를 뗀다. 초3~4 처럼.
  return first[0] === last[0] ? `${first}~${last.slice(1)}` : `${first}~${last}`;
}
