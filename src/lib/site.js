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
