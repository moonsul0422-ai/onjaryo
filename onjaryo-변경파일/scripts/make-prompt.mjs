#!/usr/bin/env node
// 큐레이션 프롬프트를 분류값에서 직접 만들어 낸다.
//
//   npm run prompt          터미널에 출력 (복사해서 Claude 에 붙여넣기)
//   npm run prompt -- --write   docs/curation-prompt.md 로 저장
//
// 손으로 적어 두면 taxonomy.js 를 고칠 때마다 어긋난다. 그래서 생성한다.

import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUDIENCES, GRADES, GRADE_LABELS, LICENSES, SUBJECTS, TOPICS, TYPES,
} from '../src/lib/taxonomy.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/curation-prompt.md');

// 시트 열 순서. fetch-sheet.mjs 의 FIELD_ALIASES 와 같은 순서로 둔다.
const COLUMNS = [
  'id', 'title', 'summary', 'tip', 'sourceUrl', 'orgCode', 'publishedAt',
  'audiences', 'schoolLevels', 'grades', 'subjects', 'topics',
  'resourceType', 'fileFormats', 'license', 'tags', 'status', 'coverImage',
];

function orgTable() {
  const path = resolve(ROOT, 'src/data/organizations.json');
  if (!existsSync(path)) return '  (npm run sync 를 돌리면 여기에 기관 코드 목록이 들어갑니다)';
  const orgs = JSON.parse(readFileSync(path, 'utf8'));
  return orgs.map((o) => `  ${o.code.padEnd(8)} ${o.name}`).join('\n');
}

const gradeList = GRADES.map((g) => `${g}(${GRADE_LABELS[g]})`).join(', ');

