// common.js — Claude Code hook 공통 처리
// 역할: stdin 입력 읽기, 작업 상태 파일, 오류 로그, "실패해도 작업을 막지 않는" 실행 래퍼
//
// 작업 상태(기준점 포함)는 기기 로컬 ~/.ai-timeline/state/<sessionId>.json에 두고
// 데이터 저장소에는 이벤트만 기록한다.

import fs from 'node:fs';
import path from 'node:path';
import { HOME_DIR, loadConfig } from '../../core/config.js';
import { isoNow } from '../../core/schema.js';

export const AGENT = 'claude-code';
const STATE_DIR = path.join(HOME_DIR, 'state');
const LOG_FILE = path.join(HOME_DIR, 'logs', 'hook-errors.log');

function readStdin() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

export function logError(where, err) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${isoNow()} [${where}] ${err && err.stack ? err.stack : err}\n`);
  } catch {}
}

// hook 본문은 어떤 예외가 나도 exit 0으로 끝나 Claude Code 작업을 막지 않는다.
export async function runHook(name, fn) {
  try {
    const input = readStdin();
    const config = loadConfig();
    await fn(input, config);
  } catch (err) {
    logError(name, err);
  }
  process.exit(0);
}

const stateFile = (sessionId) =>
  path.join(STATE_DIR, `${String(sessionId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

export function readState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(sessionId), 'utf8'));
  } catch {
    return null;
  }
}

export function writeState(sessionId, state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFile(sessionId), JSON.stringify(state), 'utf8');
}

export function eventContext(state, config) {
  return {
    taskId: state.taskId,
    project: state.project,
    agent: AGENT,
    device: config.device,
    sessionId: state.sessionId,
    root: state.root,
  };
}
