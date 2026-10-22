// build.js — 빌드 스크립트
// 역할: JSONL 이벤트 → 작업 단위 레코드 → viewer/timeline-data.js
//
// 사용법
//   node build.js                       config.dataDir의 *.jsonl
//   node build.js examples/sample.jsonl 지정한 파일·폴더 (여러 개 가능)
//   node build.js --out path/to/timeline-data.js
//
// 입력 줄 형식
//   - 이벤트(type 있음): taskId로 묶어 합친다 (core/schema.js 참고)
//   - 작업 레코드(type 없음, id 있음): 그대로 쓴다 (examples/ 데모용)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './core/config.js';
import { maskDeep } from './core/mask.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const inputs = [];
  let out = path.join(ROOT, 'viewer', 'timeline-data.js');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = path.resolve(argv[++i]);
    else inputs.push(path.resolve(argv[i]));
  }
  return { inputs, out };
}

function jsonlFiles(inputs) {
  const files = [];
  for (const p of inputs) {
    if (!fs.existsSync(p)) {
      console.warn(`skip (not found): ${p}`);
      continue;
    }
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p).sort()) if (f.endsWith('.jsonl')) files.push(path.join(p, f));
    } else files.push(p);
  }
  return files;
}

function readLines(files) {
  const rows = [];
  for (const file of files) {
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      try {
        rows.push(JSON.parse(line));
      } catch {
        console.warn(`skip (bad json): ${path.basename(file)}:${i + 1}`);
      }
    });
  }
  return rows;
}

const byTime = (a, b) => String(a.at).localeCompare(String(b.at));
const uniq = (arr) => [...new Set(arr)];

function emptyTask(e) {
  return {
    id: e.taskId,
    project: e.project,
    agent: e.agent,
    device: e.device,
    sessionId: e.sessionId ?? null,
    requestedAt: null,
    completedAt: null,
    respondedAt: null,
    status: null,
    reported: false,
    request: '',
    title: '',
    summary: '',
    categories: [],
    response: '',
    files: { reportedByAI: [], detectedByGit: [], touchedByTool: [] },
    gitChanges: [],
    pendingForUser: [],
    qna: [],
    continues: null,
  };
}

