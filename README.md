# 온자료 — 교육자료 아카이브

시·도교육청과 산하기관이 공개한 교육자료를 영역·학교급·기관별로 정리한 정적 사이트.
파일을 보관하지 않고 원문으로 가는 링크만 둔다.

무엇을 만들지는 [`CLAUDE.md`](./CLAUDE.md), 왜 그렇게 정했는지는
[`docs/plan.md`](./docs/plan.md)에 있다.

## 빠른 시작

```bash
npm install
npm run dev        # sync 후 개발 서버
```

`SHEET_ID`가 없으면 `scripts/seed/*.csv`로 빌드한다. 시드는 개발용 예시 데이터라
사이트 하단에 "예시 데이터" 표시가 붙는다.

## 스크립트

| 명령 | 하는 일 |
|---|---|
| `npm run sync` | 구글 시트(gviz CSV) → `src/data/*.json` |
| `npm run dev` | sync 후 개발 서버 |
| `npm run build` | sync 후 정적 빌드 (`dist/`) |
| `npm test` | 검색 로직 회귀 테스트 |
| `npm run check-links` | 원문 링크 점검 → `reports/link-check.json` |

검색 색인(`public/search-index.json`)은 Astro 인티그레이션이 빌드마다 다시 만든다.
따로 실행할 필요가 없다.

## 환경변수

`.env.example`을 `.env`로 복사해 채운다.

| 이름 | 쓰임 |
|---|---|
| `SHEET_ID` | 자료 시트 문서 ID. 비우면 시드 CSV로 빌드 |
| `SHEET_RESOURCES_GID` | 자료 탭 gid (기본 `0`) |
| `SHEET_ORGS_GID` | 기관 탭 gid. 비우면 시트명 `organizations`로 찾는다 |
| `SITE_URL` | 배포 도메인. 사이트맵·canonical·OG에 쓰인다 |
| `PUBLIC_SUBMIT_FORM_URL` | 제보용 구글 폼 주소. 비우면 제보 페이지가 메일 안내로 바뀐다 |

`SITE_URL`을 바꿀 때는 `public/robots.txt`의 `Sitemap:` 줄도 같이 고친다.
어긋나면 빌드가 경고한다.

## 시트 준비

시트를 "링크가 있는 모든 사용자에게 공개"로 두면 API 키 없이 읽힌다.
탭은 둘이다.

**자료 탭** — 열 이름은 영문/한글 아무거나 쓴다 (`scripts/fetch-sheet.mjs`의
`FIELD_ALIASES` 참고).

`id` `title` `summary` `tip` `sourceUrl` `orgCode` `publishedAt` `audiences`
`schoolLevels` `grades` `subjects` `topics` `resourceType` `fileFormats`
`license` `tags` `linkCheckedAt` `status`

- `id`는 URL이 된다. **한 번 정하면 절대 바꾸지 않는다.** 소문자·숫자·하이픈만.
  관례는 `기관코드-YYMMDD-임의3자`.
- `topics`는 하나 이상 필수. `src/lib/taxonomy.js`의 `TOPICS`에 있는 값만 인정한다.
- `summary`가 비면 그 행은 빌드 산출물에서 빠진다.
- `status`를 `비공개`로 두면 내려간다.
- 여러 값을 넣는 열은 쉼표로 나눈다. `디지털·AI`처럼 값 안에 `·`가 있는
  열(`topics`, `tags`, `subjects`)은 쉼표·세미콜론·줄바꿈만 구분자로 본다.

**기관 탭** — `code` `name` `shortName` `region` `orgType` `parent` `homepage`

시트에 문제가 있으면 sync가 콘솔에 경고를 남기고 해당 행만 건너뛴다.
빌드는 멈추지 않는다.

## 배포 (Vercel)

1. 저장소를 Vercel 프로젝트에 연결한다. 프레임워크 프리셋은 Astro,
   빌드 명령은 `npm run build`, 출력은 `dist` (`vercel.json`에 적혀 있다).
2. 프로젝트 환경변수에 `SHEET_ID`, `SITE_URL`, 필요하면 `PUBLIC_SUBMIT_FORM_URL`을 넣는다.
3. Settings → Git → Deploy Hooks 에서 훅을 만들고, 그 URL을 GitHub 저장소
   secret `VERCEL_DEPLOY_HOOK_URL`에 넣는다.

시트가 바뀌어도 정적 사이트는 다시 빌드해야 반영된다. `.github/workflows/rebuild.yml`이
매일 05:20 KST에 배포 훅을 두드린다.

## 운영

- **월 1회 링크 점검** — `.github/workflows/check-links.yml`이 매월 2일에 돌고,
  끊긴 링크가 있으면 워크플로가 실패한다. 결과는 아티팩트(`link-check`)로 남는다.
  끊긴 링크는 시트의 `sourceUrl`을 고치거나 `status`를 `비공개`로 바꾼다.
  이 워크플로는 `SHEET_ID` secret이 필요하다.
- **분류값 추가** — `src/lib/taxonomy.js`에 값을 넣고 설명문도 같이 넣는다.
  **기존 값은 수정하지 않는다.** 값이 곧 URL이라 바꾸면 그동안 공유된 링크가 끊긴다.
- **OG 이미지 재생성** — `npm i --no-save @resvg/resvg-js` 후
  `node scripts/make-og.mjs --fonts <Gowun Batang ttf 폴더>`.

## 구조

```
scripts/fetch-sheet.mjs     시트 → JSON, 검증과 경고
scripts/check-links.mjs     원문 링크 점검
scripts/make-og.mjs         OG 이미지 생성 (가끔)
src/lib/taxonomy.js         분류값 상수 + 분류별 설명문
src/lib/data.js             JSON 로드 + 그룹 색인 (빌드 전용)
src/lib/search.js           검색키 정규화 + 매칭 (빌드/브라우저 공용)
src/lib/search-integration.mjs  색인 생성을 빌드에 매다는 인티그레이션
src/lib/site.js             URL 헬퍼, 날짜/조사 포맷
```
