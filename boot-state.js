// 부팅 연출의 진행 상태. DOM도 타이머도 모르는 순수 계층이라 node에서
// 테스트한다. 실제 타이머와 화면은 boot-sequence.js가 맡는다.

// 각 단계와 머무는 시간(ms). done은 연출이 끝난 상태라 시간이 없다.
export const STAGES = [
  { name: "boot", duration: 2400 },
  { name: "logon", duration: 1500 },
  { name: "welcome", duration: 1100 },
  { name: "done", duration: 0 },
];

export const STORAGE_KEY = "windows-boot-played";

export function createBoot() {
  return { index: 0, stage: STAGES[0].name, skipped: false };
}

export function currentStage(state) {
  return STAGES[state.index];
}

export function advance(state) {
  if (state.index >= STAGES.length - 1) return state;
  const index = state.index + 1;
  return { ...state, index, stage: STAGES[index].name };
}

// 클릭·Esc·스크롤로 건너뛰기. 이미 끝났으면 그대로.
export function skip(state) {
  if (state.stage === "done") return state;
  return { index: STAGES.length - 1, stage: "done", skipped: true };
}

export function isDone(state) {
  return state.stage === "done";
}

// 연출을 틀지 말아야 할 이유들. 하나라도 걸리면 데스크톱을 바로 보여준다.
export function shouldPlay({ reducedMotion = false, alreadyPlayed = false, wideScreen = true } = {}) {
  return !reducedMotion && !alreadyPlayed && wideScreen;
}
