// 원문 링크 클릭 기록.
//
// 이 사이트의 존재 이유가 "발행 기관 쪽 조회 수를 늘리는 것"이라,
// 여기서 몇 명이 원문으로 넘어갔는지가 사실상 유일하게 중요한 지표다.
// 자료를 만든 사람에게 "이만큼 쓰이고 있다"를 보여 주기 위한 숫자이기도 하다.
//
// 개인정보는 아무것도 남기지 않는다. 자료별 누적 횟수만 센다.

import { cmd, isEnabled, isResourceId } from './_kv.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }

  // sendBeacon 은 응답을 보지 않는다. 실패해도 사용자 흐름을 막지 않게
  // 어떤 경우에도 빠르게 204 로 끝낸다.
  if (!isEnabled()) return res.status(204).end();

  let id = null;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    id = body?.id ?? null;
  } catch {
    return res.status(400).end();
  }
  if (!isResourceId(id)) return res.status(400).end();

  try {
    await cmd('INCR', `click:${id}`);
  } catch {
    // 집계 실패는 사용자에게 알릴 일이 아니다. 조용히 넘어간다.
  }
  return res.status(204).end();
}
