// 그림판. 두 가지 모드가 있다.
//   ink  — 평범한 그림판. 획이 그대로 남는다.
//   flow — 그린 픽셀이 입자가 되어, 위키백과 사진(a.jpg)의 제 자리로
//          흘러가 모인다(Spu7Nix의 픽셀 재배치 영상에서 가져온 아이디어).
//
// 어느 픽셀이 어느 자리로 갈지는 pixel-transport.js가, 어떻게 흘러갈지는
// particle-flow.js가 정한다. 둘 다 DOM을 모르는 순수 계층이고 여기서는
// 입력·렌더·수명만 관리한다.
//
// 좌표는 캔버스 "폭"으로 나눈 정규화 단위를 쓴다. 가로세로를 각각 다른
// 값으로 나누면 거리가 찌그러져서 밀어내기와 속도 제한이 이상해진다.
import {
  createPaintState,
  selectColor,
  selectSize,
  toggleEraser,
  strokeStyleOf,
  interpolate,
  ERASER_COLOR,
} from "./paint-state.js";
import {
  buildTargetSlots,
  assignByLuminance,
  improveAssignment,
  luminance,
} from "./pixel-transport.js";
import { createParticle, stepParticles, applySeparation, settledRatio } from "./particle-flow.js";

const TARGET_IMAGE = "images.jpeg";
// 목표 사진의 흰 배경은 자리에서 뺀다 — 안 그러면 픽셀이 네모난 덩어리로
// 퍼져서 그림이 아니라 사각형이 된다.
const TARGET_MAX_LUMINANCE = 0.9;
// 목표 자리 수. 화면에 필요한 것보다 넉넉해야 획이 늘어도 사진이 촘촘해진다.
const MAX_SLOTS = 9000;
const MAX_PARTICLES = 9000;
// 매 프레임 돌리는 교환 개선 횟수. 비용이 절대 늘지 않으므로 계속 좋아진다.
// 색까지 맞추려면 바꿔볼 쌍이 더 많이 필요해서 넉넉히 잡는다.
const IMPROVE_PER_FRAME = 2200;
// 자리를 고를 때 "색이 어울리는가"에 두는 무게. 0이면 이동 거리만 본다.
// 크게 잡을수록 멀더라도 제 색 자리를 찾아간다.
const COLOR_WEIGHT = 6;
// 획을 그은 뒤 배정을 다시 계산하기까지의 여유(ms).
const REASSIGN_DELAY = 180;
// 0이면 그린 색을 그대로 둔다 — 자리만 옮겨서 형태로만 사진을 만든다.
const COLOR_BLEND = 0;
// 모여드는 속도. 낮출수록 천천히 흐른다.
const FLOW = { stiffness: 3.4, damping: 0.9, maxSpeed: 0.85, swirl: 1.1, colorBlend: COLOR_BLEND };

const card = document.querySelector('.window-card[data-window="paint"]');
const canvas = card && card.querySelector(".paint-canvas");

