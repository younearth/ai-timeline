// config.js — 설정 로더
// 역할: ~/.ai-timeline/config.json 읽기, cwd → 프로젝트 매칭

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// AI_TIMELINE_HOME으로 바꿀 수 있다 (테스트용).
export const HOME_DIR = process.env.AI_TIMELINE_HOME || path.join(os.homedir(), '.ai-timeline');
export const CONFIG_PATH = path.join(HOME_DIR, 'config.json');

// Node는 '~'를 펼치지 않으므로 직접 처리한다.
export function expandPath(p) {
  if (typeof p !== 'string' || !p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

export function loadConfig(file = CONFIG_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw.device) throw new Error('config.device is required');
  if (!raw.dataDir) throw new Error('config.dataDir is required');
  return {
    device: raw.device,
    dataDir: expandPath(raw.dataDir),
    unregistered: raw.unregistered === 'auto' ? 'auto' : 'ignore',
    projects: (raw.projects || [])
      .filter((p) => p && p.name && p.path)
      .map((p) => ({ name: p.name, path: expandPath(p.path) })),
    exclude: (raw.exclude || []).map(expandPath),
  };
}

// Windows·macOS는 경로 대소문자를 구분하지 않는다.
const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
const norm = (p) => (caseInsensitive ? p.toLowerCase() : p);

export function isInside(parent, child) {
  const rel = path.relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// cwd가 속한 프로젝트를 찾는다. 반환: { name, root } 또는 null(기록 안 함)
// - exclude에 걸리면 항상 null
// - projects 중 가장 긴 경로 prefix
// - 미등록이면 unregistered: 'auto'일 때만 fallbackRoot(보통 git 최상위) 기준으로 자동 등록
export function matchProject(config, cwd, fallbackRoot) {
  if (!cwd) return null;
  const dir = path.resolve(cwd);
  if (config.exclude.some((ex) => isInside(ex, dir))) return null;

  let best = null;
  for (const p of config.projects) {
    if (isInside(p.path, dir) && (!best || p.path.length > best.path.length)) best = p;
  }
  if (best) return { name: best.name, root: best.path };

  if (config.unregistered === 'auto') {
    const root = fallbackRoot ? path.resolve(fallbackRoot) : dir;
    if (config.exclude.some((ex) => isInside(ex, root))) return null;
    return { name: path.basename(root), root };
  }
  return null;
}
