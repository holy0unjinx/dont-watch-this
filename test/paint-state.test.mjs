import test from "node:test";
import assert from "node:assert/strict";
import {
  COLORS,
  SIZES,
  ERASER_COLOR,
  createPaintState,
  selectColor,
  selectSize,
  toggleEraser,
  strokeStyleOf,
  interpolate,
} from "../paint-state.js";

test("기본 상태는 검정 펜, 중간 굵기", () => {
  const state = createPaintState();
  assert.equal(state.color, COLORS[0]);
  assert.equal(state.size, SIZES[1]);
  assert.equal(state.tool, "pen");
});

test("팔레트에 없는 색은 무시한다", () => {
  const state = createPaintState();
  assert.equal(selectColor(state, "#123456"), state);
});

test("색을 고르면 지우개가 풀린다", () => {
  let state = toggleEraser(createPaintState());
  assert.equal(state.tool, "eraser");
  state = selectColor(state, COLORS[2]);
  assert.equal(state.tool, "pen");
  assert.equal(state.color, COLORS[2]);
});

test("굵기는 정해진 값만 받는다", () => {
  const state = createPaintState();
  assert.equal(selectSize(state, 999), state);
  assert.equal(selectSize(state, SIZES[2]).size, SIZES[2]);
});

test("지우개는 흰색이고 더 두껍다", () => {
  const pen = createPaintState();
  const eraser = toggleEraser(pen);
  assert.deepEqual(strokeStyleOf(pen), { color: pen.color, width: pen.size });
  const style = strokeStyleOf(eraser);
  assert.equal(style.color, ERASER_COLOR);
  assert.ok(style.width > pen.size);
});

test("지우개 토글은 원래 색을 기억한다", () => {
  const state = selectColor(createPaintState(), COLORS[3]);
  const back = toggleEraser(toggleEraser(state));
  assert.equal(back.tool, "pen");
  assert.equal(back.color, COLORS[3]);
});

test("보간은 두 점 사이를 촘촘히 메우고 끝점을 포함한다", () => {
  const points = interpolate({ x: 0, y: 0 }, { x: 10, y: 0 }, 2);
  assert.ok(points.length >= 5, `점 ${points.length}개`);
  assert.deepEqual(points[points.length - 1], { x: 10, y: 0 });
  for (let i = 1; i < points.length; i++) {
    const step = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    assert.ok(step <= 2 + 1e-9, `간격 ${step}`);
  }
});

test("같은 자리를 찍어도 점 하나는 나온다", () => {
  const points = interpolate({ x: 4, y: 4 }, { x: 4, y: 4 });
  assert.deepEqual(points, [{ x: 4, y: 4 }]);
});
