// 그림판 도구 상태. DOM을 모르는 순수 계층이라 node에서 그대로 테스트한다.
// 실제 그리기(캔버스 조작)는 paint-app.js가 맡는다.

export const COLORS = ["#1b1b1b", "#e81123", "#f7c948", "#3fa9f5", "#3ec46d", "#8e44ad"];
export const SIZES = [2, 6, 14];
export const ERASER_COLOR = "#ffffff";

export function createPaintState() {
  return { color: COLORS[0], size: SIZES[1], tool: "pen" };
}

export function selectColor(state, color) {
  if (!COLORS.includes(color) || (state.color === color && state.tool === "pen")) {
    // 색을 고르면 지우개는 자동으로 풀린다 — 실제 그림판과 같은 동작.
    return COLORS.includes(color) ? { ...state, color, tool: "pen" } : state;
  }
  return { ...state, color, tool: "pen" };
}

export function selectSize(state, size) {
  const value = Number(size);
  if (!SIZES.includes(value) || state.size === value) return state;
  return { ...state, size: value };
}

export function toggleEraser(state) {
  return { ...state, tool: state.tool === "eraser" ? "pen" : "eraser" };
}

// 실제로 캔버스에 칠할 색과 굵기. 지우개는 흰색이고 조금 더 두껍다.
export function strokeStyleOf(state) {
  return state.tool === "eraser"
    ? { color: ERASER_COLOR, width: state.size * 2.5 }
    : { color: state.color, width: state.size };
}

// 포인터가 빠르게 움직이면 이벤트 사이가 벌어져 선이 끊긴다. 두 점 사이를
// 일정 간격으로 채워 이어 준다.
export function interpolate(from, to, spacing = 2) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  const points = [];
  for (let i = 1; i <= steps; i++) {
    points.push({
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    });
  }
  return points;
}
