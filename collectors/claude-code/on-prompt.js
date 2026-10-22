// on-prompt.js — UserPromptSubmit hook
// 역할: 새 작업을 열고 요청 시간·내용과 Git 기준점을 기록 (프롬프트 1개 = 작업 1개)

import { matchProject } from '../../core/config.js';
import { appendEvent, isoNow, makeEvent, newTaskId } from '../../core/schema.js';
import { snapshot } from '../git/index.js';
import { eventContext, readState, runHook, writeState } from './common.js';

// 클라이언트가 프롬프트에 덧붙이는 시스템 안내·HTML 주석 표시는 사용자의 요청이 아니므로 뺀다.
const cleanPrompt = (p) =>
  String(p ?? '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>|<!--[\s\S]*?-->/g, '').trim();

runHook('on-prompt', (input, config) => {
  const sessionId = input.session_id || null;
  const prev = readState(sessionId);
  const snap = snapshot(input.cwd);
  const project = matchProject(config, input.cwd, snap && snap.top);

  if (!project) {
    // 미등록·제외 경로: 이전 작업에 이어 붙지 않도록 상태만 비운다.
    writeState(sessionId, { sessionId, skip: true });
    return;
  }

  const state = {
    sessionId,
    taskId: newTaskId(config.device),
    project: project.name,
    root: project.root,
    requestedAt: isoNow(),
    gitTop: snap ? snap.top : null,
    baseHead: snap ? snap.head : null,
    snapshot: snap ? snap.files : null,
    prevTaskId: prev && !prev.skip ? prev.taskId : null,
  };
  writeState(sessionId, state);
  appendEvent(
    config.dataDir,
    makeEvent('prompt', eventContext(state, config), {
      at: state.requestedAt,
      request: cleanPrompt(input.prompt),
      baseHead: state.baseHead,
    }),
  );

  // stdout은 Claude의 컨텍스트로 들어간다. 긴 대화에서도 보고를 빠뜨리지 않게 짧게 상기시킨다.
  const lines = [
    '[ai-timeline] 이 요청은 작업 타임라인에 기록됩니다. 작업을 마치는 응답 끝에 ```ai-timeline JSON 블록',
    '(status: 완료|진행중|보류, title, summary, categories, files, pendingForUser, qna, continues)을 붙이세요. 형식은 ai-timeline 스킬 참고.',
  ];
  if (state.prevTaskId) lines.push(`[ai-timeline] 직전 작업 id: ${state.prevTaskId} (이어지는 작업이면 continues에 사용)`);
  process.stdout.write(lines.join('\n') + '\n');
});
