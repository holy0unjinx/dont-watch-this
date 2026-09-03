// window-state.js(순수 상태)를 실제 DOM에 붙이는 어댑터. 창 드래그·버튼·
// 작업표시줄·시작 메뉴·시계를 담당한다. 다른 앱 모듈(지뢰찾기, 그림판 등)은
// 여기서 export한 desktop 컨트롤러로 창을 열고 상태 변화를 구독한다.
import {
  createDesktop,
  focusWindow,
  openWindow,
  closeWindow,
  minimizeWindow,
  toggleMinimize,
  toggleMaximize,
  moveWindow,
  resizeDesktop,
  activeWindowId,
  taskbarItems,
  zIndexOf,
  TITLEBAR_HEIGHT,
} from "./window-state.js";

const TASKBAR_HEIGHT = 44;

const section = document.getElementById("windows");
const desktopEl = section && section.querySelector(".desktop");
const taskbarButtons = section && section.querySelector(".taskbar-buttons");
const startOrb = section && section.querySelector(".start-orb");
const startMenu = section && section.querySelector(".start-menu");
const clockEl = section && section.querySelector(".taskbar-clock");

const cards = new Map();
const listeners = new Set();
let state = null;

function desktopSize() {
  return {
    width: desktopEl.clientWidth,
    height: Math.max(TITLEBAR_HEIGHT, desktopEl.clientHeight - TASKBAR_HEIGHT),
  };
}

// data-x="16%" 같은 값을 데스크톱 크기 기준 픽셀로 바꾼다. 퍼센트가 아니면
// 그대로 픽셀로 읽는다.
function resolveLength(value, total, fallback) {
  if (!value) return fallback;
  const trimmed = String(value).trim();
  if (trimmed.endsWith("%")) return (parseFloat(trimmed) / 100) * total;
  const number = parseFloat(trimmed);
  return Number.isFinite(number) ? number : fallback;
}

function readInitialWindows(size) {
  return [...desktopEl.querySelectorAll(".window-card[data-window]")].map((card) => {
    const id = card.dataset.window;
    cards.set(id, card);
    return {
      id,
      title: card.dataset.title || card.querySelector(".window-title")?.textContent?.trim() || id,
      rect: {
        x: resolveLength(card.dataset.x, size.width, 40),
        y: resolveLength(card.dataset.y, size.height, 40),
        width: resolveLength(card.dataset.w, size.width, 420),
        height: resolveLength(card.dataset.h, size.height, 300),
      },
    };
  });
}

function emit(previous) {
  for (const listener of listeners) listener(state, previous);
}

function setState(next) {
  if (next === state) return;
  const previous = state;
  state = next;
  render(previous);
  emit(previous);
}

function renderTaskbar() {
  const items = taskbarItems(state);
  const existing = new Map(
    [...taskbarButtons.children].map((node) => [node.dataset.window, node])
  );

  for (const item of items) {
    let button = existing.get(item.id);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "taskbar-button";
      button.dataset.window = item.id;
      button.addEventListener("click", () => setState(toggleMinimize(state, item.id)));
      taskbarButtons.appendChild(button);
    }
    existing.delete(item.id);
    button.textContent = item.title;
    button.classList.toggle("is-active", item.active);
    button.classList.toggle("is-minimized", item.minimized);
    button.setAttribute("aria-pressed", String(item.active));
  }

  // 닫힌 창의 버튼은 사라진다.
  for (const leftover of existing.values()) leftover.remove();
}

function render(previous) {
  const active = activeWindowId(state);
  for (const [id, card] of cards) {
    const target = state.windows[id];
    const visible = target.open && !target.minimized;
    card.hidden = !visible;
    card.classList.toggle("is-active", id === active);
    card.classList.toggle("is-maximized", target.maximized);
    card.style.left = `${Math.round(target.rect.x)}px`;
    card.style.top = `${Math.round(target.rect.y)}px`;
    card.style.width = `${Math.round(target.rect.width)}px`;
    card.style.height = `${Math.round(target.rect.height)}px`;
    card.style.zIndex = String(zIndexOf(state, id));

    // 창 크기가 바뀐 프레임에만 알려준다 — 캔버스를 쓰는 앱이 다시 그리도록.
    const before = previous?.windows?.[id];
    const resized =
      !before ||
      before.rect.width !== target.rect.width ||
      before.rect.height !== target.rect.height ||
      (!before.open && target.open) ||
      (before.minimized && !target.minimized);
    if (visible && resized) {
      card.dispatchEvent(new CustomEvent("window:resize", { detail: { rect: target.rect } }));
    }
  }
  renderTaskbar();
}

