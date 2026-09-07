// 방문자 수. 오늘 / 누적 두 숫자만 돌려준다.
//
// 로그인도 추적도 없다. 같은 브라우저가 하루에 여러 번 와도 한 번만 세도록
// 날짜만 담은 쿠키 하나를 쓴다. IP도 UA도 저장하지 않는다.

import { cmd, isEnabled, pipeline, todayKST, toInt } from './_kv.js';

const COOKIE = 'onjaryo_v';

function alreadyCountedToday(req, today) {
  const raw = req.headers?.cookie || '';
  return raw.split(';').some((part) => part.trim() === `${COOKIE}=${today}`);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!isEnabled()) {
    // 카운터가 꺼져 있으면 그렇다고 말한다. 0을 돌려주면 화면이 "0명"을 보여 준다.
    return res.status(200).json({ enabled: false });
  }

  const today = todayKST();
  const dayKey = `visit:${today}`;

  try {
    if (alreadyCountedToday(req, today)) {
      const [todayCount, total] = await pipeline([
        ['GET', dayKey],
        ['GET', 'visit:total'],
      ]);
      return res.status(200).json({
        enabled: true,
        today: toInt(todayCount),
        total: toInt(total),
      });
    }

    const [todayCount, total] = await pipeline([
      ['INCR', dayKey],
      ['INCR', 'visit:total'],
    ]);
    // 날짜별 키는 무한정 쌓일 이유가 없다. 400일 뒤 스스로 사라지게 한다.
    cmd('EXPIRE', dayKey, 60 * 60 * 24 * 400).catch(() => {});

    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${today}; Path=/; Max-Age=86400; SameSite=Lax; Secure; HttpOnly`
    );
    return res.status(200).json({
      enabled: true,
      today: toInt(todayCount),
      total: toInt(total),
    });
  } catch {
    return res.status(200).json({ enabled: false });
  }
}