export function buildPrompt() {
  return `# 큐레이션 프롬프트

교육청 자료 페이지 링크를 Claude에 붙여넣을 때 **아래 전체를 함께** 붙여넣습니다.
돌아온 줄을 그대로 복사해 시트 맨 아래에 붙여넣으면 열이 자동으로 나뉩니다
(탭으로 구분되어 있어서 그렇습니다).

\`npm run prompt\` 로 언제든 최신 분류값이 반영된 프롬프트를 다시 뽑을 수 있습니다.

---

## 여기서부터 복사

당신은 교육자료 아카이브의 큐레이터입니다. 제가 주는 교육청 자료 페이지 링크를 열어
내용을 확인하고, 아래 규칙에 맞춰 **탭으로 구분된 한 줄**을 만들어 주세요.

### 가장 중요한 규칙

1. **지어내지 마세요.** 페이지를 열 수 없거나, 본문이 비어 있고 첨부파일(HWP/PDF)에만
   내용이 있어 무슨 자료인지 알 수 없으면 — 그 줄 대신 \`확인필요\t<링크>\t<이유>\` 한 줄만
   주세요. 교육청 게시글은 제목만 있고 내용이 첨부에 든 경우가 흔합니다. 제목만 보고
   요약을 상상해서 쓰면 안 됩니다.
2. **원문 문장을 그대로 옮기지 마세요.** 요약은 직접 새로 씁니다.
3. 링크를 여러 개 주면 **한 줄씩** 만들어 주세요. 설명이나 머리말 없이 줄만 주세요.

### 출력 형식 (탭 구분, 이 순서 그대로 ${COLUMNS.length}칸)

(시트 첫 줄의 열 이름이 이 순서와 같아야 붙여넣기가 맞습니다. 아래 **시트 준비** 참고.)

\`\`\`
${COLUMNS.join('\t')}
\`\`\`

### 칸별 작성 규칙

- **id** — \`기관코드-YYMMDD-임의3자\` 형식. 발행일 기준. 소문자·숫자·하이픈만.
  예: 발행일이 2026-03-04인 제주교육청 자료 → \`jje-260304-k2p\`
  (임의 3자는 아무 소문자/숫자나 골라 주세요. 중복만 피하면 됩니다.)
- **title** — 원문 제목을 쓰되 \`[○○교육청]\`, \`2026학년도\` 같은 머리말은 뺍니다.
  무슨 자료인지 제목만 봐도 알게 다듬어 주세요.
- **summary** — **2문장.** 이 자료에 무엇이 들어 있는지 구체적으로. 차시 수, 활동 개수,
  부록 유무처럼 실제로 쓸 사람이 궁금해할 것을 씁니다.
  ("좋은 자료입니다" 같은 평가는 쓰지 마세요.)
- **tip** — **1문장.** "언제 쓰나". 어떤 상황에서 이 자료를 꺼내 쓰게 되는지.
  예: "3월 진단 결과가 나온 직후 개별 지도 계획을 세울 때 씁니다."
- **sourceUrl** — 제가 준 링크 그대로.
- **orgCode** — 아래 목록에서 고릅니다.
- **publishedAt** — \`YYYY-MM-DD\`. 게시일을 못 찾으면 비워 두세요.
- **audiences** — ${AUDIENCES.join(', ')} 중에서. 쉼표로 여러 개.
- **schoolLevels** — **비워 두세요.** grades를 적으면 자동으로 채워집니다.
  학년이 없는 자료(업무 양식, 지침 등)일 때만 유아/초등/중학/고교/특수/전체 중에서 고릅니다.
- **grades** — 아래 목록에서. 쉼표로 여러 개. 학년이 없는 자료면 비웁니다.
- **subjects** — 아래 목록에서. 교과 수업자료가 아니면 비웁니다.
- **topics** — 아래 목록에서. **최소 1개 필수.** 교과 자료여도 반드시 하나는 답니다.
- **resourceType** — 아래 목록에서 하나.
- **fileFormats** — HWP, PDF, PPTX, XLSX, MP4 등. 쉼표로 여러 개.
- **license** — ${LICENSES.join(', ')} 중에서. 공공누리 표시가 없으면 \`미표기\`.
- **tags** — 3~5개. 주제보다 좁은 낱말. 사람들이 검색창에 칠 법한 말로.
- **status** — 비워 두세요.
- **coverImage** — 비워 두세요. 표지 이미지는 사람이 직접 넣습니다.

### 분류값 (여기 없는 값은 쓰지 마세요)

**grades**
${gradeList}

**subjects**
${SUBJECTS.join(', ')}

**topics**
${TOPICS.join(', ')}

**resourceType**
${TYPES.join(', ')}

**orgCode**
\`\`\`
${orgTable()}
\`\`\`
(목록에 없는 기관이면 \`신규기관: <기관 정식명칭>\`이라고 알려 주세요. 제가 기관 탭에 먼저 추가하겠습니다.)

### 예시

입력: (제주교육청 안전교육 자료 페이지 링크)

출력:
\`\`\`
jje-260304-k2p\t제주 학교 안전교육 연간 지도자료\t지역 여건을 반영한 안전교육 연간 지도 계획과 차시별 자료를 묶었습니다. 해양 안전과 태풍 대비 내용이 별도 영역으로 들어 있습니다.\t연간 안전교육 계획을 세울 때 지역 특성 부분만 갈아 끼워 쓸 수 있습니다.\thttps://www.jje.go.kr/...\tjje\t2026-03-04\t교사\t\t초3,초4\t창의적 체험활동\t안전\t교수학습자료\tHWP,PDF\t제1유형\t안전교육,해양안전,태풍,연간계획\t
\`\`\`

## 여기까지 복사

---

## 시트 준비 (처음 한 번)

자료 탭 첫 줄에 이 헤더를 그대로 넣습니다. 열 이름만 맞으면 순서는 자유지만,
프롬프트 출력을 그대로 붙여넣으려면 이 순서가 편합니다.

\`\`\`
${COLUMNS.join('\t')}
\`\`\`

기관 탭 첫 줄:

\`\`\`
code\tname\tshortName\tregion\torgType\tparent\thomepage
\`\`\`

시트는 "링크가 있는 모든 사용자에게 공개"로 둡니다. API 키 없이 읽습니다.

## 붙여넣은 뒤

1. 시트 맨 아래 줄에 붙여넣습니다. 탭 구분이라 열이 알아서 나뉩니다.
2. **요약과 활용팁을 직접 읽어 보고 고칩니다.** 이 두 칸이 이 사이트의 값어치 전부입니다.
3. \`확인필요\`로 돌아온 링크는 직접 열어 보고 판단합니다.
4. 다음 빌드(매일 05:20 KST 자동, 또는 Vercel에서 수동 재배포)에 반영됩니다.

잘못된 값이 들어가면 \`npm run sync\`가 콘솔에 경고를 남기고 그 행만 건너뜁니다.
빌드가 통째로 실패하지는 않습니다.
`;
}

const prompt = buildPrompt();

if (process.argv.includes('--write')) {
  await writeFile(OUT, prompt);
  console.log(`docs/curation-prompt.md 갱신 (${prompt.length}자)`);
} else {
  console.log(prompt);
}
