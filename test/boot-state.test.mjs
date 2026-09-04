import test from "node:test";
import assert from "node:assert/strict";
import {
  STAGES,
  createBoot,
  currentStage,
  advance,
  skip,
  isDone,
  shouldPlay,
} from "../boot-state.js";

test("단계는 boot → logon → welcome → done 순", () => {
  assert.deepEqual(
    STAGES.map((stage) => stage.name),
    ["boot", "logon", "welcome", "done"]
  );
  for (const stage of STAGES.slice(0, -1)) {
    assert.ok(stage.duration > 0, `${stage.name} 시간이 0`);
  }
});

test("advance는 순서대로 넘어가고 done에서 멈춘다", () => {
  let state = createBoot();
  assert.equal(state.stage, "boot");
  state = advance(state);
  assert.equal(state.stage, "logon");
  state = advance(state);
  assert.equal(state.stage, "welcome");
  state = advance(state);
  assert.equal(state.stage, "done");
  assert.ok(isDone(state));
  assert.equal(advance(state), state, "done에서 더 가면 같은 상태");
});

test("skip은 어디서든 바로 done으로 간다", () => {
  const skipped = skip(advance(createBoot()));
  assert.equal(skipped.stage, "done");
  assert.equal(skipped.skipped, true);
  assert.equal(skip(skipped), skipped, "이미 끝났으면 그대로");
});

test("currentStage는 지금 단계의 시간을 준다", () => {
  assert.equal(currentStage(createBoot()).duration, STAGES[0].duration);
});

test("연출을 트는 조건", () => {
  assert.equal(shouldPlay({}), true);
  assert.equal(shouldPlay({ reducedMotion: true }), false, "모션 최소화면 생략");
  assert.equal(shouldPlay({ alreadyPlayed: true }), false, "이번 세션에 이미 봤으면 생략");
  assert.equal(shouldPlay({ wideScreen: false }), false, "모바일에서는 생략");
});

test("원래 상태를 건드리지 않는다", () => {
  const state = createBoot();
  const snapshot = JSON.stringify(state);
  advance(state);
  skip(state);
  assert.equal(JSON.stringify(state), snapshot);
});
