# CLAUDE.md — 교육자료 아카이브 빌드 명세

이 저장소에서 작업할 때 이 문서를 먼저 읽는다. 배경과 판단 근거는 `docs/plan.md`에 있다.
이 문서는 무엇을 만들지만 다룬다.

---

## 이 프로젝트가 존재하는 이유

전국 교육청이 좋은 교육자료를 계속 내놓는데, 기관마다 사이트가 달라 교사도 학부모도
어디에 무엇이 있는지 찾지 못한다. 그 자료들로 가는 **길만** 모은다.

그래서 **파일을 직접 받아 다시 배포하지 않는다.** 여기서 바로 내려받게 하면 편하겠지만,
그러면 발행 기관 쪽 조회 수가 늘지 않는다. 조회 수가 늘지 않으면 그 자료를 만든 교사들의
수고가 기록에 남지 않고, 자료가 안 쓰이는 것처럼 보인다. 한 번 더 눌러야 하는 불편은
의도적으로 남긴다. 이 원칙이 아래 결정을 거의 다 결정한다.

---

## 확정된 기술 결정

이미 검토를 끝냈다. 다시 논의하지 않는다.

| 항목 | 결정 |
|---|---|
| 프레임워크 | Astro (정적 출력, `output: 'static'`) |
| 데이터 원천 | Google Sheets — gviz CSV, API 키 없음 |
| DB | 없음. 빌드 시 JSON 생성 |
| 검색 | 자체 경량 색인 + 클라이언트 매칭 (**Pagefind 금지** — 한국어 어절 문제) |
| 1차 탐색 축 | **학년 × 과목.** 주제는 보조 축 |
| 조회 지표 | 원문 클릭수 + 사이트 방문자(오늘/누적). Upstash Redis(Vercel KV) |
| 배포 | Vercel + GitHub Actions 일 1회 재빌드 |
| 스타일 | 순수 CSS. CSS 프레임워크 도입하지 않음 |
| 폰트 | 본문 Pretendard, 자료 제목 Gowun Batang |
| 등록 | 운영자 1인이 시트에 직접. 링크를 Claude에 붙여 초안을 받고 사람이 검토 |

---

## 절대 하지 말 것

- 파일 업로드·호스팅 기능
- 회원가입, 로그인, 즐겨찾기, 댓글, 별점
- 교육청 사이트 크롤링
- 원문 텍스트를 요약란에 복사
- 광고 코드 삽입
- 클라이언트 렌더링으로 목록·상세 생성 (SEO가 무너짐)
- 방문자를 식별하는 정보 저장 (IP, UA, 외부 분석 도구)
- 숫자를 못 가져왔을 때 `0`을 대신 보여 주기 — 없으면 그 자리를 비운다

---

## 파일 구조

```
.
├── CLAUDE.md
├── docs/
│   ├── plan.md                 # 판단 근거
│   └── curation-prompt.md      # 생성물. scripts/make-prompt.mjs 가 만든다
├── astro.config.mjs
├── vercel.json
├── package.json
├── api/                        # Vercel Functions. 사이트는 정적이고 여기만 서버다
│   ├── _kv.js                  # Upstash REST. 자격증명 없으면 비활성
│   ├── click.js                # 원문 클릭 기록
│   └── visit.js                # 방문자 집계
├── scripts/
│   ├── fetch-sheet.mjs         # 시트 → JSON + 클릭수 부착
│   ├── check-links.mjs         # 월 1회 링크 점검
│   ├── make-prompt.mjs         # 분류값 → 큐레이션 프롬프트
│   ├── make-og.mjs             # OG 이미지 (가끔)
│   └── seed/                   # 시트를 못 읽을 때 쓰는 예시 데이터
├── test/
│   ├── search.test.mjs
│   ├── api.test.mjs
│   └── browser/                # playwright-core 필요. CI 에는 없음
├── public/
│   ├── robots.txt
│   ├── favicon.svg
│   └── og-default.png
└── src/
    ├── data/                   # 빌드 산출물. .gitignore
    ├── lib/
    │   ├── search.js           # 색인 생성 + 매칭 (빌드/브라우저 공용)
    │   ├── search-integration.mjs
    │   ├── taxonomy.js         # 분류값 상수
    │   ├── data.js             # JSON 로드 + 그룹 색인 (빌드 전용)
    │   └── site.js             # URL·날짜·조사 헬퍼
    ├── layouts/Base.astro
    ├── components/
    │   ├── ResourceCard.astro
    │   ├── SearchBox.astro
    │   ├── FilterBar.astro
    │   ├── GradeNav.astro
    │   └── TopicNav.astro
    └── pages/
        ├── index.astro
        ├── search.astro
        ├── about.astro
        ├── submit.astro
        ├── r/[id].astro
        ├── grade/[grade].astro
        ├── grade/[grade]/[subject].astro
        ├── subject/[subject].astro
        ├── topic/[slug].astro
        ├── level/[slug].astro
        ├── org/[code].astro
        ├── tag/[slug].astro
        └── sitemap.xml.js
```

