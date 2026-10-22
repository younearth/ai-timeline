## 2026-10-22 MacBook 환경 설정

| 단계 | 요청 시각 | 완료 시각 | 상태 | 요약 |
|---|---|---|---|---|
| 2. 사전 도구 확인 | 20:14 | 20:17 | 완료 | Node·gh 없음 → `brew install node gh` (node v26.12.1, gh 2.103) |
| 3. Git 전역 설정 | 20:17 | 20:36 | 완료 | defaultBranch·autocrlf·pull.rebase 추가, 커밋 이메일을 GitHub noreply로 변경 |
| 4. SSH 키 | 20:18 | 20:38 | 완료 | 기기 전용 ed25519 키 생성·`gh auth login`으로 등록, `ssh -T` 성공 |
| 5. 원격 저장소 생성 | 20:40 | 20:40 | 완료 | `ai-timeline` PUBLIC, `ai-timeline-data` PRIVATE 확인 |
| 6. 공개 저장소 골격 | 20:40 | 20:41 | 완료 | 스텁·설정 파일·샘플 3건(불일치 1건) 생성, `.gitignore` 검증 |
| 7. 데이터 저장소 | 20:41 | 20:41 | 완료 | `data/`, README, `.gitattributes` 구성 |
| 8. 기기 설정 파일 | 20:41 | 20:41 | 완료 | `~/.ai-timeline/config.json` 생성 (권한 600) |

### 사용자가 직접 처리한 항목
- `ssh-keygen` 실행 (passphrase 설정), `ssh-add --apple-use-keychain`
- `gh auth login` (SSH 프로토콜 선택, 공개키 업로드, 브라우저 기기 승인)
- GitHub 2단계 인증 확인

### Q&A
- Q: 다른 프로젝트도 기록하려면 경로를 어떻게 설정하나? / A: `config.json`의 `projects`에 `name`·`path`를 등록하고, hook이 받은 `cwd`를 가장 긴 경로 prefix로 매칭한다. `name`이 기기 간 공통 키, `path`는 기기별. 미등록 경로는 `unregistered`(`ignore`/`auto`), 회사 프로젝트는 `exclude`로 차단.
- Q: SSH 키 업로드 화면에 사용자 경로가 보이는데 괜찮나? / A: 경로는 로컬 표시일 뿐이고 업로드되는 건 공개키 내용과 코멘트뿐이다.
- Q: GitHub 커밋에 Claude가 공동작업자로 뜨지 않게 하려면? / A: Claude Code 설정 `attribution.commit/pr`을 빈 문자열로 둔다.

### 설정 중 발견한 설계 이슈 (1단계 전 결정 필요)
- 기획서의 "Claude Code가 Node 기반이라 추가 설치 없음"은 틀림 — 네이티브 설치 Claude Code는 시스템 Node를 제공하지 않으므로 hook용 Node를 따로 설치해야 한다.
- `dataDir`가 문서마다 달랐음 → `~/.ai-timeline-data/data`로 통일. Node는 `~`를 펼치지 않으므로 `config.js`에서 처리.
- JSONL "한 줄 = 이벤트"와 작업 단위 레코드 예시가 섞여 있음 → 이벤트 누적 후 `build.js`에서 합칠지 결정 필요.
- 순번 id(`task-0042`)는 두 기기에서 충돌 → 기기명·시각 포함 또는 UUID.
- Stop hook은 응답마다 실행되고, `git diff`만으론 작업 전 변경분이 섞임 → UserPromptSubmit 시점의 HEAD·status를 기준점으로 저장.
- `SessionStart` 동기화 hook 스크립트가 폴더 구조에 없음, `skill/SKILL.md`를 `~/.claude/skills/`에 설치하는 단계 필요.
- 6단계 검증의 `git check-ignore -v examples/sample.jsonl`은 부정 규칙(`!examples/*.jsonl`)을 출력하므로 "출력 없음" 기대가 틀림 → `-v` 없이 확인.
- 9단계 비밀값 점검 정규식 `sk-[A-Za-z0-9]`가 `task-0001`에 오탐 → 단어 경계·최소 길이 필요 (`(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}`). 2단계 `mask.js`도 같은 기준을 써야 함.
