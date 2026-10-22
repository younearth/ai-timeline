// install.js — Claude Code에 hook·스킬 설치
// 역할: ~/.claude/settings.json에 hook 등록(기존 설정 유지), skill/SKILL.md를 ~/.claude/skills/ai-timeline/에 복사,
//       데이터 저장소에 키·토큰·홈 경로 점검 pre-commit hook 설치
//
// 사용법: node scripts/install.js [--dry-run]
// 다시 실행하면 이전에 등록한 ai-timeline hook을 지우고 현재 경로로 다시 등록한다.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../core/config.js';
import { gitTop } from '../collectors/git/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const SKILL_DIR = path.join(CLAUDE_DIR, 'skills', 'ai-timeline');
const dryRun = process.argv.includes('--dry-run');

const HOOKS = [
  { event: 'UserPromptSubmit', script: 'on-prompt.js', timeout: 10 },
  { event: 'PostToolUse', script: 'on-tool.js', timeout: 10, matcher: 'Edit|Write|MultiEdit|NotebookEdit' },
  { event: 'Stop', script: 'on-stop.js', timeout: 15 },
];

const collectorDir = path.join(ROOT, 'collectors', 'claude-code');
// 네이티브 설치 Claude Code는 Node를 제공하지 않으므로 node 절대 경로를 쓴다.
// 버전이 들어간 실제 경로(Homebrew Cellar 등)는 업그레이드 때 깨지므로, 같은 node를 가리키는 PATH상의 경로를 우선한다.
function nodePath() {
  const real = fs.realpathSync(process.execPath);
  const exe = process.platform === 'win32' ? 'node.exe' : 'node';
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(dir, exe);
    try {
      if (fs.realpathSync(candidate) === real) return candidate;
    } catch {}
  }
  return process.execPath;
}
const NODE = nodePath();
const command = (script) => `"${NODE}" "${path.join(collectorDir, script)}"`;
const isOurs = (h) => typeof h.command === 'string' && h.command.includes(path.join('collectors', 'claude-code', 'on-'));

const settings = fs.existsSync(SETTINGS) ? JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) : {};
settings.hooks = settings.hooks || {};

for (const { event, script, timeout, matcher } of HOOKS) {
  const groups = (settings.hooks[event] || [])
    .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurs(h)) }))
    .filter((g) => g.hooks.length);
  const group = { hooks: [{ type: 'command', command: command(script), timeout }] };
  if (matcher) group.matcher = matcher;
  settings.hooks[event] = [...groups, group];
}

const json = JSON.stringify(settings, null, 2) + '\n';

// 데이터 저장소 pre-commit: 마스킹을 빠져나간 값이 커밋·업로드되지 않게 한 번 더 막는다.
// Windows의 Git도 sh로 hook을 실행하므로 경로 구분자는 '/'로 쓴다.
const PRECOMMIT_MARK = '# ai-timeline: check-secrets';
function precommitTarget() {
  let dataDir;
  try { dataDir = loadConfig().dataDir; } catch { return null; }
  const top = fs.existsSync(dataDir) ? gitTop(dataDir) : null;
  return top ? path.join(top, '.git', 'hooks', 'pre-commit') : null;
}
const precommit = precommitTarget();
const precommitBody = [
  '#!/bin/sh',
  PRECOMMIT_MARK,
  `exec "${NODE.replace(/\\/g, '/')}" "${path.join(ROOT, 'scripts', 'check-secrets.js').replace(/\\/g, '/')}" --staged`,
  '',
].join('\n');
const precommitFree = precommit && (!fs.existsSync(precommit) || fs.readFileSync(precommit, 'utf8').includes(PRECOMMIT_MARK));
if (dryRun) {
  console.log(`[dry-run] ${SETTINGS}\n${json}`);
  console.log(`[dry-run] copy skill/SKILL.md → ${path.join(SKILL_DIR, 'SKILL.md')}`);
  console.log(precommitFree ? `[dry-run] ${precommit}\n${precommitBody}` : `[dry-run] pre-commit 건너뜀 (${precommit || '데이터 저장소 없음'})`);
} else {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, SETTINGS + '.bak');
  fs.writeFileSync(SETTINGS, json, 'utf8');
  fs.mkdirSync(SKILL_DIR, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'skill', 'SKILL.md'), path.join(SKILL_DIR, 'SKILL.md'));
  console.log(`hooks → ${SETTINGS} (backup: settings.json.bak)\nskill → ${SKILL_DIR}`);
  if (precommitFree) {
    fs.writeFileSync(precommit, precommitBody, { encoding: 'utf8', mode: 0o755 });
    fs.chmodSync(precommit, 0o755);
    console.log(`pre-commit → ${precommit}`);
  } else {
    console.warn(`pre-commit 건너뜀: ${precommit ? '다른 pre-commit hook이 이미 있음' : '데이터 저장소(git)를 찾지 못함'}`);
  }
}
