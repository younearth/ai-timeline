// schema.js — 공통 이벤트 스키마
// 역할: 모든 수집기가 따르는 이벤트 형식 정의
//
// 저장 형식: append-only JSONL, 한 줄 = 이벤트 하나.
// build.js가 taskId로 이벤트를 묶어 작업 단위 레코드(Task)를 만든다.
//
// 공통 필드 (모든 이벤트)
//   v          스키마 버전 (현재 1)
//   type       'prompt' | 'tool' | 'stop' | 'report'
//   taskId     작업 id — `<device>-<YYYYMMDDTHHmmss>-<hex4>`
//   project    config.projects[].name (기기 간 공통 키)
//   agent      수집기 이름 (claude-code, git 등)
//   device     config.device
//   sessionId  AI 도구 세션 id (없으면 null)
//   at         시간대 포함 ISO 시각
//
// 타입별 필드
//   prompt  request, baseHead
//   tool    tool, files[]
//   stop    head, files[] ({ path, change: 'A'|'M'|'D' }) — UserPromptSubmit 기준점 대비 Git 변경
//   report  status, title, summary, categories[], files[], pendingForUser[], qna[{q,a}], continues,
//           response(AI 최종 응답 본문, ai-timeline 블록 제외)
//
// 파일 경로는 모두 프로젝트 루트 기준 상대 경로, 구분자는 '/'.
//
// 수집기 인터페이스
//   수집기는 makeEvent()로 이벤트를 만들고 appendEvent()로만 기록한다.
//   기록 위치·파일명 규칙과 경로 마스킹은 이 모듈이 담당하므로 수집기는 AI 도구의 입력 해석만 한다.
//   ctx.root(프로젝트 루트)는 마스킹에만 쓰고 이벤트에는 기록하지 않는다.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { maskDeep } from './mask.js';

export const SCHEMA_VERSION = 1;
export const EVENT_TYPES = ['prompt', 'tool', 'stop', 'report'];
export const STATUSES = ['완료', '진행중', '보류'];
// 작업 분류 — 무엇을 건드린 작업인지 (여러 개 가능)
export const CATEGORIES = ['ui', 'api', 'db', 'data', 'infra', 'config', 'docs', 'test', 'qa', 'etc'];

const pad = (n, w = 2) => String(n).padStart(w, '0');

// 2026-10-22T21:15:03+09:00
export function isoNow(date = new Date()) {
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// 기기명·시각·랜덤 4자리로 두 기기에서 충돌하지 않게 한다.
export function newTaskId(device, date = new Date()) {
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${device}-${stamp}-${crypto.randomBytes(2).toString('hex')}`;
}

export function makeEvent(type, ctx, fields = {}) {
  if (!EVENT_TYPES.includes(type)) throw new Error(`unknown event type: ${type}`);
  return {
    v: SCHEMA_VERSION,
    type,
    taskId: ctx.taskId,
    project: ctx.project,
    agent: ctx.agent,
    device: ctx.device,
    sessionId: ctx.sessionId ?? null,
    at: isoNow(),
    // 요청·요약·Q&A 등 모든 텍스트에서 절대 경로를 상대 경로·~로, 키·토큰을 ***로 바꾼다.
    ...maskDeep(fields, { root: ctx.root }),
  };
}

// data/YYYY-MM-DD.<device>.jsonl — 날짜는 기록 기기의 현지 날짜
export function appendEvent(dataDir, event) {
  const day = event.at.slice(0, 10);
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, `${day}.${event.device}.jsonl`);
  fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
  return file;
}

// 절대·상대·역슬래시 경로를 프로젝트 루트 기준 '/' 경로로 바꾼다. 루트 밖이면 null.
export function toProjectPath(root, p) {
  if (!p || typeof p !== 'string') return null;
  const abs = path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}
