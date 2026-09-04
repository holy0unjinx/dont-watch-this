import test from "node:test";
import assert from "node:assert/strict";
import {
  createDesktop,
  focusWindow,
  openWindow,
  closeWindow,
  minimizeWindow,
  toggleMinimize,
  toggleMaximize,
  moveWindow,
  renameWindow,
  setRect,
  resizeDesktop,
  activeWindowId,
  taskbarItems,
  stackOrder,
  snapZoneFor,
  snapRect,
  TITLEBAR_HEIGHT,
  MIN_VISIBLE,
} from "../window-state.js";

const DESKTOP = { width: 1200, height: 700 };

function makeState() {
  return createDesktop({
    desktop: DESKTOP,
    windows: [
      { id: "explorer", title: "문서 탐색기", rect: { x: 40, y: 40, width: 400, height: 300 } },
      { id: "notepad", title: "메모장", rect: { x: 200, y: 120, width: 320, height: 200 } },
      { id: "paint", title: "그림판", rect: { x: 500, y: 80, width: 380, height: 260 } },
    ],
  });
}

test("처음엔 모든 창이 열려 있고 마지막 창이 활성", () => {
  const state = makeState();
  assert.deepEqual(stackOrder(state), ["explorer", "notepad", "paint"]);
  assert.equal(activeWindowId(state), "paint");
  assert.equal(taskbarItems(state).length, 3);
});

test("포커스하면 스택 맨 위로 올라온다", () => {
  const state = focusWindow(makeState(), "explorer");
  assert.deepEqual(stackOrder(state), ["notepad", "paint", "explorer"]);
  assert.equal(activeWindowId(state), "explorer");
  // z-index는 스택 순서를 따라간다
  const items = taskbarItems(state);
  assert.equal(items.find((item) => item.id === "explorer").active, true);
  assert.equal(items.find((item) => item.id === "paint").active, false);
});

test("원래 상태를 건드리지 않는다 (순수 함수)", () => {
  const before = makeState();
  const snapshot = JSON.stringify(before);
  focusWindow(before, "explorer");
  minimizeWindow(before, "paint");
  moveWindow(before, "notepad", { x: 10, y: 10 });
  assert.equal(JSON.stringify(before), snapshot);
});

test("최소화하면 활성이 그 아래 창으로 넘어간다", () => {
  const state = minimizeWindow(makeState(), "paint");
  assert.equal(state.windows.paint.minimized, true);
  assert.equal(activeWindowId(state), "notepad", "가려져 있던 창이 올라와야 한다");
  // 작업표시줄에는 남는다
  assert.equal(taskbarItems(state).length, 3);
  assert.equal(taskbarItems(state).find((item) => item.id === "paint").minimized, true);
});

test("작업표시줄 버튼: 활성 창은 최소화, 최소화된 창은 복원+포커스", () => {
  let state = makeState();
  state = toggleMinimize(state, "paint"); // 활성이므로 최소화
  assert.equal(state.windows.paint.minimized, true);
  state = toggleMinimize(state, "paint"); // 다시 누르면 복원
  assert.equal(state.windows.paint.minimized, false);
  assert.equal(activeWindowId(state), "paint");
});

test("가려진 창을 작업표시줄에서 누르면 최소화가 아니라 앞으로 온다", () => {
  let state = makeState();
  state = toggleMinimize(state, "explorer"); // 활성이 아니었다
  assert.equal(state.windows.explorer.minimized, false, "최소화되면 안 된다");
  assert.equal(activeWindowId(state), "explorer");
});

test("최대화는 데스크톱을 가득 채우고 복원하면 원래 사각형으로 돌아온다", () => {
  const start = makeState();
  const original = { ...start.windows.notepad.rect };
  let state = toggleMaximize(start, "notepad");
  assert.equal(state.windows.notepad.maximized, true);
  assert.deepEqual(state.windows.notepad.rect, { x: 0, y: 0, ...DESKTOP });
  assert.equal(activeWindowId(state), "notepad", "최대화하면 앞으로 온다");

  state = toggleMaximize(state, "notepad");
  assert.equal(state.windows.notepad.maximized, false);
  assert.deepEqual(state.windows.notepad.rect, original);
});

test("최대화 상태에서 옮기면 복원되며 커서를 따라간다", () => {
  let state = toggleMaximize(makeState(), "notepad");
  state = moveWindow(state, "notepad", { x: 300, y: 200 });
  assert.equal(state.windows.notepad.maximized, false, "드래그하면 최대화가 풀려야 한다");
  assert.equal(state.windows.notepad.rect.width, 320, "복원 크기로 돌아온다");
});

test("창을 닫으면 작업표시줄에서 사라지고, 다시 열면 있던 자리에 뜬다", () => {
  const start = makeState();
  const rect = { ...start.windows.paint.rect };
  let state = closeWindow(start, "paint");
  assert.equal(state.windows.paint.open, false);
  assert.equal(taskbarItems(state).length, 2);
  assert.equal(activeWindowId(state), "notepad");

  state = openWindow(state, "paint");
  assert.equal(state.windows.paint.open, true);
  assert.deepEqual(state.windows.paint.rect, rect);
  assert.equal(activeWindowId(state), "paint");
});

