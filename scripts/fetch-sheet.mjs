#!/usr/bin/env node
// Google Sheets(gviz CSV) → src/data/*.json
//
// API 키를 쓰지 않는다. 시트를 "링크가 있는 모든 사용자에게 공개"로 두고
// gviz CSV 엔드포인트를 그대로 읽는다.
//
//   SHEET_ID              시트 문서 ID
//   SHEET_RESOURCES_GID   자료 탭 gid (기본 0)
//   SHEET_ORGS_GID        기관 탭 gid (없으면 시트명 "organizations" 로 시도)
//
// SHEET_ID 가 없거나 네트워크가 막히면 scripts/seed/*.csv 로 빌드한다.
// 빌드가 시트 상태에 인질로 잡히지 않게 하기 위함이다.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEnabled as kvEnabled, pipeline as kvPipeline, toInt } from '../api/_kv.js';
import {
  isAudience, isGrade, isLevel, isLicense, isSubject, isTopic, isType,
  byGradeOrder, byLevelOrder, bySubjectOrder, byTopicOrder,
  GRADE_TO_LEVEL,
} from '../src/lib/taxonomy.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'src/data');
const SEED_DIR = resolve(ROOT, 'scripts/seed');

const SHEET_ID = process.env.SHEET_ID?.trim() || '';
const RESOURCES_GID = process.env.SHEET_RESOURCES_GID?.trim() || '0';
const ORGS_GID = process.env.SHEET_ORGS_GID?.trim() || '';
const FETCH_TIMEOUT_MS = Number(process.env.SHEET_TIMEOUT_MS || 20000);

const warnings = [];
const warn = (msg) => { warnings.push(msg); console.warn(`  ! ${msg}`); };

/* ------------------------------------------------------------------ CSV */

/** RFC4180 CSV 파서. 따옴표 안의 쉼표·줄바꿈·이중따옴표를 모두 처리한다. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  // BOM
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { quoted = true; i += 1; continue; }
    if (c === ',') { row.push(field); field = ''; i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += c; i += 1;
  }
  row.push(field);
  rows.push(row);

  // 완전히 빈 줄은 버린다
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** 첫 줄을 헤더로 보고 객체 배열로. 헤더는 공백 제거 + 소문자. */
function toRecords(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().replace(/\s+/g, '').toLowerCase());
  return rows.slice(1).map((cells) => {
    const rec = {};
    header.forEach((key, idx) => { if (key) rec[key] = (cells[idx] ?? '').trim(); });
    return rec;
  });
}

/* --------------------------------------------------------------- 정규화 */

const clean = (v) => (v ?? '').toString().trim();

