#!/usr/bin/env node
// 월 1회 원문 링크 점검.
//
//   npm run check-links              전체 점검, reports/link-check.json 저장
//   npm run check-links -- --limit 50
//   npm run check-links -- --fail-on-broken    끊긴 링크가 있으면 종료코드 1
//   npm run check-links -- --data <파일>        다른 resources.json 으로 점검
//
// 기관 사이트는 HEAD 를 막아 두는 곳이 많아 HEAD 가 405/403 이면 GET 으로 다시 본다.
// 한 호스트에 동시에 몰리지 않도록 호스트별로 한 줄씩 세워 처리한다.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DATA = resolve(ROOT, 'src/data/resources.json');
const REPORT_DIR = resolve(ROOT, 'reports');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const LIMIT = Number(value('limit', 0)) || Infinity;
const TIMEOUT_MS = Number(value('timeout', 15000));
const HOST_CONCURRENCY = Number(value('hosts', 6));
const DELAY_MS = Number(value('delay', 400));
const DATA = resolve(ROOT, value('data', DEFAULT_DATA));
const UA = 'onjaryo-link-check/1.0 (+https://onjaryo.vercel.app/about/)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(url, method) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctl.signal,
      headers: { 'User-Agent': UA, Accept: '*/*' },
    });
    return { status: res.status, finalUrl: res.url };
  } finally {
    clearTimeout(timer);
  }
}

async function checkOne(resource) {
  const started = Date.now();
  const base = { id: resource.id, title: resource.title, url: resource.sourceUrl };
  try {
    let result = await probe(resource.sourceUrl, 'HEAD');
    // HEAD 를 안 받는 서버가 흔하다. 막힌 것처럼 보여도 GET 으로 한 번 더 본다.
    if ([403, 405, 501].includes(result.status)) {
      result = await probe(resource.sourceUrl, 'GET');
    }
    const redirected = result.finalUrl && result.finalUrl !== resource.sourceUrl;
    return {
      ...base,
      status: result.status,
      ok: result.status >= 200 && result.status < 400,
      redirectedTo: redirected ? result.finalUrl : null,
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ...base,
      status: null,
      ok: false,
      error: err.name === 'AbortError' ? `시간 초과 (${TIMEOUT_MS}ms)` : err.message,
      ms: Date.now() - started,
    };
  }
}

/** 같은 호스트끼리 묶어 순서대로, 호스트끼리는 병렬로. */
function groupByHost(resources) {
  const groups = new Map();
  for (const r of resources) {
    let host;
    try { host = new URL(r.sourceUrl).host; } catch { host = '(잘못된 주소)'; }
    const bucket = groups.get(host);
    if (bucket) bucket.push(r);
    else groups.set(host, [r]);
  }
  return groups;
}

async function runPool(tasks, size) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(size, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      results.push(...(await task()));
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  if (!existsSync(DATA)) {
    console.error(`${DATA} 가 없습니다. 먼저 npm run sync 를 실행하세요.`);
    process.exit(1);
  }
  const resources = JSON.parse(await readFile(DATA, 'utf8')).slice(0, LIMIT);
  const groups = groupByHost(resources);

  console.log(`[check-links] ${resources.length}건 · 호스트 ${groups.size}곳 · 동시 ${HOST_CONCURRENCY}`);

  const tasks = [...groups.entries()].map(([host, items]) => async () => {
    const out = [];
    for (const [i, r] of items.entries()) {
      if (i > 0) await sleep(DELAY_MS);
      const result = await checkOne(r);
      out.push({ ...result, host });
      if (!result.ok) {
        console.log(`  ✗ ${result.status ?? '실패'} ${r.id} — ${r.sourceUrl}${result.error ? ` (${result.error})` : ''}`);
      } else if (result.redirectedTo) {
        console.log(`  → ${result.status} ${r.id} — ${result.redirectedTo}`);
      }
    }
    return out;
  });

  const results = await runPool(tasks, HOST_CONCURRENCY);
  results.sort((a, b) => a.id.localeCompare(b.id));

  const broken = results.filter((r) => !r.ok);
  const redirected = results.filter((r) => r.ok && r.redirectedTo);
  const checkedAt = new Date().toISOString().slice(0, 10);

  const report = {
    checkedAt,
    total: results.length,
    ok: results.length - broken.length,
    broken: broken.length,
    redirected: redirected.length,
    results,
  };

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(resolve(REPORT_DIR, 'link-check.json'), JSON.stringify(report, null, 2) + '\n');

  console.log(
    `[check-links] 정상 ${report.ok} · 끊김 ${report.broken} · 리다이렉트 ${report.redirected}` +
      `  → reports/link-check.json`
  );

  if (broken.length) {
    console.log('\n끊긴 링크:');
    for (const r of broken) console.log(`  ${r.id}  ${r.status ?? r.error}  ${r.url}\n    ${r.title}`);
    console.log('\n시트의 sourceUrl 을 새 주소로 고치거나, 원문이 사라졌다면 status 를 비공개로 바꾸세요.');
  }
  if (redirected.length) {
    console.log('\n주소가 바뀐 링크(시트를 새 주소로 고쳐 두면 좋습니다):');
    for (const r of redirected) console.log(`  ${r.id}\n    ${r.url}\n    → ${r.redirectedTo}`);
  }

  if (flag('fail-on-broken') && broken.length) process.exit(1);
}

main().catch((err) => {
  console.error('[check-links] 실패:', err.message);
  process.exit(1);
});
