// on-stop.js — Stop hook
// 역할: 응답 완료 시간, 기준점 대비 Git 변경 파일, AI 보고 블록 수집
// 2단계: 데이터 저장소 동기화
//
// Stop은 응답마다 실행된다. 같은 작업에 stop 이벤트가 여러 번 쌓이면 build.js가 마지막 것을 쓴다.

import fs from 'node:fs';
import path from 'node:path';
import { appendEvent, CATEGORIES, makeEvent, STATUSES, toProjectPath } from '../../core/schema.js';
import { changesSince } from '../git/index.js';
import { eventContext, readState, runHook, writeState } from './common.js';

const BLOCK_RE = /```ai-timeline[^\S\n]*\r?\n([\s\S]*?)```/g;

function lastBlock(text) {
  let m, last = null;
  while ((m = BLOCK_RE.exec(text || ''))) last = m[1];
  return last;
}

const isRealPrompt = (entry) => {
  const c = entry.message && entry.message.content;
  return typeof c === 'string' || (Array.isArray(c) && c.some((b) => b.type === 'text'));
};

// transcript에서 마지막 사용자 프롬프트 이후의 assistant 텍스트를 모은다.
function assistantTextFromTranscript(file) {
  if (!file) return '';
  let lines;
  try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { return ''; }
  const texts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try { entry = JSON.parse(lines[i]); } catch { continue; }
    if (entry.type === 'user' && !entry.isMeta && isRealPrompt(entry)) break;
    if (entry.type !== 'assistant' || !entry.message || !Array.isArray(entry.message.content)) continue;
    for (const b of entry.message.content) if (b.type === 'text') texts.unshift(b.text);
  }
  return texts.join('\n');
}

const MAX_RESPONSE = 6000;

// 반환: { raw: 블록 JSON 문자열, response: 블록을 뺀 응답 본문 } 또는 null
async function findReport(input) {
  const fromText = (text) => {
    const raw = lastBlock(text);
    if (!raw) return null;
    let response = text.replace(BLOCK_RE, '').trim();
    if (response.length > MAX_RESPONSE) response = response.slice(0, MAX_RESPONSE) + '\n…(생략)';
    return { raw, response };
  };
  const direct = fromText(input.last_assistant_message);
  if (direct) return direct;
  // transcript 기록이 Stop보다 늦을 수 있어 한 번 더 읽는다.
  for (let attempt = 0; attempt < 2; attempt++) {
    const found = fromText(assistantTextFromTranscript(input.transcript_path));
    if (found) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

const strings = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s.trim()) : []);

function normalizeReport(raw, root) {
  const r = JSON.parse(raw);
  return {
    status: STATUSES.includes(r.status) ? r.status : null,
    title: typeof r.title === 'string' ? r.title.trim() : '',
    summary: typeof r.summary === 'string' ? r.summary : '',
    categories: [...new Set(strings(r.categories).map((c) => c.trim().toLowerCase()))].filter((c) => CATEGORIES.includes(c)),
    files: [...new Set(strings(r.files).map((f) => toProjectPath(root, f)).filter(Boolean))],
    pendingForUser: strings(r.pendingForUser),
    qna: (Array.isArray(r.qna) ? r.qna : [])
      .filter((x) => x && typeof x.q === 'string' && x.q.trim())
      .map((x) => ({ q: x.q, a: typeof x.a === 'string' ? x.a : '' })),
    continues: typeof r.continues === 'string' && r.continues ? r.continues : null,
  };
}

runHook('on-stop', async (input, config) => {
  const state = readState(input.session_id);
  if (!state || state.skip) return;
  const ctx = eventContext(state, config);

  let head = null, files = [];
  if (state.gitTop) {
    const diff = changesSince({ top: state.gitTop, head: state.baseHead, files: state.snapshot || {} });
    head = diff.head;
    for (const f of diff.files) {
      const p = toProjectPath(state.root, path.join(state.gitTop, f.path));
      if (p) files.push({ path: p, change: f.change });
    }
  }
  appendEvent(config.dataDir, makeEvent('stop', ctx, { head, files }));

  const found = await findReport(input);
  if (!found || found.raw === state.lastReport) return;
  const { raw, response } = found;
  let report;
  try {
    report = normalizeReport(raw, state.root);
  } catch {
    report = { status: null, title: '', summary: '', categories: [], files: [], pendingForUser: [], qna: [], continues: null, parseError: true };
  }
  appendEvent(config.dataDir, makeEvent('report', ctx, { ...report, response }));
  writeState(input.session_id, { ...state, lastReport: raw });
});