// 같은 taskId의 이벤트를 시간순으로 합친다.
function mergeEvents(events) {
  const tasks = new Map();
  for (const e of events.sort(byTime)) {
    if (!e.taskId) continue;
    if (!tasks.has(e.taskId)) tasks.set(e.taskId, emptyTask(e));
    const t = tasks.get(e.taskId);
    switch (e.type) {
      case 'prompt':
        t.requestedAt = e.at;
        // 초기 기록에 섞인 클라이언트 시스템 안내 제거 (on-prompt에서도 제거함)
        t.request = (e.request || '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>|<!--[\s\S]*?-->/g, '').trim();
        break;
      case 'tool':
        t.files.touchedByTool = uniq([...t.files.touchedByTool, ...(e.files || [])]);
        break;
      case 'stop': // 마지막 stop이 최종 상태
        t.respondedAt = e.at;
        t.gitChanges = e.files || [];
        t.files.detectedByGit = t.gitChanges.map((f) => f.path);
        break;
      case 'report': // 마지막 보고가 최종 상태
        t.reported = true;
        t.status = e.status || null;
        t.title = e.title || '';
        t.summary = e.summary || '';
        t.categories = e.categories || [];
        t.response = e.response || '';
        t.files.reportedByAI = e.files || [];
        t.pendingForUser = e.pendingForUser || [];
        t.qna = e.qna || [];
        t.continues = e.continues || null;
        if (e.parseError) t.reportError = true;
        break;
    }
  }
  for (const t of tasks.values()) {
    if (!t.status) t.status = '진행중';
    t.completedAt = t.status === '진행중' ? null : t.respondedAt;
  }
  return [...tasks.values()];
}

function fromRecord(r) {
  const files = r.files || {};
  return {
    ...r,
    reported: r.reported ?? true,
    respondedAt: r.respondedAt ?? r.completedAt ?? null,
    files: {
      reportedByAI: files.reportedByAI || [],
      detectedByGit: files.detectedByGit || [],
      touchedByTool: files.touchedByTool || [],
    },
    pendingForUser: r.pendingForUser || [],
    qna: r.qna || [],
    continues: r.continues ?? null,
  };
}

// 분류를 보고하지 않은 작업(이전 기록·샘플)은 변경 파일 경로로 추정한다.
const CATEGORY_RULES = [
  ['test', /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/i],
  ['db', /\.sql$|(^|\/)(migrations?|mappers?)\/|mapper\.xml$|schema\.prisma$/i],
  ['infra', /(^|\/)(dockerfile|docker-compose[^/]*|\.github\/workflows\/.*|[^/]*\.tf)$/i],
  ['config', /(^|\/)(package(-lock)?\.json|\.gitignore|\.gitattributes|\.editorconfig|tsconfig[^/]*\.json|[^/]*\.config\.[cm]?[jt]s|\.env\.example|settings[^/]*\.json)$/i],
  ['docs', /\.(md|txt|rst)$|(^|\/)docs\//i],
  ['ui', /\.(html?|css|scss|less|jsx|tsx|vue|svelte|jsp)$|(^|\/)(views?|components?|pages|layouts|viewer)\//i],
  ['data', /\.(jsonl|csv|tsv|ya?ml|json)$|(^|\/)(data|examples)\//i],
  ['api', /(^|\/)(api|routes?|controllers?|services?|server|collectors?|core)\/|(controller|service|handler|router)\.[a-z]+$/i],
];

function inferCategories(t) {
  const files = [...new Set([...t.files.detectedByGit, ...t.files.reportedByAI])];
  if (!files.length) return ['qa'];
  const found = new Set();
  for (const f of files) {
    const hit = CATEGORY_RULES.find(([, re]) => re.test(f));
    found.add(hit ? hit[0] : 'etc');
  }
  return [...found];
}

// 제목을 보고하지 않은 작업은 요청 원문의 첫 줄(인용 '>' 줄 제외)을 줄여 쓴다.
function fallbackTitle(request) {
  const lines = String(request || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => !l.startsWith('>')) || lines[0] || '(요청 없음)';
  return line.length > 40 ? line.slice(0, 40) + '…' : line;
}

function finalize(t) {
  if (!t.title) t.title = fallbackTitle(t.request);
  t.categoriesInferred = !(t.categories && t.categories.length);
  if (t.categoriesInferred) t.categories = inferCategories(t);
  t.response = t.response || '';
  return t;
}

// 교차 검증: AI 보고와 Git 감지가 다르면 표시한다. Git 정보가 없으면(stop 없음 등) 비교하지 않는다.
function crossCheck(t) {
  const ai = new Set(t.files.reportedByAI);
  const gitSet = new Set(t.files.detectedByGit);
  const comparable = t.reported && t.respondedAt != null;
  t.mismatch = {
    onlyAI: comparable ? [...ai].filter((f) => !gitSet.has(f)) : [],
    onlyGit: comparable ? [...gitSet].filter((f) => !ai.has(f)) : [],
  };
  t.hasMismatch = t.mismatch.onlyAI.length + t.mismatch.onlyGit.length > 0;
  return t;
}

export function build(rows) {
  const events = rows.filter((r) => r.type);
  const records = rows.filter((r) => !r.type && r.id).map(fromRecord);
  const tasks = [...records, ...mergeEvents(events)].map(crossCheck).map(finalize);
  tasks.sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
  return tasks;
}

function main() {
  let { inputs, out } = parseArgs(process.argv.slice(2));
  if (!inputs.length) inputs = [loadConfig().dataDir];
  const files = jsonlFiles(inputs);
  // 기록 시점에 이미 마스킹하지만, 이전 데이터에 남은 홈 경로·키도 화면용 파일에는 넣지 않는다.
  const tasks = maskDeep(build(readLines(files)));
  const data = { generatedAt: new Date().toISOString(), tasks };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `window.TIMELINE_DATA = ${JSON.stringify(data, null, 2)};\n`, 'utf8');
  console.log(`${files.length} file(s), ${tasks.length} task(s) → ${path.relative(process.cwd(), out) || out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
