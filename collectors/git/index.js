// index.js — Git 수집기
// 역할: AI 종류와 무관하게 Git 변경 파일 수집
// 1단계: Claude Code hook이 쓰는 기준점(snapshot)·변경 비교 함수
// 3단계: 단독 동작 수집기로 확장
//
// 기준점 = HEAD + "작업 시작 시점에 이미 변경돼 있던 파일"의 blob 해시.
// 비교할 때는 파일 내용 해시를 기준점과 맞춰 보므로, 작업 전부터 수정돼 있던 파일은
// 작업 중 내용이 실제로 바뀐 경우에만 변경으로 잡힌다. 작업 중 커밋해도 base HEAD 기준으로 비교한다.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CHUNK = 200;

function git(cwd, args, input) {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd,
    input,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  return r.status === 0 ? r.stdout : null;
}

export function gitTop(cwd) {
  const out = git(cwd, ['rev-parse', '--show-toplevel']);
  return out ? path.resolve(out.trim()) : null;
}

function head(top) {
  const out = git(top, ['rev-parse', '--verify', '-q', 'HEAD']);
  return out ? out.trim() : null;
}

// 변경·미추적 파일 경로 (git 최상위 기준)
function statusPaths(top) {
  const out = git(top, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (out == null) return [];
  const parts = out.split('\0');
  const paths = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    paths.push(e.slice(3));
    if (e[0] === 'R' || e[0] === 'C') paths.push(parts[++i]); // 원래 경로
  }
  return paths;
}

// 작업 트리 파일의 blob 해시. 없는 파일은 null.
function hashWorktree(top, paths) {
  const result = {};
  const existing = [];
  for (const p of paths) {
    let isFile = false;
    try { isFile = fs.statSync(path.join(top, p)).isFile(); } catch {}
    if (isFile && !p.includes('\n')) existing.push(p);
    else result[p] = null;
  }
  for (let i = 0; i < existing.length; i += CHUNK) {
    const chunk = existing.slice(i, i + CHUNK);
    const out = git(top, ['hash-object', '--stdin-paths'], chunk.join('\n') + '\n');
    const hashes = out ? out.trim().split('\n') : [];
    chunk.forEach((p, j) => { result[p] = hashes[j] || null; });
  }
  return result;
}

// 특정 커밋의 blob 해시. 없는 파일은 null.
function hashAt(top, rev, paths) {
  const result = Object.fromEntries(paths.map((p) => [p, null]));
  if (!rev) return result;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const out = git(top, ['ls-tree', '-r', '-z', rev, '--', ...paths.slice(i, i + CHUNK)]);
    if (!out) continue;
    for (const entry of out.split('\0')) {
      const tab = entry.indexOf('\t');
      if (tab < 0) continue;
      result[entry.slice(tab + 1)] = entry.slice(0, tab).split(' ')[2];
    }
  }
  return result;
}

export function snapshot(cwd) {
  const top = gitTop(cwd);
  if (!top) return null;
  return { top, head: head(top), files: hashWorktree(top, statusPaths(top)) };
}

// 기준점 이후 내용이 바뀐 파일. 반환: { head, files: [{ path, change }] } (경로는 git 최상위 기준)
export function changesSince(base) {
  const { top } = base;
  const now = head(top);
  const candidates = new Set([...statusPaths(top), ...Object.keys(base.files)]);
  if (base.head && now && now !== base.head) {
    const out = git(top, ['diff', '--name-only', '-z', base.head, now]);
    if (out) out.split('\0').filter(Boolean).forEach((p) => candidates.add(p));
  }
  const list = [...candidates];
  const unknown = list.filter((p) => !(p in base.files));
  const before = { ...hashAt(top, base.head, unknown), ...base.files };
  const after = hashWorktree(top, list);

  const files = [];
  for (const p of list.sort()) {
    const b = before[p] ?? null;
    const a = after[p] ?? null;
    if (b === a) continue;
    files.push({ path: p, change: b == null ? 'A' : a == null ? 'D' : 'M' });
  }
  return { head: now, files };
}
