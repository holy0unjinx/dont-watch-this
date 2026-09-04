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
  renameWindow,
  resizeDesktop,
  setRect,
  maximizeWindow,
  snapZoneFor,
  snapRect,
  activeWindowId,
  taskbarItems,
  zIndexOf,
  TITLEBAR_HEIGHT,
} from "./window-state.js";

const TASKBAR_HEIGHT = 44;
// 좁은 화면에서는 창을 끌고 겹치는 은유가 성립하지 않는다(작업표시줄과
// 바탕화면 아이콘이 화면을 다 먹고, 드래그는 스크롤과 싸운다). 그래서
// 데스크톱 동작 자체를 끄고 CSS가 카드를 세로로 쌓게 둔다.
const DESKTOP_QUERY = "(min-width: 769px)";

const section = document.getElementById("windows");
const desktopEl = section && section.querySelector(".desktop");
const taskbarButtons = section && section.querySelector(".taskbar-buttons");
const snapPreview = section && section.querySelector(".snap-preview");
const peek = section && section.querySelector(".taskbar-peek");
const startOrb = section && section.querySelector(".start-orb");
const startMenu = section && section.querySelector(".start-menu");
const clockEl = section && section.querySelector(".taskbar-clock");

const cards = new Map();
const listeners = new Set();
let state = null;
let wired = false;
let resizeObserver = null;

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
      button.addEventListener("click", () => {
        hidePeek();
        setState(toggleMinimize(state, item.id));
      });
      button.addEventListener("pointerenter", () => showPeek(item.id, button));
      button.addEventListener("pointerleave", hidePeek);
      button.addEventListener("focus", () => showPeek(item.id, button));
      button.addEventListener("blur", hidePeek);
      taskbarButtons.appendChild(button);
    }
    existing.delete(item.id);
    button.textContent = item.title;
    button.classList.toggle("is-active", item.active);
    button.classList.toggle("is-minimized", item.minimized);
    button.setAttribute("aria-pressed", String(item.active));
  }

  // 닫힌 창의 버튼은 사라진다.
  for (const leftover of existing.values()) {
    leftover.remove();
    hidePeek();
  }
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

    const titleEl = card.querySelector(".window-title");
    if (titleEl && titleEl.textContent !== target.title) titleEl.textContent = target.title;

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

// 놓으면 창이 갈 자리를 반투명 사각형으로 미리 보여준다.
function showSnapPreview(zone) {
  if (!snapPreview) return;
  const rect = state ? snapRect(zone, state.desktop) : null;
  if (!rect) {
    snapPreview.hidden = true;
    return;
  }
  snapPreview.style.left = `${rect.x}px`;
  snapPreview.style.top = `${rect.y}px`;
  snapPreview.style.width = `${rect.width}px`;
  snapPreview.style.height = `${rect.height}px`;
  snapPreview.hidden = false;
}

// 작업표시줄 버튼에 마우스를 올리면 뜨는 작은 카드(Aero Peek 흉내).
// 실제 창 썸네일 대신 제목과 그 창의 유리색으로 만든 미니 프레임을 보여준다.
function showPeek(id, button) {
  if (!peek || !state.windows[id]) return;
  const target = state.windows[id];
  peek.querySelector(".taskbar-peek-title").textContent = target.title;
  peek.querySelector(".taskbar-peek-state").textContent = target.minimized ? "최소화됨" : "열려 있음";

  const card = cards.get(id);
  const frame = peek.querySelector(".taskbar-peek-frame");
  if (card && frame) {
    const glass = getComputedStyle(card).getPropertyValue("--win7-theme-color").trim();
    frame.style.background = glass || "";
  }

  peek.hidden = false;
  const buttonRect = button.getBoundingClientRect();
  const sectionRect = section.getBoundingClientRect();
  const width = peek.offsetWidth;
  const left = buttonRect.left - sectionRect.left + buttonRect.width / 2 - width / 2;
  peek.style.left = `${Math.max(6, Math.min(left, sectionRect.width - width - 6))}px`;
}

function hidePeek() {
  if (peek) peek.hidden = true;
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

  let zone = null;

  const onMove = (moveEvent) => {
    const pointer = {
      x: moveEvent.clientX - desktopRect.left,
      y: moveEvent.clientY - desktopRect.top,
    };
    // 가장자리에 닿으면 놓았을 때 어디에 붙을지 먼저 보여준다.
    zone = snapZoneFor(pointer, state.desktop);
    showSnapPreview(zone);
    setState(
      moveWindow(state, id, {
        x: moveEvent.clientX - desktopRect.left - offsetX,
        y: moveEvent.clientY - desktopRect.top - offsetY,
      })
    );
  };

  const onUp = () => {
    card.classList.remove("is-dragging");
    showSnapPreview(null);
    if (zone === "top") setState(maximizeWindow(state, id));
    else if (zone) setState(setRect(state, id, snapRect(zone, state.desktop)));
    zone = null;
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
  // 모바일에서는 상태가 없다 — 호출은 조용히 무시된다.
  open: (id) => state && setState(openWindow(state, id)),
  close: (id) => state && setState(closeWindow(state, id)),
  focus: (id) => state && setState(focusWindow(state, id)),
  setTitle: (id, title) => state && setState(renameWindow(state, id, title)),
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

function clearInlineLayout() {
  for (const card of cards.values()) {
    card.hidden = false;
    card.classList.remove("is-active", "is-maximized", "is-dragging");
    card.style.left = "";
    card.style.top = "";
    card.style.width = "";
    card.style.height = "";
    card.style.zIndex = "";
  }
  taskbarButtons.replaceChildren();
}

function enable() {
  const size = desktopSize();
  state = createDesktop({ desktop: size, windows: readInitialWindows(size) });

  if (!wired) {
    for (const [id, card] of cards) wireCard(id, card);
    wireStartMenu();
    startClock();
    wired = true;
  }

  render(null);
  emit(null);

  if (window.ResizeObserver) {
    resizeObserver = new ResizeObserver(() => setState(resizeDesktop(state, desktopSize())));
    resizeObserver.observe(desktopEl);
  }
  section.classList.add("desktop-ready");
}

function disable() {
  hidePeek();
  showSnapPreview(null);
  resizeObserver?.disconnect();
  resizeObserver = null;
  state = null;
  clearInlineLayout();
  setStartMenuOpen(false);
  section.classList.remove("desktop-ready");
}

function init() {
  // 카드 목록은 화면 크기와 무관하게 먼저 채워둔다(모바일에서도 정리에 필요).
  readInitialWindows(desktopSize());

  const query = window.matchMedia(DESKTOP_QUERY);
  const sync = () => {
    if (query.matches && !state) enable();
    else if (!query.matches && state) disable();
  };
  sync();
  query.addEventListener("change", sync);
}

if (desktopEl && taskbarButtons) init();