/** "안전, 학교폭력예방 / 상담" → ['안전','학교폭력예방','상담'] */
function splitList(v) {
  return clean(v)
    .split(/[,;|/·]|\s{2,}|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** '·' 는 분류값 안에도 쓰인다(디지털·AI). 구분자로 쪼개면 안 되는 열에 쓴다. */
function splitListKeepDot(v) {
  return clean(v)
    .split(/[,;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 학년 표기를 상수 값으로 맞춘다.
 * "초등 3학년", "3학년", "초3", "초등3" 이 모두 "초3" 이 되게.
 * 학교급이 없는 "3학년" 은 초등으로 본다 — 시트에서 가장 흔한 생략이다.
 */
export function normalizeGrade(v) {
  const s = clean(v).replace(/\s+/g, '');
  if (!s) return null;
  if (/^(유아|유치원)$/.test(s)) return '유아';
  const m = /^(초등|초|중학|중|고등|고교|고)?(\d)(학년)?$/.exec(s);
  if (!m) return null;
  const [, levelPart, num] = m;
  const n = Number(num);
  let prefix;
  if (!levelPart || /^(초등|초)$/.test(levelPart)) prefix = '초';
  else if (/^(중학|중)$/.test(levelPart)) prefix = '중';
  else prefix = '고';
  if (prefix === '초' && (n < 1 || n > 6)) return null;
  if (prefix !== '초' && (n < 1 || n > 3)) return null;
  return `${prefix}${n}`;
}

/** 다양한 날짜 표기를 ISO(YYYY-MM-DD)로. 못 읽으면 null. */
export function normalizeDate(v, ctx = '') {
  const s = clean(v);
  if (!s) return null;
  let m = /^(\d{4})[-.\/년\s]+(\d{1,2})[-.\/월\s]+(\d{1,2})/.exec(s);
  if (m) {
    const [, y, mo, d] = m;
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31) return iso;
  }
  m = /^(\d{4})[-.\/년\s]*(\d{1,2})?[월\s]*$/.exec(s);
  if (m) {
    const [, y, mo] = m;
    return `${y}-${String(mo || 1).padStart(2, '0')}-01`;
  }
  if (ctx) warn(`${ctx}: 발행일을 읽지 못했습니다 — "${s}"`);
  return null;
}

function normalizeUrl(v, ctx = '') {
  const s = clean(v);
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) {
    warn(`${ctx}: sourceUrl 이 http(s) 로 시작하지 않습니다 — "${s}"`);
    return '';
  }
  return s;
}

/** 파일형식: "HWP, PDF" → ['HWP','PDF'] (대문자 통일) */
function normalizeFormats(v) {
  return splitList(v)
    .map((s) => s.replace(/^\./, '').toUpperCase())
    .filter(Boolean);
}

const FIELD_ALIASES = {
  id: ['id', '아이디', '식별자'],
  title: ['title', '제목', '자료명'],
  summary: ['summary', '요약', '설명'],
  tip: ['tip', '활용팁', '언제쓰나', '활용'],
  sourceUrl: ['sourceurl', 'url', '원문', '원문링크', '링크', '주소'],
  orgCode: ['orgcode', '기관코드', '기관'],
  publishedAt: ['publishedat', '발행일', '등록일', '작성일'],
  audiences: ['audiences', '대상', '이용대상'],
  schoolLevels: ['schoollevels', 'levels', '학교급'],
  grades: ['grades', '학년'],
  subjects: ['subjects', '교과', '과목'],
  topics: ['topics', '영역', '주제'],
  resourceType: ['resourcetype', 'type', '자료유형', '유형'],
  fileFormats: ['fileformats', 'formats', '파일형식', '형식'],
  license: ['license', '이용조건', '라이선스', '공공누리'],
  tags: ['tags', '태그'],
  linkCheckedAt: ['linkcheckedat', '링크점검일'],
  status: ['status', '상태', '공개'],
};

const ORG_ALIASES = {
  code: ['code', '코드', '기관코드'],
  name: ['name', '기관명', '이름'],
  shortName: ['shortname', '약칭', '짧은이름'],
  region: ['region', '지역', '시도'],
  orgType: ['orgtype', '기관유형', '유형'],
  parent: ['parent', '상위기관', '소속'],
  homepage: ['homepage', '홈페이지', 'url'],
};

function pick(rec, aliases) {
  for (const key of aliases) {
    if (rec[key] !== undefined && rec[key] !== '') return rec[key];
  }
  return '';
}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeResource(rec, index, orgIndex) {
  const raw = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) raw[field] = pick(rec, aliases);

  const rowRef = `행 ${index + 2}`;
  const status = clean(raw.status).toLowerCase();
  if (status && /^(비공개|보류|draft|hidden|no|x|false)$/.test(status)) return null;

  const id = clean(raw.id).toLowerCase();
  const title = clean(raw.title);
  if (!id && !title) return null; // 진짜 빈 줄

  if (!id) { warn(`${rowRef} "${title}": id 가 비어 있어 제외합니다`); return null; }
  if (!ID_RE.test(id)) { warn(`${rowRef} "${id}": id 는 소문자·숫자·하이픈만 씁니다. 제외합니다`); return null; }
  if (!title) { warn(`${rowRef} (${id}): 제목이 비어 있어 제외합니다`); return null; }

  // 수용 기준: 요약이 비어 있는 자료는 산출물에 넣지 않는다.
  const summary = clean(raw.summary);
  if (!summary) { warn(`${rowRef} (${id}) "${title}": 요약이 비어 제외합니다`); return null; }

  const sourceUrl = normalizeUrl(raw.sourceUrl, `${rowRef} (${id})`);
  if (!sourceUrl) { warn(`${rowRef} (${id}): 원문 링크가 없어 제외합니다`); return null; }

  const orgCode = clean(raw.orgCode).toLowerCase();
  if (!orgCode) warn(`${rowRef} (${id}): 기관코드가 비어 있습니다`);
  else if (!orgIndex.has(orgCode)) warn(`${rowRef} (${id}): 기관 시트에 없는 기관코드 "${orgCode}"`);

  const topics = splitListKeepDot(raw.topics).filter((t) => {
    if (isTopic(t)) return true;
    warn(`${rowRef} (${id}): 정의되지 않은 영역 "${t}" — 무시합니다`);
    return false;
  });
  if (topics.length === 0) { warn(`${rowRef} (${id}) "${title}": 영역이 하나도 없어 제외합니다`); return null; }

  const grades = [...new Set(
    splitList(raw.grades)
      .map((v) => {
        const g = normalizeGrade(v);
        if (g && isGrade(g)) return g;
        warn(`${rowRef} (${id}): 읽을 수 없는 학년 "${v}" — 무시합니다`);
        return null;
      })
      .filter(Boolean)
  )].sort(byGradeOrder);

  const subjects = [...new Set(splitListKeepDot(raw.subjects).filter((v) => {
    if (isSubject(v)) return true;
    warn(`${rowRef} (${id}): 정의되지 않은 교과 "${v}" — 무시합니다`);
    return false;
  }))].sort(bySubjectOrder);

  let schoolLevels = splitList(raw.schoolLevels).filter((v) => {
    if (isLevel(v)) return true;
    warn(`${rowRef} (${id}): 정의되지 않은 학교급 "${v}" — 무시합니다`);
    return false;
  });
  // 학년을 적었으면 학교급은 손으로 적지 않아도 된다. 여기서 유도한다.
  if (grades.length > 0) {
    const derived = [...new Set(grades.map((g) => GRADE_TO_LEVEL[g]).filter(Boolean))];
    schoolLevels = [...new Set([...schoolLevels, ...derived])];
  }
  if (schoolLevels.length === 0) {
    warn(`${rowRef} (${id}): 학년도 학교급도 없습니다 — "전체"로 둡니다`);
    schoolLevels = ['전체'];
  }
  const audiences = splitList(raw.audiences).filter((v) => {
    if (isAudience(v)) return true;
    warn(`${rowRef} (${id}): 정의되지 않은 대상 "${v}" — 무시합니다`);
    return false;
  });

  let resourceType = clean(raw.resourceType) || null;
  if (resourceType && !isType(resourceType)) {
    warn(`${rowRef} (${id}): 정의되지 않은 자료유형 "${resourceType}" — 비웁니다`);
    resourceType = null;
  }

  let license = clean(raw.license) || '미표기';
  if (!isLicense(license)) {
    warn(`${rowRef} (${id}): 정의되지 않은 이용조건 "${license}" — 미표기로 둡니다`);
    license = '미표기';
  }

  const publishedAt = normalizeDate(raw.publishedAt, `${rowRef} (${id})`);

  return {
    id,
    title,
    summary,
    tip: clean(raw.tip) || null,
    sourceUrl,
    orgCode,
    publishedAt,
    year: publishedAt ? Number(publishedAt.slice(0, 4)) : null,
    audiences,
    schoolLevels: schoolLevels.sort(byLevelOrder),
    grades,
    subjects,
    topics: [...new Set(topics)].sort(byTopicOrder),
    resourceType,
    fileFormats: normalizeFormats(raw.fileFormats),
    license,
    tags: [...new Set(splitListKeepDot(raw.tags))],
    linkCheckedAt: normalizeDate(raw.linkCheckedAt),
  };
}

function normalizeOrg(rec, index) {
  const raw = {};
  for (const [field, aliases] of Object.entries(ORG_ALIASES)) raw[field] = pick(rec, aliases);
  const code = clean(raw.code).toLowerCase();
  const name = clean(raw.name);
  if (!code && !name) return null;
  if (!code) { warn(`기관 행 ${index + 2} "${name}": code 가 비어 제외합니다`); return null; }
  if (!name) { warn(`기관 행 ${index + 2} (${code}): name 이 비어 제외합니다`); return null; }
  return {
    code,
    name,
    shortName: clean(raw.shortName) || name,
    region: clean(raw.region) || null,
    orgType: clean(raw.orgType) || null,
    parent: clean(raw.parent).toLowerCase() || null,
    homepage: normalizeUrl(raw.homepage, `기관 (${code})`) || null,
  };
}

/* --------------------------------------------------------------- 읽어오기 */

function gvizUrl(gid, sheetName) {
  const base = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
  return gid ? `${base}&gid=${encodeURIComponent(gid)}` : `${base}&sheet=${encodeURIComponent(sheetName)}`;
}

async function fetchCsv(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // 비공개 시트는 200 + 로그인 HTML 을 돌려준다. CSV 가 아니면 실패로 본다.
    if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('CSV 대신 HTML 이 왔습니다 (시트 공개 설정 확인)');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function readSeed(name) {
  const path = resolve(SEED_DIR, name);
  if (!existsSync(path)) throw new Error(`시드 파일이 없습니다: ${path}`);
  return readFile(path, 'utf8');
}

async function loadSources() {
  if (!SHEET_ID) {
    console.log('  SHEET_ID 가 없습니다. scripts/seed/*.csv 로 빌드합니다.');
    return {
      source: 'seed',
      resourcesCsv: await readSeed('resources.csv'),
      orgsCsv: await readSeed('organizations.csv'),
    };
  }
  try {
  console.log(`  시트 ${SHEET_ID} 에서 가져옵니다.`);
  let resourcesCsv;
  try {
    resourcesCsv = await fetchCsv(gvizUrl(RESOURCES_GID, 'resources'));
  } catch (err) {
    warn(`자료 탭을 읽지 못했습니다 (${err.message}). 시드 데이터로 대체합니다.`);
    return {
      source: 'seed-fallback',
      resourcesCsv: await readSeed('resources.csv'),
      orgsCsv: await readSeed('organizations.csv'),
    };
  }

  let orgsCsv;
  try {
    orgsCsv = await fetchCsv(gvizUrl(ORGS_GID, 'organizations'));
  } catch (err) {
    // 기관 탭은 선택 사항이다. 기관 탭이 없어도 자료 탭의 전체 행은 보존한다.
    warn(`기관 탭을 읽지 못했습니다 (${err.message}). 시드 기관 목록으로 보완합니다.`);
    orgsCsv = await readSeed('organizations.csv');
    return { source: 'sheet-resources-seed-orgs', resourcesCsv, orgsCsv };
  }

  return { source: 'sheet', resourcesCsv, orgsCsv };

/* -------------------------------------------------------------------- 실행 */

async function main() {
  console.log('[sync] 자료 데이터를 만듭니다.');
  const { source, resourcesCsv, orgsCsv } = await loadSources();

  const orgs = toRecords(orgsCsv).map(normalizeOrg).filter(Boolean);
  const orgIndex = new Map(orgs.map((o) => [o.code, o]));
  for (const o of orgs) {
    if (o.parent && !orgIndex.has(o.parent)) warn(`기관 (${o.code}): 상위기관 "${o.parent}" 을 찾을 수 없습니다`);
  }
  orgs.sort((a, b) => a.code.localeCompare(b.code));

  const seen = new Set();
  const resources = [];
  toRecords(resourcesCsv).forEach((rec, i) => {
    const r = normalizeResource(rec, i, orgIndex);
    if (!r) return;
    if (seen.has(r.id)) { warn(`중복 id "${r.id}" — 뒤에 나온 행을 버립니다`); return; }
    seen.add(r.id);
    resources.push(r);
  });

  // 최신순 고정. 발행일이 없는 자료는 뒤로.
  resources.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '') || a.id.localeCompare(b.id));

  const usedOrgs = new Set(resources.map((r) => r.orgCode));
  for (const o of orgs) {
    if (!usedOrgs.has(o.code)) warn(`기관 (${o.code} ${o.shortName}): 연결된 자료가 없습니다`);
  }

  // 원문 클릭 수를 붙인다. 자료가 얼마나 쓰이는지 보여 주는 유일한 숫자다.
  // KV 가 설정돼 있지 않으면 조용히 건너뛴다 — 카운터 없이도 사이트는 돌아간다.
  let clicksAttached = 0;
  if (kvEnabled() && resources.length > 0) {
    try {
      const counts = await kvPipeline(resources.map((r) => ['GET', `click:${r.id}`]));
      resources.forEach((r, i) => {
        r.clicks = toInt(counts[i]);
        if (r.clicks > 0) clicksAttached += 1;
      });
      console.log(`  클릭 수를 ${clicksAttached}건에 붙였습니다.`);
    } catch (err) {
      warn(`클릭 수를 가져오지 못했습니다 (${err.message}). 0으로 둡니다.`);
      for (const r of resources) r.clicks = 0;
    }
  } else {
    for (const r of resources) r.clicks = 0;
  }

  const meta = {
    source,
    syncedAt: new Date().toISOString(),
    total: resources.length,
    orgCount: orgs.filter((o) => usedOrgs.has(o.code)).length,
    latestPublishedAt: resources.find((r) => r.publishedAt)?.publishedAt || null,
    countersEnabled: kvEnabled(),
    totalClicks: resources.reduce((sum, r) => sum + (r.clicks || 0), 0),
    warnings: warnings.length,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(resolve(OUT_DIR, 'resources.json'), JSON.stringify(resources, null, 2) + '\n');
  await writeFile(resolve(OUT_DIR, 'organizations.json'), JSON.stringify(orgs, null, 2) + '\n');
  await writeFile(resolve(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');

  console.log(`[sync] 자료 ${resources.length}건 / 기관 ${orgs.length}곳 · 경고 ${warnings.length}건 (source=${source})`);

  if (resources.length === 0) {
    console.error('[sync] 자료가 0건입니다. 빌드를 중단합니다.');
    process.exit(1);
  }
}

// 다른 스크립트에서 import 할 때는 실행하지 않는다.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('[sync] 실패:', err.message);
    process.exit(1);
  });
}
