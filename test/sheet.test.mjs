// 시트 파이프라인 회귀 테스트.
//
// 이 파일이 존재하는 첫 번째 이유는 문법이다. fetch-sheet.mjs 가 깨진 채
// 배포된 적이 있다. 빌드는 sync 에서 죽고, Vercel 은 마지막 성공한 배포를
// 계속 내보내므로 "시트에 써도 사이트가 안 바뀐다" 로만 보인다.
// 이 파일이 모듈을 import 하는 것만으로 그런 깨짐은 테스트에서 먼저 걸린다.
//
//   node --test test/sheet.test.mjs

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeDate, normalizeGrade, parseCsv } from '../scripts/fetch-sheet.mjs';

test('모듈이 문법 오류 없이 불러와진다', () => {
  assert.equal(typeof parseCsv, 'function');
  assert.equal(typeof normalizeGrade, 'function');
  assert.equal(typeof normalizeDate, 'function');
});

test('CSV 파서가 따옴표 안의 쉼표·줄바꿈·이중따옴표를 살린다', () => {
  const rows = parseCsv('a,b\n"쉼표, 포함","줄\n바꿈"\n"큰따옴표 ""안"" 쪽",끝');
  assert.deepEqual(rows[0], ['a', 'b']);
  assert.deepEqual(rows[1], ['쉼표, 포함', '줄\n바꿈']);
  assert.deepEqual(rows[2], ['큰따옴표 "안" 쪽', '끝']);
});

test('CSV 파서가 완전히 빈 줄만 버린다', () => {
  // 값이 하나라도 있으면 남아야 한다. 뒤 칸이 비었다고 행을 버리면
  // 시트에서 뒷열을 안 채운 자료가 통째로 사라진다.
  const rows = parseCsv('a,b,c\n1,,\n\n,,\n2,3,4');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '', ''], ['2', '3', '4']]);
});

test('BOM 이 붙어 와도 첫 열 이름이 깨지지 않는다', () => {
  assert.deepEqual(parseCsv('﻿id,title\nx,y')[0], ['id', 'title']);
});

test('학년 표기의 흔들림을 흡수한다', () => {
  for (const [input, expected] of [
    ['3학년', '초3'],
    ['초등 3학년', '초3'],
    ['초3', '초3'],
    ['초등3', '초3'],
    [' 초6 ', '초6'],
    ['중 2학년', '중2'],
    ['중2', '중2'],
    ['고1', '고1'],
    ['고등 1학년', '고1'],
    ['유치원', '유아'],
    ['유아', '유아'],
  ]) {
    assert.equal(normalizeGrade(input), expected, `${input} → ${expected}`);
  }
});

test('없는 학년은 조용히 버리지 않고 null 을 준다', () => {
  for (const bad of ['7학년', '초7', '중5', '고4', '', '  ', '학년', null, undefined]) {
    assert.equal(normalizeGrade(bad), null, `거부: ${JSON.stringify(bad)}`);
  }
});

test('날짜 표기를 ISO 로 맞춘다', () => {
  assert.equal(normalizeDate('2026-03-04'), '2026-03-04');
  assert.equal(normalizeDate('2026.3.4'), '2026-03-04');
  assert.equal(normalizeDate('2026/03/04'), '2026-03-04');
  assert.equal(normalizeDate('2026년 3월 4일'), '2026-03-04');
  assert.equal(normalizeDate('2026-03'), '2026-03-01');
  assert.equal(normalizeDate(''), null);
});

test('말이 안 되는 날짜는 null 이다', () => {
  // 13월·32일은 받아 주면 안 된다. 정렬이 조용히 어긋난다.
  assert.equal(normalizeDate('2026-13-01'), null);
  assert.equal(normalizeDate('2026-01-32'), null);
});
