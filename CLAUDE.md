# CLAUDE.md — 교육자료 아카이브 빌드 명세

이 저장소에서 작업할 때 이 문서를 먼저 읽는다. 배경과 판단 근거는 `docs/plan.md`에 있다. 이 문서는 무엇을 만들지만 다룬다.

---

## 확정된 기술 결정

이미 검토를 끝냈다. 다시 논의하지 않는다.

| 항목 | 결정 |
|---|---|
| 프레임워크 | Astro (정적 출력, `output: 'static'`) |
| 데이터 원천 | Google Sheets — gviz CSV, API 키 없음 |
| DB | 없음. 빌드 시 JSON 생성 |
| 검색 | 자체 경량 색인 + 클라이언트 매칭 (**Pagefind 금지** — 한국어 어절 문제) |
| 배포 | Vercel + GitHub Actions 일 1회 재빌드 |
| 스타일 | 순수 CSS. CSS 프레임워크 도입하지 않음 |
| 폰트 | 본문 Pretendard, 자료 제목 Gowun Batang |

---

## 절대 하지 말 것

- 파일 업로드·호스팅 기능
- 회원가입, 로그인, 즐겨찾기, 댓글, 별점
- 교육청 사이트 크롤링
- 원문 텍스트를 요약란에 복사
- 광고 코드 삽입
- 클라이언트 렌더링으로 목록·상세 생성 (SEO가 무너짐)

---

## 파일 구조

```
.
├── CLAUDE.md
├── docs/plan.md
├── astro.config.mjs
├── package.json
├── scripts/
│   ├── fetch-sheet.mjs        # 완성됨. 시트 → JSON
│   └── check-links.mjs        # 월 1회 링크 점검
├── public/
│   ├── robots.txt
│   └── og-default.png
└── src/
    ├── data/                  # 빌드 산출물. .gitignore
    ├── lib/
    │   ├── search.js          # 색인 생성 + 매칭 로직
    │   └── taxonomy.js        # 분류값 상수
    ├── layouts/
    │   └── Base.astro
    ├── components/
    │   ├── ResourceCard.astro
    │   ├── SearchBox.astro
    │   ├── FilterBar.astro
    │   └── TopicNav.astro
    └── pages/
        ├── index.astro
        ├── search.astro
        ├── about.astro
        ├── submit.astro
        ├── r/[id].astro       # 완성됨
        ├── topic/[slug].astro
        ├── level/[slug].astro
        ├── org/[code].astro
        ├── tag/[slug].astro
        └── sitemap.xml.js
```

`scripts/fetch-sheet.mjs`와 `src/pages/r/[id].astro`는 이미 작성되어 있다. 나머지를 채운다.

---

## 데이터 계약

`src/data/resources.json` — 배열, 각 항목:

```ts
{
  id: string            // "jje-260304-k2p" — URL이 됨. 절대 변경 금지
  title: string
  summary: string
  tip: string | null    // "언제 쓰나"
  sourceUrl: string
  orgCode: string
  publishedAt: string | null   // "2026-03-04"
  year: number | null
  audiences: string[]
  schoolLevels: string[]
  grades: string[]
  subjects: string[]
  topics: string[]      // 필수, 1개 이상
  resourceType: string | null
  fileFormats: string[]
  license: string       // "제1유형" | ... | "미표기"
  tags: string[]
  linkCheckedAt: string | null
}
```

`src/data/organizations.json`:

```ts
{ code, name, shortName, region, orgType, parent, homepage }
```

---

## 분류값 (확정)

`src/lib/taxonomy.js`에 상수로 둔다. **추가만 하고 기존 값을 수정하지 않는다.** 값이 곧 URL이라 바꾸면 색인이 날아간다.