---

## 데이터 계약

`src/data/resources.json` — 배열, 각 항목:

```ts
{
  id: string            // "jje-260304-k2p" — URL이 됨. 절대 변경 금지
  title: string
  summary: string       // 비어 있으면 산출물에서 제외된다
  tip: string | null    // "언제 쓰나"
  sourceUrl: string
  orgCode: string
  publishedAt: string | null   // "2026-03-04"
  year: number | null
  audiences: string[]
  schoolLevels: string[]       // grades 가 있으면 자동 유도
  grades: string[]             // "초3" 형태. 표기 흔들림은 sync 가 정규화
  subjects: string[]
  topics: string[]      // 필수, 1개 이상
  resourceType: string | null
  fileFormats: string[]
  license: string       // "제1유형" | ... | "미표기"
  tags: string[]
  linkCheckedAt: string | null
  clicks: number        // 원문으로 넘어간 횟수. KV 가 없으면 0
}
```

`src/data/organizations.json`:

```ts
{ code, name, shortName, region, orgType, parent, homepage }
```

`src/data/meta.json`: `{ source, syncedAt, total, orgCount, latestPublishedAt,
countersEnabled, totalClicks, warnings }`

---

## 분류값 (확정)

`src/lib/taxonomy.js`에 상수로 둔다. **추가만 하고 기존 값을 수정하지 않는다.**
값이 곧 URL이라 바꾸면 색인이 날아간다. 값을 추가할 때는 설명문도 같이 넣는다.

```js
// 1차 축
export const GRADES = ['유아', '초1'…'초6', '중1'…'중3', '고1'…'고3'];
export const SUBJECTS = [
  '국어', '수학', '사회', '과학', '영어',
  '도덕', '체육', '음악', '미술',
  '실과·기술가정', '정보', '통합교과', '창의적 체험활동',
];

// 보조 축
export const TOPICS = [
  '안전', '학교폭력예방', '생활교육', '상담',
  '진로', '자유학기', '고교학점제',
  '기초학력', '교육과정', '평가',
  '디지털·AI', '정보통신윤리',
  '환경·생태', '독서', '다문화', '인성', '성교육',
  '특수교육', '학급운영', '학부모',
];

export const LEVELS = ['유아', '초등', '중학', '고교', '특수', '전체'];
export const AUDIENCES = ['교사', '학생', '학부모', '관리자'];
export const TYPES = [
  '교수학습자료', '워크북·학습지', '계획서·양식', '연수자료',
  '영상', '웹콘텐츠·프로그램', '매뉴얼·지침', '통계·보고서', '카드뉴스·포스터',
];
```

URL에는 `encodeURIComponent`로 인코딩한 한글을 그대로 쓴다. 로마자 변환하지 않는다.
학년은 URL에 짧은 값(`초3`)을 쓰고 화면에는 `GRADE_LABELS`(`초등 3학년`)를 쓴다.

---

