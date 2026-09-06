// 빌드 산출물(src/data/*.json)을 읽어 페이지가 쓰기 좋은 형태로 묶는다.
// 이 파일은 서버(빌드) 전용이다. 클라이언트 스크립트에서 import 하지 않는다.

import resourcesRaw from '../data/resources.json';
import organizationsRaw from '../data/organizations.json';
import metaRaw from '../data/meta.json';

import { byLevelOrder, byTopicOrder, byTypeOrder } from './taxonomy.js';

/** @type {import('./types.js').Resource[]} */
export const resources = resourcesRaw;
export const organizations = organizationsRaw;
export const meta = metaRaw;

export const orgByCode = new Map(organizations.map((o) => [o.code, o]));
export const resourceById = new Map(resources.map((r) => [r.id, r]));

/** 기관 코드 → 자료 목록. 없는 기관은 키 자체가 없다. */
function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    for (const key of keyFn(item)) {
      if (!key) continue;
      const bucket = map.get(key);
      if (bucket) bucket.push(item);
      else map.set(key, [item]);
    }
  }
  return map;
}

export const byTopic = groupBy(resources, (r) => r.topics);
export const byLevel = groupBy(resources, (r) => r.schoolLevels);
export const byOrg = groupBy(resources, (r) => [r.orgCode]);
export const byTag = groupBy(resources, (r) => r.tags);
export const byType = groupBy(resources, (r) => (r.resourceType ? [r.resourceType] : []));

/** 자료가 1건 이상인 값만. 빈 페이지를 만들지 않기 위해 getStaticPaths 가 이걸 쓴다. */
export const usedTopics = [...byTopic.keys()].sort(byTopicOrder);
export const usedLevels = [...byLevel.keys()].sort(byLevelOrder);
export const usedTags = [...byTag.keys()].sort((a, b) => byTag.get(b).length - byTag.get(a).length || a.localeCompare(b, 'ko'));
export const usedOrgCodes = [...byOrg.keys()].filter((c) => orgByCode.has(c)).sort((a, b) => byOrg.get(b).length - byOrg.get(a).length || a.localeCompare(b));

export const usedTypes = [...byType.keys()].sort(byTypeOrder);

export const countOf = (map, key) => map.get(key)?.length ?? 0;

/** 발행일 최신순. sync 단계에서 이미 정렬돼 있지만 부분집합에도 쓴다. */
export const byNewest = (list) =>
  [...list].sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '') || a.id.localeCompare(b.id));

export const recent = (n) => resources.slice(0, n);

export const orgOf = (resource) => orgByCode.get(resource.orgCode) ?? null;

export const orgShortName = (resource) => orgOf(resource)?.shortName ?? resource.orgCode;

/**
 * 같은 영역·태그·기관의 다른 자료. 상세 페이지 하단용.
 *
 * 전체를 훑지 않고 이미 만들어 둔 그룹에서 후보만 모은다.
 * 상세 페이지는 자료 수만큼 만들어지므로, 여기서 전체를 훑으면
 * 자료가 늘 때 빌드 시간이 제곱으로 늘어난다.
 */
export function related(resource, limit = 6) {
  const scores = new Map();
  const bump = (r, points) => {
    if (r.id === resource.id) return;
    scores.set(r.id, (scores.get(r.id) ?? 0) + points);
  };

  for (const t of resource.topics) for (const r of byTopic.get(t) ?? []) bump(r, 3);
  for (const t of resource.tags) for (const r of byTag.get(t) ?? []) bump(r, 2);
  for (const r of byOrg.get(resource.orgCode) ?? []) bump(r, 1);
  // 학교급은 후보를 넓히지 않고, 이미 걸린 후보의 순위만 올린다.
  const levels = new Set(resource.schoolLevels);
  for (const id of scores.keys()) {
    const r = resourceById.get(id);
    if (r && r.schoolLevels.some((l) => levels.has(l))) scores.set(id, scores.get(id) + 1);
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ r: resourceById.get(id), score }))
    .sort((a, b) => b.score - a.score || (b.r.publishedAt || '').localeCompare(a.r.publishedAt || '') || a.r.id.localeCompare(b.r.id))
    .slice(0, limit)
    .map((x) => x.r);
}

/** 상위기관까지 거슬러 올라간 경로. [교육부, 한국교육학술정보원] 순. */
export function orgLineage(org) {
  const chain = [];
  let cur = org;
  const guard = new Set();
  while (cur && !guard.has(cur.code)) {
    guard.add(cur.code);
    chain.unshift(cur);
    cur = cur.parent ? orgByCode.get(cur.parent) : null;
  }
  return chain;
}

export const childOrgs = (org) =>
  organizations.filter((o) => o.parent === org.code && byOrg.has(o.code));
