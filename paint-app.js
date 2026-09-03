// 그림판 창을 실제로 그려지는 캔버스로 만든다. 도구 상태는 paint-state.js
// (순수 계층)에 있고, 여기서는 포인터 입력과 캔버스 크기 관리를 맡는다.
import {
  createPaintState,
  selectColor,
  selectSize,
  toggleEraser,
  strokeStyleOf,
  interpolate,
  ERASER_COLOR,
} from "./paint-state.js";

const card = document.querySelector('.window-card[data-window="paint"]');
const canvas = card && card.querySelector(".paint-canvas");

if (canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: false });
  let state = createPaintState();
  let drawing = false;
  let lastPoint = null;

  const swatches = [...card.querySelectorAll(".swatch[data-color]")];
  const sizes = [...card.querySelectorAll(".paint-size[data-size]")];
  const eraserButton = card.querySelector(".paint-eraser");

  function syncToolbar() {
    for (const swatch of swatches) {
      const selected = state.tool === "pen" && swatch.dataset.color === state.color;
      swatch.setAttribute("aria-checked", String(selected));
      swatch.classList.toggle("is-selected", selected);
    }
    for (const button of sizes) {
      const selected = Number(button.dataset.size) === state.size;
      button.setAttribute("aria-checked", String(selected));
      button.classList.toggle("is-selected", selected);
    }
    if (eraserButton) {
      const active = state.tool === "eraser";
      eraserButton.setAttribute("aria-pressed", String(active));
      eraserButton.classList.toggle("is-active", active);
    }
    canvas.classList.toggle("is-erasing", state.tool === "eraser");
  }

  function setState(next) {
    if (next === state) return;
    state = next;
    syncToolbar();
  }

  // 캔버스 크기가 바뀌면 내용이 날아간다. 옮겨 담았다가 되돌린다.
  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width === width && canvas.height === height) return;

    const backup = document.createElement("canvas");
    backup.width = canvas.width;
    backup.height = canvas.height;
    if (canvas.width > 0 && canvas.height > 0) {
      backup.getContext("2d").drawImage(canvas, 0, 0);
    }

    canvas.width = width;
    canvas.height = height;
    context.fillStyle = ERASER_COLOR;
    context.fillRect(0, 0, width, height);
    if (backup.width > 0 && backup.height > 0) {
      context.drawImage(backup, 0, 0, backup.width, backup.height, 0, 0, width, height);
    }
    context.lineCap = "round";
    context.lineJoin = "round";
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function pointFrom(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function dot(point, style) {
    context.fillStyle = style.color;
    context.beginPath();
    context.arc(point.x, point.y, style.width / 2, 0, Math.PI * 2);
    context.fill();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawing = true;
    lastPoint = pointFrom(event);
    dot(lastPoint, strokeStyleOf(state));
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const point = pointFrom(event);
    const style = strokeStyleOf(state);
    // 포인터 이벤트 사이가 벌어져도 선이 끊기지 않게 사이를 메운다.
    for (const step of interpolate(lastPoint, point, Math.max(1, style.width / 3))) {
      dot(step, style);
    }
    lastPoint = point;
  });

  const stopDrawing = () => {
    drawing = false;
    lastPoint = null;
  };
  canvas.addEventListener("pointerup", stopDrawing);
  canvas.addEventListener("pointercancel", stopDrawing);
  canvas.addEventListener("pointerleave", stopDrawing);

  for (const swatch of swatches) {
    swatch.addEventListener("click", () => setState(selectColor(state, swatch.dataset.color)));
  }
  for (const button of sizes) {
    button.addEventListener("click", () => setState(selectSize(state, button.dataset.size)));
  }
  eraserButton?.addEventListener("click", () => setState(toggleEraser(state)));

  card.querySelector(".paint-clear")?.addEventListener("click", () => {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = ERASER_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
  });

  // 창 관리자가 창 크기를 바꾸면 알려준다(최대화/복원/열기).
  card.addEventListener("window:resize", resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize", resize);

  resize();
  syncToolbar();
}