## 검색 구현 명세

`src/lib/search.js` — 빌드와 브라우저가 같은 파일을 쓴다. 규칙이 갈라지면 조용히 어긋난다.

**색인 생성 (빌드 시)** — `public/search-index.json`으로 출력한다.

```js
{
  i: id, t: title, o: 기관 약칭, d: publishedAt,
  k: 검색키,
  g: 학년[], s: 과목[], l: 학교급[], p: 주제[], y: 자료유형   // 필터용. 없으면 키 생략
}
```

검색키 = `제목 + 요약 + 활용팁 + 태그 + 주제 + 학년 + 과목 + 기관명`을 이어붙인 뒤,
**글자와 숫자가 아닌 것을 전부 제거**하고 소문자화한 문자열.
띄어쓰기 차이를 흡수하기 위함이다. "안전 교육"과 "안전교육"이 같게 매칭돼야 한다.

**매칭 (클라이언트)**

1. 질의를 공백으로 분해, 각 조각을 같은 방식으로 정규화
2. **모든 조각**이 `k`에 포함된 항목만 통과 (AND)
3. 점수: 제목 포함 3점, 그 외 1점. 조각별로 합산
4. 정렬: 점수 내림차순 → `d` 최신순
5. 결과 상한 100건, 20건씩 더보기

**로딩**: 색인은 검색창에 처음 입력할 때 한 번만 `fetch`한다(`?q=`로 들어오면 즉시).
초기 페이지 로드를 막지 않는다. 로딩 중에는 입력은 받되 결과 영역에 진행 표시를 둔다.

**필터**: 학년 / 과목 / 주제 / 자료유형. **화면에 select가 있는 필터만** URL 쿼리로
주고받는다. 화면에 없는 필터를 URL로 걸면 보이지도 지워지지도 않는 조건이 된다.

**빈 결과**: "찾는 자료가 없습니다"로 끝내지 말고, 제보 페이지 링크와 분류 목록을 함께 보여준다.

---

## 페이지별 요구사항

### `index.astro`
- 히어로: 한 줄 소개 + 검색창. 필터 드롭다운을 두지 않는다.
- **학년 그리드가 첫 화면.** 학교급별로 줄을 나눈다. 13개를 한 줄에 늘어놓지 않는다.
- 그다음 과목 칩. 주제 칩은 그 아래.
- 클릭이 있으면 "많이 찾는 자료" 5건. 전부 0이면 섹션 자체를 만들지 않는다.
- 최근 등록 10건.
- 하단에 총 등록 건수와 마지막 갱신일.

### `search.astro`
- `?q=` 쿼리로 진입 가능. 공유 가능한 URL이어야 한다.
- 결과 위에 필터 바. **여기서만** 필터를 노출한다.
- 필터는 결과를 클라이언트에서 좁히며, 상태를 URL 쿼리에 반영한다.

### `grade/[grade]`, `subject/[subject]`, `grade/[grade]/[subject]`
- 학년 페이지는 그 학년에 자료가 있는 **과목만** 다음 클릭지로 보여준다. 반대도 같다.
- 교차 페이지는 자료가 있는 조합에서만 만든다.
- 교차 페이지에는 옆으로 갈 길(같은 학년의 다른 과목, 같은 과목의 다른 학년)을 둔다.

### `topic/[slug]`, `level/[slug]`, `org/[code]`, `tag/[slug]`
- 목록 렌더링은 `ResourceCard`로 공유한다.
- 각 페이지 상단에 그 분류에 대한 2~3문장 설명을 둔다. 링크만 나열된 페이지는
  구글이 저품질로 판단한다.
- `org` 페이지에는 기관 홈페이지 링크와 소속 관계(상위기관)를 표시한다.
- `getStaticPaths`는 실제 존재하는 값에서만 생성한다. 빈 페이지를 만들지 않는다.

### `sitemap.xml.js`
- 전체 상세 페이지 + 분류 페이지 포함. `lastmod`는 `publishedAt` 사용.
- `robots.txt`에 위치를 명시한다. 도메인이 어긋나면 빌드가 경고한다.

