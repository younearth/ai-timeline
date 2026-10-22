// mask.js — 마스킹 필터
// 역할: 키·토큰 패턴 마스킹, 민감 파일 제외, 상대 경로 변환
// - 경로: 사용자명이 드러나는 경로를 없앤다
//   프로젝트 루트 아래 경로 → 루트 기준 상대 경로 ('/' 구분자), 루트 자체 → '.'
//   그 밖의 홈 디렉터리 경로 → '~' (/Users/<이름>, /home/<이름>, C:\Users\<이름>)
// - 키·토큰: 알려진 형식과 `password=...` 같은 할당문의 값을 '***'로 바꾼다
//   `task-0001` 같은 문자열에 오탐하지 않도록 앞쪽 단어 경계와 최소 길이를 둔다.
// 2단계: 민감 파일(.env 등) 제외

import os from 'node:os';
import path from 'node:path';

const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 경로 구분자는 '/'와 '\' 둘 다 허용 (Windows 경로가 어느 쪽으로 쓰여도 잡히게)
const pathRe = (p) => p.split(/[\\/]+/).filter(Boolean).map(escapeRe).join('[\\\\/]+');
// 경로가 끝나는 지점: 공백·따옴표·괄호·구두점 앞
const TAIL = '[^\\s"\'`<>()\\[\\]{},;]*';

// Windows 형식을 먼저 처리해야 'C:/Users/..'가 'C:~'로 남지 않는다.
const HOME_RES = [
  /\b[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`<>()\[\]{},;]+/gi,
  /(?:\/Users|\/home)\/[^/\s"'`<>()\[\]{},;]+/g,
];

function rootForms(root) {
  const forms = [root];
  const home = os.homedir();
  const rel = path.relative(home, root);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) forms.push('~/' + rel);
  return forms;
}

export function maskPaths(text, { root } = {}) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  if (root) {
    const flags = caseInsensitive ? 'gi' : 'g';
    for (const form of rootForms(/^[A-Za-z]:/.test(root) ? root : path.resolve(root))) {
      const lead = /^[A-Za-z]:/.test(form) || form.startsWith('~') ? '' : '[\\\\/]+';
      const body = lead + pathRe(form);
      out = out.replace(new RegExp(`${body}[\\\\/]+(${TAIL})`, flags), (_, rest) => rest.replace(/\\/g, '/') || '.');
      out = out.replace(new RegExp(`${body}(?![\\w.-])`, flags), '.');
    }
  }
  for (const re of HOME_RES) out = out.replace(re, '~');
  return out;
}

const B = '(?<![A-Za-z0-9_-])'; // 앞쪽 경계
export const SECRET_PATTERNS = [
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { name: 'openai/anthropic', re: new RegExp(`${B}sk-[A-Za-z0-9_-]{20,}`, 'g') },
  { name: 'github', re: new RegExp(`${B}(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})`, 'g') },
  { name: 'aws-access-key', re: new RegExp(`${B}(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Z])`, 'g') },
  { name: 'google-api-key', re: new RegExp(`${B}AIza[0-9A-Za-z_-]{35}`, 'g') },
  { name: 'slack', re: new RegExp(`${B}xox[abposr]-[A-Za-z0-9-]{10,}`, 'g') },
  { name: 'jwt', re: new RegExp(`${B}eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}`, 'g') },
  { name: 'bearer', re: /(\bBearer\s+)[A-Za-z0-9._~+/-]{20,}=*/gi, keep: 1 },
  { name: 'url-credential', re: /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)(?!\*\*\*@)[^\s@/]+(@)/gi, keep: 2 },
  {
    // password=..., "apiKey": "...", TOKEN: ... — 이름은 남기고 값만 가린다
    name: 'assignment',
    re: /(\b[\w-]*(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|access[_-]?key|private[_-]?key|client[_-]?secret)[\w-]*["']?\s*[:=]\s*["']?)(?!\*\*\*)[^\s"',;]{8,}/gi,
    keep: 1,
  },
];

export function maskSecrets(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const { re, keep } of SECRET_PATTERNS) {
    out = out.replace(re, (m, ...g) => (keep === 1 ? `${g[0]}***` : keep === 2 ? `${g[0]}***${g[1]}` : '***'));
  }
  return out;
}

// 값은 출력하지 않고 어떤 패턴이 걸렸는지만 돌려준다 (점검용)
export function findSecrets(text) {
  const hits = [];
  for (const { name, re } of SECRET_PATTERNS) {
    re.lastIndex = 0; // 가려진 값('***')은 최소 길이에 못 미쳐 다시 걸리지 않는다
    if (re.test(text)) hits.push(name);
  }
  return hits;
}

export const maskText = (text, opts) => maskSecrets(maskPaths(text, opts));

export function maskDeep(value, opts) {
  if (typeof value === 'string') return maskText(value, opts);
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, opts));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v, opts)]));
  }
  return value;
}