```js
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

---

## 검색 구현 명세

`src/lib/search.js`

**색인 생성 (빌드 시)** — `public/search-index.json`으로 출력한다.

항목당:
```js
{
  i: id,
  t: title,
  o: 기관 약칭,
  d: publishedAt,
  k: 검색키                    // 아래 규칙
}
```

검색키 = `제목 + 요약 + 활용팁 + 태그 + 영역 + 기관명`을 이어붙인 뒤,
공백과 문장부호를 모두 제거하고 소문자화한 문자열.
띄어쓰기 차이를 흡수하기 위함이다. "안전 교육"과 "안전교육"이 같게 매칭돼야 한다.

**매칭 (클라이언트)**

1. 질의를 공백으로 분해, 각 조각에서 공백·부호 제거
2. **모든 조각**이 `k`에 포함된 항목만 통과 (AND)
3. 점수: 제목 포함 3점, 그 외 1점. 조각별로 합산
4. 정렬: 점수 내림차순 → `d` 최신순
5. 결과 상한 100건, 20건씩 더보기

**로딩**: 색인은 검색창에 처음 입력할 때 한 번만 `fetch`한다. 초기 페이지 로드를 막지 않는다. 로딩 중에는 입력은 받되 결과 영역에 진행 표시를 둔다.

**빈 결과**: "찾는 자료가 없습니다"로 끝내지 말고, 제보 페이지 링크와 영역 목록을 함께 보여준다.

---

## 페이지별 요구사항

### `index.astro`
- 히어로: 한 줄 소개 + 검색창. 필터 드롭다운을 두지 않는다.
- 영역 바로가기 20개를 칩 형태로. 자료가 0건인 영역은 숨긴다.
- 최근 등록 10건.
- 하단에 총 등록 건수와 마지막 갱신일.

### `search.astro`
- `?q=` 쿼리로 진입 가능. 공유 가능한 URL이어야 한다.
- 결과 위에 필터 바(학교급 / 영역 / 자료유형). **여기서만** 필터를 노출한다.
- 필터는 결과를 클라이언트에서 좁히며, 상태를 URL 쿼리에 반영한다.

### `topic/[slug].astro`, `level/[slug].astro`, `org/[code].astro`, `tag/[slug].astro`
- 네 페이지 모두 같은 구조. 목록 렌더링은 `ResourceCard`로 공유한다.
- 각 페이지 상단에 그 분류에 대한 2~3문장 설명을 둔다. 링크만 나열된 페이지는 구글이 저품질로 판단한다.
- `org` 페이지에는 기관 홈페이지 링크와 소속 관계(상위기관)를 표시한다.
- `getStaticPaths`는 실제 존재하는 값에서만 생성한다. 빈 페이지를 만들지 않는다.

### `sitemap.xml.js`
- 전체 상세 페이지 + 분류 페이지 포함. `lastmod`는 `publishedAt` 사용.
- `@astrojs/sitemap` 대신 직접 생성해도 된다. 어느 쪽이든 `robots.txt`에 위치를 명시한다.

### `public/robots.txt`
```
User-agent: *
Allow: /
Sitemap: https://<도메인>/sitemap.xml
```

### `submit.astro`
- 구글 폼 임베드로 시작한다. 자체 폼을 만들지 않는다.

---

## 컴포넌트

**`ResourceCard.astro`** — props: `resource`, `org`, `compact?`
제목(링크) / 요약 2줄 말줄임 / 기관 약칭 / 발행일 / 영역 칩.
목록 페이지 네 곳과 홈에서 재사용된다.

**`Base.astro`** — props: `title`, `description`, `canonical`, `ogType?`
`r/[id].astro`의 `<head>`와 스타일 토큰을 여기로 추출한다.

CSS 변수는 `Base.astro`에 한 번만 정의한다:
```css
--ink:#14213d; --paper:#fbfbf9; --line:#dfdfd6;
--muted:#67707f; --go:#16624f; --go-dark:#0f4a3b;
```

---

## 작업 순서

커밋 단위로 나눈다. 각 단계에서 `npm run build`가 통과해야 다음으로 간다.

1. Astro 초기화, `Base.astro` 추출, `r/[id].astro`가 빌드되는지 확인
2. `taxonomy.js` + `ResourceCard.astro`
3. 목록 페이지 4종 (`topic` / `level` / `org` / `tag`)
4. `search.js` 색인 생성을 빌드 파이프라인에 연결
5. `search.astro` + `SearchBox.astro`
6. `index.astro`
7. `about.astro`, `submit.astro`
8. `sitemap.xml.js`, `robots.txt`, OG 이미지
9. `check-links.mjs`
10. Vercel 배포 + GitHub Actions cron

`package.json`:
```json
"scripts": {
  "sync": "node scripts/fetch-sheet.mjs",
  "build": "npm run sync && astro build",
  "dev": "npm run sync && astro dev",
  "check-links": "node scripts/check-links.mjs"
}
```

---

## 수용 기준

- 자바스크립트를 끈 상태에서도 상세 페이지와 목록 페이지가 완전히 읽힌다. 검색만 JS를 요구한다.
- 모든 페이지가 360px 폭에서 가로 스크롤 없이 표시된다.
- 키보드 탭 이동 시 포커스가 항상 보인다.
- 상세 페이지 `<title>`, `meta description`, `canonical`, JSON-LD가 모두 채워진다.
- `npm run build`가 경고 없이 통과하고, `fetch-sheet.mjs`의 데이터 경고는 콘솔에 남는다.
- 요약이 비어 있는 자료는 빌드 산출물에 포함되지 않는다.
