// 데스크톱 창 상태. DOM을 모르는 순수 데이터 계층이라 node에서 그대로
// 테스트한다. 모든 함수는 상태를 받아 새 상태를 돌려주고, 바뀐 게 없으면
// 받은 상태를 그대로 돌려준다(참조 비교로 재렌더를 건너뛸 수 있게).
//
// 상태 모양:
//   { desktop: {width, height},
//     windows: { [id]: {id, title, icon, rect, restoreRect, open, minimized, maximized} },
//     order: [id...] }   // 뒤로 갈수록 위에 있는 창

// 타이틀바가 이만큼은 남아야 다시 잡을 수 있다.
export const TITLEBAR_HEIGHT = 30;
// 창을 화면 밖으로 밀어도 최소한 이만큼은 보이게 남긴다.
export const MIN_VISIBLE = 80;
// 가장자리에서 이 거리 안쪽이면 스냅으로 친다.
export const SNAP_THRESHOLD = 12;

function clampRect(rect, desktop) {
  const width = Math.min(rect.width, desktop.width);
  const height = Math.min(rect.height, desktop.height);
  return {
    x: Math.min(Math.max(rect.x, MIN_VISIBLE - width), desktop.width - MIN_VISIBLE),
    y: Math.min(Math.max(rect.y, 0), Math.max(0, desktop.height - TITLEBAR_HEIGHT)),
    width,
    height,
  };
}

function replaceWindow(state, id, changes) {
  const target = state.windows[id];
  if (!target) return state;
  return {
    ...state,
    windows: { ...state.windows, [id]: { ...target, ...changes } },
  };
}

// 포커스 스택 맨 위로 올린다. 이미 맨 위면 그대로.
function raise(state, id) {
  const index = state.order.indexOf(id);
  if (index === -1 || index === state.order.length - 1) return state;
  const order = state.order.filter((value) => value !== id);
  order.push(id);
  return { ...state, order };
}

export function createDesktop({ desktop, windows }) {
  const entries = {};
  const order = [];
  for (const spec of windows) {
    entries[spec.id] = {
      id: spec.id,
      title: spec.title,
      icon: spec.icon || null,
      rect: clampRect(spec.rect, desktop),
      restoreRect: null,
      open: spec.open !== false,
      minimized: false,
      maximized: false,
    };
    order.push(spec.id);
  }
  return { desktop: { ...desktop }, windows: entries, order };
}

// 화면에 실제로 보이는 창들 — 위에 있는 것이 뒤쪽.
function visibleOrder(state) {
  return state.order.filter((id) => {
    const target = state.windows[id];
    return target.open && !target.minimized;
  });
}

export function stackOrder(state) {
  return state.order.filter((id) => state.windows[id].open);
}

export function activeWindowId(state) {
  const visible = visibleOrder(state);
  return visible.length ? visible[visible.length - 1] : null;
}

export function taskbarItems(state) {
  const active = activeWindowId(state);
  return state.order
    .filter((id) => state.windows[id].open)
    .map((id) => {
      const target = state.windows[id];
      return {
        id,
        title: target.title,
        icon: target.icon,
        minimized: target.minimized,
        active: id === active,
      };
    });
}

// 창마다 z-index를 매긴다. 스택에서 뒤쪽일수록 큰 값.
export function zIndexOf(state, id) {
  const index = state.order.indexOf(id);
  return index === -1 ? 0 : 10 + index;
}

export function focusWindow(state, id) {
  const target = state.windows[id];
  if (!target || !target.open) return state;
  const restored = target.minimized ? replaceWindow(state, id, { minimized: false }) : state;
  return raise(restored, id);
}

export function openWindow(state, id) {
  const target = state.windows[id];
  if (!target) return state;
  return raise(replaceWindow(state, id, { open: true, minimized: false }), id);
}

export function closeWindow(state, id) {
  const target = state.windows[id];
  if (!target || !target.open) return state;
  return replaceWindow(state, id, { open: false, minimized: false });
}

export function minimizeWindow(state, id) {
  const target = state.windows[id];
  if (!target || !target.open || target.minimized) return state;
  return replaceWindow(state, id, { minimized: true });
}

// 작업표시줄 버튼을 눌렀을 때의 동작: 활성 창이면 내리고, 아니면 올린다.
export function toggleMinimize(state, id) {
  const target = state.windows[id];
  if (!target || !target.open) return state;
  if (target.minimized) return focusWindow(state, id);
  return activeWindowId(state) === id ? minimizeWindow(state, id) : focusWindow(state, id);
}

export function maximizeWindow(state, id) {
  const target = state.windows[id];
  if (!target || target.maximized) return state;
  const next = replaceWindow(state, id, {
    maximized: true,
    restoreRect: { ...target.rect },
    rect: { x: 0, y: 0, width: state.desktop.width, height: state.desktop.height },
  });
  return raise(next, id);
}

export function restoreWindow(state, id) {
  const target = state.windows[id];
  if (!target || !target.maximized) return state;
  return replaceWindow(state, id, {
    maximized: false,
    rect: clampRect(target.restoreRect || target.rect, state.desktop),
    restoreRect: null,
  });
}

export function toggleMaximize(state, id) {
  const target = state.windows[id];
  if (!target) return state;
  return target.maximized ? restoreWindow(state, id) : maximizeWindow(state, id);
}

// 드래그 이동. 최대화 상태에서 끌면 실제 Windows처럼 복원되며 끌려온다.
export function moveWindow(state, id, position) {
  const target = state.windows[id];
  if (!target) return state;
  const base = target.maximized ? restoreWindow(state, id) : state;
  const rect = base.windows[id].rect;
  return replaceWindow(base, id, {
    rect: clampRect({ ...rect, x: position.x, y: position.y }, base.desktop),
  });
}

export function setRect(state, id, rect) {
  const target = state.windows[id];
  if (!target) return state;
  return replaceWindow(state, id, {
    maximized: false,
    restoreRect: null,
    rect: clampRect(rect, state.desktop),
  });
}

export function resizeDesktop(state, desktop) {
  if (desktop.width === state.desktop.width && desktop.height === state.desktop.height) return state;
  const windows = {};
  for (const [id, target] of Object.entries(state.windows)) {
    windows[id] = target.maximized
      ? { ...target, rect: { x: 0, y: 0, width: desktop.width, height: desktop.height } }
      : { ...target, rect: clampRect(target.rect, desktop) };
  }
  return { ...state, desktop: { ...desktop }, windows };
}

// 포인터가 가장자리에 닿았는지. 모서리에서는 위쪽(최대화)이 이긴다.
export function snapZoneFor(pointer, desktop, threshold = SNAP_THRESHOLD) {
  if (pointer.y <= threshold) return "top";
  if (pointer.x <= threshold) return "left";
  if (pointer.x >= desktop.width - threshold) return "right";
  return null;
}

export function snapRect(zone, desktop) {
  if (zone === "top") return { x: 0, y: 0, width: desktop.width, height: desktop.height };
  if (zone === "left") {
    return { x: 0, y: 0, width: Math.round(desktop.width / 2), height: desktop.height };
  }
  if (zone === "right") {
    const width = Math.round(desktop.width / 2);
    return { x: desktop.width - width, y: 0, width, height: desktop.height };
  }
  return null;
}
