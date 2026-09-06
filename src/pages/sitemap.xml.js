// @astrojs/sitemap 대신 직접 만든다. lastmod 를 자료의 publishedAt 으로 두려면
// 페이지별 날짜를 우리가 알아야 하는데, 그건 데이터 쪽에만 있다.

import {
  byLevel, byOrg, byTag, byTopic, meta,
  usedLevels, usedOrgCodes, usedTags, usedTopics,
} from '../lib/data.js';
import { levelUrl, orgUrl, resourceUrl, tagUrl, topicUrl } from '../lib/site.js';
import { resources } from '../lib/data.js';

/** 목록의 자료 중 가장 최근 발행일. 분류 페이지의 lastmod 로 쓴다. */
const newestIn = (list) =>
  list.reduce((acc, r) => (r.publishedAt && r.publishedAt > acc ? r.publishedAt : acc), '');

const syncDate = meta.syncedAt.slice(0, 10);

function buildEntries(siteUrl) {
  const abs = (path) => new URL(path, siteUrl).href;
  const entries = [];
  const add = (path, lastmod, changefreq, priority) =>
    entries.push({ loc: abs(path), lastmod: lastmod || syncDate, changefreq, priority });

  add('/', syncDate, 'daily', '1.0');
  add('/search/', syncDate, 'weekly', '0.6');
  add('/about/', syncDate, 'monthly', '0.4');
  add('/submit/', syncDate, 'monthly', '0.4');

  for (const r of resources) {
    add(resourceUrl(r.id), r.publishedAt, 'yearly', '0.8');
  }
  for (const t of usedTopics) {
    add(topicUrl(t), newestIn(byTopic.get(t)), 'weekly', '0.7');
  }
  for (const l of usedLevels) {
    add(levelUrl(l), newestIn(byLevel.get(l)), 'weekly', '0.7');
  }
  for (const c of usedOrgCodes) {
    add(orgUrl(c), newestIn(byOrg.get(c)), 'weekly', '0.6');
  }
  for (const t of usedTags) {
    add(tagUrl(t), newestIn(byTag.get(t)), 'monthly', '0.4');
  }
  return entries;
}

const escapeXml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function GET({ site }) {
  const siteUrl = site ?? 'https://onjaryo.vercel.app';
  const entries = buildEntries(siteUrl);

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) => `  <url>
    <loc>${escapeXml(e.loc)}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
