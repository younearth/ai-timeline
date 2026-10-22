// check-secrets.js — 키·토큰·홈 경로 점검
// 역할: 업로드 전 마지막 확인. 걸린 위치와 패턴 이름만 출력하고 값은 출력하지 않는다.
//
// 사용법
//   node scripts/check-secrets.js --staged      현재 git 저장소의 staged 내용 (pre-commit hook용)
//   node scripts/check-secrets.js <파일|폴더>...  지정한 파일
// 걸리면 exit 1

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findSecrets, maskPaths } from '../core/mask.js';

function git(args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
  return r.stdout;
}

function stagedFiles() {
  return git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'])
    .split('\0')
    .filter(Boolean)
    .map((name) => ({ name, read: () => git(['show', `:${name}`]) }));
}

function listFiles(inputs) {
  const out = [];
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(p)) if (f !== '.git' && f !== 'node_modules') walk(path.join(p, f));
    } else out.push({ name: p, read: () => fs.readFileSync(p, 'utf8') });
  };
  inputs.forEach(walk);
  return out;
}

const args = process.argv.slice(2);
const files = args.includes('--staged') ? stagedFiles() : listFiles(args.length ? args : ['.']);
let hits = 0;
for (const f of files) {
  const text = f.read();
  if (text.includes('\0')) continue; // 바이너리
  text.split(/\r?\n/).forEach((line, i) => {
    const found = findSecrets(line);
    if (maskPaths(line) !== line) found.push('home-path');
    if (found.length) {
      hits++;
      console.error(`${f.name}:${i + 1} [${found.join(', ')}]`);
    }
  });
}
if (hits) {
  console.error(`\n키·토큰·홈 경로로 보이는 줄 ${hits}개. 값을 지우거나 가린 뒤 다시 커밋하세요.`);
  process.exit(1);
}
