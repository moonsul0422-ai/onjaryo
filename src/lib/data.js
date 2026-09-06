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

/** 같은 기관 또는 같은 영역의 다른 자료. 상세 페이지 하단용. */
export function related(resource, limit = 6) {
  const scored = resources
    .filter((r) => r.id !== resource.id)
    .map((r) => {
      const sharedTopics = r.topics.filter((t) => resource.topics.includes(t)).length;
      const sharedTags = r.tags.filter((t) => resource.tags.includes(t)).length;
      const sameOrg = r.orgCode === resource.orgCode ? 1 : 0;
      const sameLevel = r.schoolLevels.some((l) => resource.schoolLevels.includes(l)) ? 1 : 0;
      return { r, score: sharedTopics * 3 + sharedTags * 2 + sameOrg + sameLevel };
    })
    .filter((x) => x.score > 0);

  scored.sort((a, b) => b.score - a.score || (b.r.publishedAt || '').localeCompare(a.r.publishedAt || ''));
  return scored.slice(0, limit).map((x) => x.r);
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
