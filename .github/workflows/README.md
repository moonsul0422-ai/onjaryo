# 워크플로

| 파일 | 언제 | 하는 일 | 필요한 secret |
|---|---|---|---|
| `ci.yml` | push / PR | `npm ci` → sync(시드) → 테스트 → 빌드 | 없음 |
| `rebuild.yml` | 매일 05:20 KST | Vercel 배포 훅 호출 (시트 변경 반영) | `VERCEL_DEPLOY_HOOK_URL` |
| `check-links.yml` | 매월 2일 06:00 KST | 원문 링크 점검, 끊기면 실패 | `SHEET_ID` (선택: `SHEET_RESOURCES_GID`, `SHEET_ORGS_GID`) |

`ci.yml`은 일부러 `SHEET_ID`를 주지 않는다. PR 빌드가 시트 상태에 흔들리면
곤란하기 때문에 항상 `scripts/seed/*.csv`로 돈다.

브라우저 테스트(`test/browser/`)는 크로미움이 필요해 CI에 넣지 않았다.
로컬에서 미리보기 서버를 띄우고 `npm run test:browser`로 돌린다.