test("최소화된 창을 다시 열면 복원된다", () => {
  let state = minimizeWindow(makeState(), "paint");
  state = openWindow(state, "paint");
  assert.equal(state.windows.paint.minimized, false);
  assert.equal(activeWindowId(state), "paint");
});

test("드래그는 타이틀바가 화면에 남는 범위로 제한된다", () => {
  let state = makeState();

  state = moveWindow(state, "explorer", { x: -9999, y: -9999 });
  assert.equal(state.windows.explorer.rect.y, 0, "위로는 못 나간다");
  assert.ok(
    state.windows.explorer.rect.x + state.windows.explorer.rect.width >= MIN_VISIBLE,
    "왼쪽으로 완전히 사라지면 안 된다"
  );

  state = moveWindow(state, "explorer", { x: 9999, y: 9999 });
  assert.ok(state.windows.explorer.rect.x <= DESKTOP.width - MIN_VISIBLE);
  assert.ok(
    state.windows.explorer.rect.y <= DESKTOP.height - TITLEBAR_HEIGHT,
    "타이틀바가 작업표시줄 아래로 숨으면 다시 못 잡는다"
  );
});

test("데스크톱이 작아지면 창들이 화면 안으로 끌려 들어온다", () => {
  let state = moveWindow(makeState(), "paint", { x: 780, y: 400 });
  state = resizeDesktop(state, { width: 600, height: 400 });
  const rect = state.windows.paint.rect;
  assert.ok(rect.x <= 600 - MIN_VISIBLE, `x=${rect.x}`);
  assert.ok(rect.y <= 400 - TITLEBAR_HEIGHT, `y=${rect.y}`);
  assert.ok(rect.width <= 600, "창이 데스크톱보다 넓으면 줄인다");
});

test("최대화된 창은 데스크톱 크기가 바뀌면 따라 커진다", () => {
  let state = toggleMaximize(makeState(), "notepad");
  state = resizeDesktop(state, { width: 800, height: 500 });
  assert.deepEqual(state.windows.notepad.rect, { x: 0, y: 0, width: 800, height: 500 });
});

test("스냅 판정: 좌우 가장자리와 위쪽", () => {
  assert.equal(snapZoneFor({ x: 4, y: 300 }, DESKTOP), "left");
  assert.equal(snapZoneFor({ x: 1196, y: 300 }, DESKTOP), "right");
  assert.equal(snapZoneFor({ x: 600, y: 2 }, DESKTOP), "top");
  assert.equal(snapZoneFor({ x: 600, y: 300 }, DESKTOP), null);
  // 모서리는 위쪽(최대화)이 이긴다 — 실제 Windows와 같은 우선순위
  assert.equal(snapZoneFor({ x: 2, y: 2 }, DESKTOP), "top");
});

test("스냅 사각형: 좌우는 반쪽, 위는 전체", () => {
  assert.deepEqual(snapRect("left", DESKTOP), { x: 0, y: 0, width: 600, height: 700 });
  assert.deepEqual(snapRect("right", DESKTOP), { x: 600, y: 0, width: 600, height: 700 });
  assert.deepEqual(snapRect("top", DESKTOP), { x: 0, y: 0, width: 1200, height: 700 });
  assert.equal(snapRect(null, DESKTOP), null);
});

test("없는 창을 건드려도 상태가 그대로다", () => {
  const state = makeState();
  assert.equal(focusWindow(state, "없음"), state);
  assert.equal(closeWindow(state, "없음"), state);
  assert.equal(moveWindow(state, "없음", { x: 0, y: 0 }), state);
});

test("창 제목을 바꾸면 작업표시줄에도 반영된다", () => {
  let state = renameWindow(makeState(), "notepad", "01.txt - 메모장");
  assert.equal(state.windows.notepad.title, "01.txt - 메모장");
  assert.equal(
    taskbarItems(state).find((item) => item.id === "notepad").title,
    "01.txt - 메모장"
  );
  // 같은 제목으로 다시 부르면 상태가 그대로다(재렌더 방지).
  assert.equal(renameWindow(state, "notepad", "01.txt - 메모장"), state);
  assert.equal(renameWindow(state, "없음", "x"), state);
});

test("setRect은 최대화를 풀고 데스크톱 안으로 맞춘다", () => {
  let state = toggleMaximize(makeState(), "paint");
  state = setRect(state, "paint", { x: 0, y: 0, width: 600, height: 700 });
  assert.equal(state.windows.paint.maximized, false);
  assert.deepEqual(state.windows.paint.rect, { x: 0, y: 0, width: 600, height: 700 });

  // 데스크톱보다 큰 사각형은 잘려 들어온다.
  state = setRect(state, "paint", { x: -50, y: -50, width: 9999, height: 9999 });
  assert.ok(state.windows.paint.rect.width <= DESKTOP.width);
  assert.ok(state.windows.paint.rect.y >= 0);
});

test("스냅 사각형을 그대로 setRect에 넣으면 반쪽 창이 된다", () => {
  const left = snapRect("left", DESKTOP);
  const state = setRect(makeState(), "explorer", left);
  assert.deepEqual(state.windows.explorer.rect, left);
});
