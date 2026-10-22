// on-tool.js — PostToolUse hook
// 역할: 파일 편집 도구가 건드린 파일 수집
// 2단계: PreToolUse에서 SELECT 외 DB 쿼리 차단

import { appendEvent, makeEvent, toProjectPath } from '../../core/schema.js';
import { eventContext, readState, runHook } from './common.js';

runHook('on-tool', (input, config) => {
  const state = readState(input.session_id);
  if (!state || state.skip) return;

  const ti = input.tool_input || {};
  const file = toProjectPath(state.root, ti.file_path || ti.notebook_path);
  if (!file) return;

  appendEvent(
    config.dataDir,
    makeEvent('tool', eventContext(state, config), { tool: input.tool_name || null, files: [file] }),
  );
});
