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
| `npm test` | 검색 로직 + 카운터 엔드포인트 테스트 |
| `npm run test:browser` | 브라우저 테스트 (미리보기 서버 + playwright-core 필요) |
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
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | 조회 카운터 저장소. 없으면 카운터가 조용히 꺼진다 |

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
- `grades`는 `3학년` `초등 3학년` `초3` 어떻게 적어도 `초3`으로 정규화된다.
  학년을 적으면 `schoolLevels`는 자동으로 채워지므로 시트에 적지 않아도 된다.
- `subjects`는 `src/lib/taxonomy.js`의 `SUBJECTS`에 있는 값만 인정한다.
- `topics`는 하나 이상 필수. `TOPICS`에 있는 값만 인정한다.
  교과로 묶이는 자료는 `subjects`를, 안 묶이는 자료는 `topics`를 채우면 된다.
- `summary`가 비면 그 행은 빌드 산출물에서 빠진다.
- `status`를 `비공개`로 두면 내려간다.
- 여러 값을 넣는 열은 쉼표로 나눈다. `디지털·AI`처럼 값 안에 `·`가 있는
  열(`topics`, `tags`, `subjects`)은 쉼표·세미콜론·줄바꿈만 구분자로 본다.

**기관 탭** — `code` `name` `shortName` `region` `orgType` `parent` `homepage`

시트에 문제가 있으면 sync가 콘솔에 경고를 남기고 해당 행만 건너뛴다.
빌드는 멈추지 않는다.

## 조회 카운터

이 사이트의 존재 이유는 **발행 기관 쪽 조회 수를 늘리는 것**이다. 그래서 여기서
원문으로 몇 번 넘어갔는지가 사실상 유일하게 중요한 지표다.

- `api/click.js` — 상세 페이지의 "원문 보러 가기"를 누르면 `sendBeacon`으로 기록한다.
  이동을 늦추지 않고, 실패해도 링크 동작에 영향이 없다.
- `api/visit.js` — 사이트 방문자를 오늘/누적 두 숫자로 센다. 같은 브라우저가 하루에
  여러 번 와도 한 번만 세도록 **날짜만 담은 쿠키** 하나를 쓴다. IP도 UA도 저장하지 않는다.
- 클릭 수는 `npm run sync`가 빌드마다 읽어 `resources.json`에 붙인다. 상세 페이지의
  "N번 이동했습니다"와 홈의 "많이 찾는 자료"가 이 값을 쓴다.

저장소는 Upstash Redis(Vercel KV)다. Vercel 마켓플레이스에서 Upstash를 연동하면
`KV_REST_API_URL` / `KV_REST_API_TOKEN`이 자동으로 들어온다.
**자격증명이 없으면 카운터는 조용히 꺼지고 관련 UI도 나타나지 않는다.** 숫자를 못 가져왔을 때
"0명"을 보여 주지 않는 건 의도적이다 — 그건 거짓말이기 때문이다.

`test/api.test.mjs`가 가짜 Upstash 서버를 띄워 엔드포인트를 검증한다
(id 형식 검사, 하루 1회 집계, 저장소가 죽었을 때의 동작).

> **첫 배포 때 확인할 것**: 루트 `api/` 디렉터리가 Vercel Functions로 잡히는지
> (`https://<도메인>/api/visit`에 POST해서 JSON이 오는지) 한 번 눌러 보세요.
> 잡히지 않으면 `@astrojs/vercel` 어댑터를 붙이고 엔드포인트를
> `src/pages/api/`로 옮기면 됩니다.

## 배포 (Vercel)

1. 저장소를 Vercel 프로젝트에 연결한다. 프레임워크 프리셋은 Astro,
   빌드 명령은 `npm run build`, 출력은 `dist` (`vercel.json`에 적혀 있다).
2. 프로젝트 환경변수에 `SHEET_ID`, `SITE_URL`을 넣는다.
   조회 카운터를 쓰려면 Storage 탭에서 Upstash Redis를 연동한다(위 절 참고).
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
api/_kv.js                  Upstash REST 클라이언트 (자격증명 없으면 비활성)
api/click.js                원문 클릭 기록
api/visit.js                방문자 집계 (오늘/누적)
src/lib/taxonomy.js         분류값 상수 + 분류별 설명문
src/lib/data.js             JSON 로드 + 그룹 색인 (빌드 전용)
src/lib/search.js           검색키 정규화 + 매칭 (빌드/브라우저 공용)
src/lib/search-integration.mjs  색인 생성을 빌드에 매다는 인티그레이션
src/lib/site.js             URL 헬퍼, 날짜/조사 포맷
```