if (canvas) {
  const context = canvas.getContext("2d");
  let state = createPaintState();
  let drawing = false;
  let lastPoint = null;
  let flowMode = true;

  const swatches = [...card.querySelectorAll(".swatch[data-color]")];
  const sizes = [...card.querySelectorAll(".paint-size[data-size]")];
  const eraserButton = card.querySelector(".paint-eraser");
  const flowButton = card.querySelector(".paint-flow-toggle");
  const statusEl = card.querySelector(".paint-status");

  // ink 모드용 영구 레이어. flow 모드에서는 입자만 그리므로 쓰지 않는다.
  const ink = document.createElement("canvas");
  const inkContext = ink.getContext("2d");

  let particles = [];
  let assignment = new Int32Array(0);
  let slots = [];
  let slotsReady = false;
  let dirty = false;
  let reassignTimer = 0;
  let raf = 0;
  let last = 0;
  let lastReassignAt = 0;

  const unit = () => canvas.clientWidth || 1;
  const toNorm = (px) => px / unit();
  const toPixels = (value) => value * unit();

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

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
    if (flowButton) {
      flowButton.setAttribute("aria-pressed", String(flowMode));
      flowButton.classList.toggle("is-active", flowMode);
    }
    canvas.classList.toggle("is-erasing", state.tool === "eraser");
  }

  function setState(next) {
    if (next === state) return;
    state = next;
    syncToolbar();
  }

  // ── 목표 사진 ────────────────────────────────────────────────────
  function loadTarget() {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => {
      // 원본 그대로 읽으면 픽셀이 너무 많다. 폭 220px 정도로 줄여서 뽑는다.
      const width = 220;
      const height = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * width));
      const buffer = document.createElement("canvas");
      buffer.width = width;
      buffer.height = height;
      const bufferContext = buffer.getContext("2d", { willReadFrequently: true });
      bufferContext.drawImage(image, 0, 0, width, height);

      const imageData = bufferContext.getImageData(0, 0, width, height);
      slots = buildTargetSlots(imageData, { maxSlots: MAX_SLOTS, maxLuminance: TARGET_MAX_LUMINANCE });
      slotsReady = slots.length > 0;
      targetAspect = width / height;
      scheduleReassign(0);
      setStatus(flowMode ? "그리면 픽셀이 사진으로 모입니다." : "");
    });
    image.addEventListener("error", () => {
      slotsReady = false;
      setStatus("사진을 불러오지 못했습니다 — 일반 그림판으로 동작합니다.");
      flowMode = false;
      syncToolbar();
    });
    image.src = TARGET_IMAGE;
  }

  let targetAspect = 1;

  // 사진을 캔버스 안에 비율 그대로 넣었을 때의 영역(정규화 단위).
  function targetFrame() {
    const width = unit();
    const height = canvas.clientHeight || 1;
    const scale = Math.min(width / targetAspect, height) * 0.92;
    const frameHeight = scale;
    const frameWidth = scale * targetAspect;
    return {
      x: toNorm((width - frameWidth) / 2),
      y: toNorm((height - frameHeight) / 2),
      width: toNorm(frameWidth),
      height: toNorm(frameHeight),
    };
  }

  // ── 배정 ────────────────────────────────────────────────────────
  function applyAssignment() {
    if (!slotsReady || particles.length === 0) return;
    const frame = targetFrame();
    for (let i = 0; i < particles.length; i++) {
      const slot = slots[assignment[i]];
      if (!slot) continue;
      const particle = particles[i];
      particle.tx = frame.x + slot.x * frame.width;
      particle.ty = frame.y + slot.y * frame.height;
      // 색은 건드리지 않는다. 그린 색 그대로 두고 자리만 옮겨서, 사진은
      // 형태(밝기 분포)로만 드러난다.
    }
  }

  function reassign() {
    if (!slotsReady || particles.length === 0) return;
    assignment = assignByLuminance(particles, slots);
    improveAssignment(particles, slots, assignment, {
      iterations: particles.length * 6,
      colorWeight: COLOR_WEIGHT,
    });
    applyAssignment();
    dirty = false;
  }

  function scheduleReassign(delay = REASSIGN_DELAY) {
    clearTimeout(reassignTimer);
    reassignTimer = setTimeout(() => {
      reassign();
      start();
    }, delay);
  }

  // ── 입력 ────────────────────────────────────────────────────────
  function pointFrom(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // 영구 레이어와 보이는 캔버스에 같이 찍는다. 점 하나마다 전체를 다시
  // 그리면 굵은 붓에서 눈에 띄게 느려진다.
  function inkDot(point, style) {
    for (const target of [inkContext, context]) {
      target.fillStyle = style.color;
      target.beginPath();
      target.arc(point.x, point.y, style.width / 2, 0, Math.PI * 2);
      target.fill();
    }
  }

  function parseColor(hex) {
    const value = hex.replace("#", "");
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
    };
  }

  function spawn(point, style) {
    const color = parseColor(style.color);
    // 붓이 굵을수록 한 점에서 여러 입자가 흩어져 나온다.
    const count = Math.max(1, Math.round(style.width / 3));
    for (let i = 0; i < count; i++) {
      const spread = (style.width / 2) * (Math.random() - 0.5);
      particles.push(
        createParticle({
          x: toNorm(point.x + spread),
          y: toNorm(point.y + (style.width / 2) * (Math.random() - 0.5)),
          r: color.r,
          g: color.g,
          b: color.b,
          lum: luminance(color.r, color.g, color.b),
          phase: Math.random() * Math.PI * 2,
        })
      );
    }
    // 오래된 입자부터 버려서 상한을 지킨다.
    if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
    dirty = true;
  }

  // flow 모드의 지우개는 근처 입자를 없앤다.
  function erase(point, style) {
    const radius = toNorm(style.width);
    const x = toNorm(point.x);
    const y = toNorm(point.y);
    particles = particles.filter(
      (particle) => Math.hypot(particle.x - x, particle.y - y) > radius
    );
    dirty = true;
  }

  function paintAt(point) {
    const style = strokeStyleOf(state);
    if (!flowMode) {
      inkDot(point, style);
      return;
    }
    if (state.tool === "eraser") erase(point, style);
    else spawn(point, style);
  }

  // ── 렌더 ────────────────────────────────────────────────────────
  function clearCanvas() {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = ERASER_COLOR;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
  }

  function renderInk() {
    clearCanvas();
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(ink, 0, 0);
    context.restore();
  }

  function renderParticles() {
    clearCanvas();
    const size = Math.max(1.2, unit() / 220);
    for (const particle of particles) {
      context.fillStyle = `rgb(${particle.r | 0}, ${particle.g | 0}, ${particle.b | 0})`;
      context.fillRect(toPixels(particle.x) - size / 2, toPixels(particle.y) - size / 2, size, size);
    }
  }

  function tick(now) {
    raf = requestAnimationFrame(tick);
    const dt = (now - last) / 1000;
    last = now;

    // 그리는 중에도 일정 간격으로 다시 배정한다. 타이머를 매 프레임 되감으면
    // 영영 안 걸리므로 시간 기준으로 판단한다.
    if (dirty && now - lastReassignAt > REASSIGN_DELAY) {
      reassign();
      lastReassignAt = now;
    }
    if (slotsReady && particles.length > 0) {
      // 매 프레임 조금씩 더 나은 배정으로 다듬는다.
      improveAssignment(particles, slots, assignment, {
        iterations: IMPROVE_PER_FRAME,
        colorWeight: COLOR_WEIGHT,
      });
      applyAssignment();
    }

    applySeparation(particles, { dt: Math.min(dt, 1 / 30) });
    stepParticles(particles, dt, FLOW);
    renderParticles();

    // 다 모였고 그리는 중도 아니면 루프를 멈춘다.
    if (!drawing && particles.length > 0 && settledRatio(particles) > 0.995) stop();
  }

  function start() {
    if (raf || !flowMode) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  // ── 크기 ────────────────────────────────────────────────────────
  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width === width && canvas.height === height) return;

    const backup = document.createElement("canvas");
    backup.width = ink.width;
    backup.height = ink.height;
    if (ink.width > 0 && ink.height > 0) backup.getContext("2d").drawImage(ink, 0, 0);

    canvas.width = width;
    canvas.height = height;
    ink.width = width;
    ink.height = height;

    inkContext.setTransform(1, 0, 0, 1, 0, 0);
    inkContext.fillStyle = ERASER_COLOR;
    inkContext.fillRect(0, 0, width, height);
    if (backup.width > 0) {
      inkContext.drawImage(backup, 0, 0, backup.width, backup.height, 0, 0, width, height);
    }
    inkContext.lineCap = "round";
    inkContext.lineJoin = "round";
    inkContext.setTransform(ratio, 0, 0, ratio, 0, 0);

    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    if (flowMode) {
      applyAssignment();
      renderParticles();
      start();
    } else {
      renderInk();
    }
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    drawing = true;
    lastPoint = pointFrom(event);
    paintAt(lastPoint);
    start();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const point = pointFrom(event);
    const style = strokeStyleOf(state);
    // 포인터 이벤트 사이가 벌어져도 획이 끊기지 않게 사이를 메운다.
    for (const step of interpolate(lastPoint, point, Math.max(1, style.width / 3))) paintAt(step);
    lastPoint = point;
  });

  const stopDrawing = () => {
    if (!drawing) return;
    drawing = false;
    lastPoint = null;
    if (flowMode && dirty) scheduleReassign(0);
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

  flowButton?.addEventListener("click", () => {
    flowMode = !flowMode;
    syncToolbar();
    if (flowMode) {
      setStatus(slotsReady ? "그리면 픽셀이 사진으로 모입니다." : "사진 준비 중…");
      scheduleReassign(0);
      start();
    } else {
      stop();
      setStatus("");
      renderInk();
    }
  });

  card.querySelector(".paint-clear")?.addEventListener("click", () => {
    particles = [];
    assignment = new Int32Array(0);
    inkContext.save();
    inkContext.setTransform(1, 0, 0, 1, 0, 0);
    inkContext.fillStyle = ERASER_COLOR;
    inkContext.fillRect(0, 0, ink.width, ink.height);
    inkContext.restore();
    stop();
    clearCanvas();
  });

  // 창 관리자가 창 크기를 바꾸면 알려준다(최대화/복원/열기).
  card.addEventListener("window:resize", resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize", resize);

  resize();
  syncToolbar();
  clearCanvas();
  setStatus("사진 준비 중…");
  loadTarget();
}