function startDrag(card, id, event) {
  // 버튼 위에서 시작한 드래그는 무시 — 그건 클릭이다.
  if (event.button !== 0 || event.target.closest(".win-btn")) return;
  const rect = state.windows[id].rect;
  const maximized = state.windows[id].maximized;
  // 최대화된 창을 끌면 복원되면서 커서가 잡은 지점의 비율을 유지한다.
  const ratioX = maximized ? (event.clientX - card.getBoundingClientRect().left) / rect.width : 0;
  const offsetX = maximized
    ? (state.windows[id].restoreRect?.width || rect.width) * ratioX
    : event.clientX - card.getBoundingClientRect().left;
  const offsetY = event.clientY - card.getBoundingClientRect().top;

  const desktopRect = desktopEl.getBoundingClientRect();
  event.preventDefault();
  card.setPointerCapture(event.pointerId);
  card.classList.add("is-dragging");

  const onMove = (moveEvent) => {
    setState(
      moveWindow(state, id, {
        x: moveEvent.clientX - desktopRect.left - offsetX,
        y: moveEvent.clientY - desktopRect.top - offsetY,
      })
    );
  };

  const onUp = () => {
    card.classList.remove("is-dragging");
    card.removeEventListener("pointermove", onMove);
    card.removeEventListener("pointerup", onUp);
    card.removeEventListener("pointercancel", onUp);
  };

  card.addEventListener("pointermove", onMove);
  card.addEventListener("pointerup", onUp);
  card.addEventListener("pointercancel", onUp);
}

function wireCard(id, card) {
  const titlebar = card.querySelector(".window-titlebar");

  card.addEventListener("pointerdown", () => setState(focusWindow(state, id)), true);
  titlebar?.addEventListener("pointerdown", (event) => startDrag(card, id, event));
  titlebar?.addEventListener("dblclick", (event) => {
    if (event.target.closest(".win-btn")) return;
    setState(toggleMaximize(state, id));
  });

  card.querySelector(".win-minimize")?.addEventListener("click", () => {
    setState(minimizeWindow(state, id));
  });
  card.querySelector(".win-maximize")?.addEventListener("click", () => {
    setState(toggleMaximize(state, id));
  });
  card.querySelector(".win-close")?.addEventListener("click", () => {
    setState(closeWindow(state, id));
  });
}

function setStartMenuOpen(open) {
  if (!startMenu || !startOrb) return;
  startMenu.hidden = !open;
  startOrb.setAttribute("aria-expanded", String(open));
  startOrb.classList.toggle("is-open", open);
}

function wireStartMenu() {
  if (!startOrb || !startMenu) return;

  startOrb.addEventListener("click", (event) => {
    event.stopPropagation();
    setStartMenuOpen(startMenu.hidden);
  });

  for (const button of section.querySelectorAll("[data-launch]")) {
    const id = button.dataset.launch;
    const launch = () => {
      setState(openWindow(state, id));
      setStartMenuOpen(false);
    };
    // 데스크톱 아이콘은 더블클릭(실제 Windows처럼), 메뉴 항목은 한 번 클릭.
    if (button.classList.contains("desktop-icon")) {
      button.addEventListener("dblclick", launch);
      button.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          launch();
        }
      });
    } else {
      button.addEventListener("click", launch);
    }
  }

  document.addEventListener("pointerdown", (event) => {
    if (startMenu.hidden) return;
    if (event.target.closest(".start-menu") || event.target.closest(".start-orb")) return;
    setStartMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setStartMenuOpen(false);
  });
}

function startClock() {
  if (!clockEl) return;
  const update = () => {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    clockEl.dateTime = now.toISOString();
    clockEl.title = now.toLocaleDateString("ko-KR", { dateStyle: "full" });
  };
  update();
  setInterval(update, 30_000);
}

// 다른 앱 모듈이 쓰는 최소한의 창구.
export const desktop = {
  open: (id) => setState(openWindow(state, id)),
  close: (id) => setState(closeWindow(state, id)),
  focus: (id) => setState(focusWindow(state, id)),
  element: (id) => cards.get(id) || null,
  isVisible: (id) => {
    const target = state?.windows?.[id];
    return Boolean(target && target.open && !target.minimized);
  },
  subscribe(listener) {
    listeners.add(listener);
    if (state) listener(state, null);
    return () => listeners.delete(listener);
  },
};

function init() {
  const size = desktopSize();
  state = createDesktop({ desktop: size, windows: readInitialWindows(size) });
  for (const [id, card] of cards) wireCard(id, card);
  wireStartMenu();
  startClock();
  render(null);

  const onResize = () => setState(resizeDesktop(state, desktopSize()));
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(desktopEl);
  else window.addEventListener("resize", onResize);

  section.classList.add("desktop-ready");
}

if (desktopEl && taskbarButtons) init();