### `submit.astro`
- 구글 폼 임베드로 시작한다. 자체 폼을 만들지 않는다.

---

## 조회 지표

`api/click.js`, `api/visit.js` — 사이트에서 유일한 서버 부분이다.

- **클릭**: 상세 페이지의 "원문 보러 가기"를 `sendBeacon`으로 기록한다. 이동을 늦추지 않고,
  실패해도 링크 동작에 영향이 없어야 한다. id는 형식을 검사한다.
- **방문자**: 오늘/누적 두 숫자만. 같은 브라우저는 하루 1회만 센다. 쿠키에는 **날짜만** 담는다.
  IP·UA를 저장하지 않는다. 날짜 키는 400일 뒤 만료.
- 클릭 수는 `npm run sync`가 빌드마다 읽어 `resources.json`에 붙인다.
- **자격증명이 없으면 조용히 꺼진다.** 관련 UI도 나타나지 않는다.

---

## 컴포넌트

**`ResourceCard.astro`** — props: `resource`, `org`, `compact?`, `headingLevel?`
제목(링크) / 요약 2줄 말줄임 / 기관 약칭 / 발행일 / 학년(`초3~4`로 접어서) / 과목·주제 칩.
목록 페이지와 홈에서 재사용되고, 검색 결과는 같은 클래스로 `compact` 형태를 다시 그린다.
마크업을 바꾸면 `search.astro`의 렌더 함수도 같이 고친다.

**카드 CSS는 `Base.astro`의 전역 블록에 둔다.** 컴포넌트 파일에 넣으면 그 컴포넌트를
import 하는 페이지에만 딸려 간다. `search.astro`는 카드를 클라이언트에서 그리므로
컴포넌트를 import 하지 않고, 그래서 스타일이 통째로 빠진다.

**`Base.astro`** — props: `title`, `description`, `canonical`, `ogType?`
CSS 변수는 여기 한 번만 정의한다:
```css
--ink:#14213d; --paper:#fbfbf9; --line:#dfdfd6;
--muted:#67707f; --go:#16624f; --go-dark:#0f4a3b;
```

---

## `package.json`

```json
"scripts": {
  "sync": "node scripts/fetch-sheet.mjs",
  "build": "npm run sync && astro build",
  "dev": "npm run sync && astro dev",
  "test": "node --test test/*.test.mjs",
  "test:browser": "node test/browser/search.test.mjs && node test/browser/accept.test.mjs",
  "check-links": "node scripts/check-links.mjs",
  "prompt": "node scripts/make-prompt.mjs"
}
```

---

## 운영

- 자료 등록: 교육청 링크를 `docs/curation-prompt.md`와 함께 Claude에 붙여넣고,
  돌아온 탭 구분 줄을 시트에 붙인 뒤 **요약과 활용팁을 직접 읽고 고친다.**
  그 두 칸이 이 사이트의 값어치 전부다.
- 분류값을 추가하면 `npm run prompt -- --write`로 프롬프트를 다시 뽑는다.
- 시트가 바뀌어도 정적 사이트는 다시 빌드해야 반영된다. 매일 05:20 KST 자동.

---

## 수용 기준

- 자바스크립트를 끈 상태에서도 상세 페이지와 목록 페이지가 완전히 읽힌다.
  검색과 조회 지표만 JS를 요구한다.
- 모든 페이지가 360px 폭에서 가로 스크롤 없이 표시된다.
- 키보드 탭 이동 시 포커스가 항상 보인다.
- 상세 페이지 `<title>`, `meta description`, `canonical`, JSON-LD가 모두 채워진다.
- `npm run build`가 경고 없이 통과하고, `fetch-sheet.mjs`의 데이터 경고는 콘솔에 남는다.
- 요약이 비어 있는 자료는 빌드 산출물에 포함되지 않는다.
- 카운터 저장소가 없거나 죽어도 사이트는 그대로 동작한다.
