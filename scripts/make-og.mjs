#!/usr/bin/env node
// public/og-default.png 을 다시 만든다. 자주 돌릴 일이 없어 프로젝트 의존성에
// 넣지 않았다. 필요할 때만:
//
//   npm i --no-save @resvg/resvg-js
//   node scripts/make-og.mjs --fonts <Gowun Batang ttf 가 있는 폴더>
//
// 폰트는 Google Fonts 의 Gowun Batang (OFL).
//   https://github.com/google/fonts/tree/main/ofl/gowunbatang

import { writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/og-default.png');

const W = 1200;
const H = 630;

// Base.astro 의 토큰과 같은 값을 쓴다.
const INK = '#14213d';
const PAPER = '#fbfbf9';
const LINE = '#dfdfd6';
const MUTED = '#67707f';
const GO = '#16624f';

export function buildSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${PAPER}"/>
  <rect x="0" y="0" width="${W}" height="14" fill="${GO}"/>

  <g transform="translate(96, 150)">
    <rect x="0" y="0" width="84" height="84" rx="20" fill="${GO}"/>
    <text x="42" y="59" font-family="Gowun Batang" font-size="46" fill="${PAPER}"
          text-anchor="middle">온</text>
  </g>

  <text x="200" y="196" font-family="Gowun Batang" font-weight="700" font-size="52" fill="${INK}">온자료</text>
  <text x="200" y="232" font-family="Gowun Batang" font-size="24" fill="${MUTED}">전국 교육청 교육자료를 한곳에서</text>

  <line x1="96" y1="300" x2="${W - 96}" y2="300" stroke="${LINE}" stroke-width="2"/>

  <text x="96" y="382" font-family="Gowun Batang" font-weight="700" font-size="56" fill="${INK}">필요한 교육자료,</text>
  <text x="96" y="456" font-family="Gowun Batang" font-weight="700" font-size="56" fill="${INK}">여기서 한 번에</text>

  <text x="96" y="524" font-family="Gowun Batang" font-size="26" fill="${MUTED}">시·도교육청과 산하기관이 공개한 자료를 영역·학교급으로 정리했습니다</text>

  <g transform="translate(96, 556)">
    <rect x="0" y="0" width="196" height="44" rx="22" fill="none" stroke="${GO}" stroke-width="2"/>
    <text x="98" y="30" font-family="Gowun Batang" font-size="22" fill="${GO}" text-anchor="middle">onjaryo.vercel.app</text>
  </g>
</svg>`;
}

function findFonts(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(ttf|otf)$/i.test(f))
    .map((f) => resolve(dir, f));
}

async function main() {
  const flagIndex = process.argv.indexOf('--fonts');
  const fontDir = flagIndex >= 0 ? process.argv[flagIndex + 1] : process.env.OG_FONT_DIR;
  const fontFiles = findFonts(fontDir);

  if (fontFiles.length === 0) {
    console.error('한글 폰트를 찾지 못했습니다. --fonts <폴더> 로 Gowun Batang ttf 위치를 알려 주세요.');
    process.exit(1);
  }

  let Resvg;
  try {
    ({ Resvg } = await import('@resvg/resvg-js'));
  } catch {
    console.error('@resvg/resvg-js 가 없습니다.  npm i --no-save @resvg/resvg-js');
    process.exit(1);
  }

  const resvg = new Resvg(buildSvg(), {
    fitTo: { mode: 'width', value: W },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Gowun Batang' },
  });
  const png = resvg.render().asPng();
  await writeFile(OUT, png);
  console.log(`public/og-default.png · ${W}×${H} · ${(png.length / 1024).toFixed(1)} kB`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
