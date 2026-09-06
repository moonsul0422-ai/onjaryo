// 색인 생성을 빌드 파이프라인에 매단다.
// dev 서버는 public/ 을 디스크에서 그대로 읽고, build 는 public/ 을 dist/ 로 복사한다.
// 그래서 두 경우 모두 astro:config:setup 시점에 파일을 써 두면 된다.

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIndex } from './search.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = resolve(ROOT, 'src/data');
const OUT = resolve(ROOT, 'public/search-index.json');

async function readJson(name) {
  const path = resolve(DATA_DIR, name);
  if (!existsSync(path)) {
    throw new Error(`${path} 가 없습니다. 먼저 npm run sync 를 실행하세요.`);
  }
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function writeSearchIndex(logger) {
  const [resources, organizations] = await Promise.all([
    readJson('resources.json'),
    readJson('organizations.json'),
  ]);

  const index = buildIndex(resources, organizations);
  const json = JSON.stringify(index);

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, json);

  const kb = (Buffer.byteLength(json) / 1024).toFixed(1);
  logger?.info(`검색 색인 ${index.length}건 · ${kb} kB → public/search-index.json`);
  return index.length;
}

/**
 * public/robots.txt 는 정적 파일이라 도메인이 박혀 있다.
 * astro.config 의 site 와 어긋나면 사이트맵을 엉뚱한 곳으로 알린다.
 * 빌드 때 한 번 맞춰 보고 다르면 경고한다.
 */
async function checkRobots(site, logger) {
  const path = resolve(ROOT, 'public/robots.txt');
  if (!existsSync(path)) {
    logger?.warn('public/robots.txt 가 없습니다.');
    return;
  }
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(path, 'utf8');
  const match = /^\s*Sitemap:\s*(\S+)/im.exec(text);
  if (!match) {
    logger?.warn('public/robots.txt 에 Sitemap 줄이 없습니다.');
    return;
  }
  const expected = new URL('/sitemap.xml', site).href;
  if (match[1] !== expected) {
    logger?.warn(
      `robots.txt 의 Sitemap 이 site 설정과 다릅니다.\n` +
        `  robots.txt: ${match[1]}\n` +
        `  site:       ${expected}\n` +
        `  public/robots.txt 를 고치거나 SITE_URL 을 맞춰 주세요.`
    );
  }
}

export function searchIndexIntegration() {
  return {
    name: 'onjaryo:search-index',
    hooks: {
      'astro:config:setup': async ({ config, logger }) => {
        await writeSearchIndex(logger);
        await checkRobots(config.site, logger);
      },
    },
  };
}
