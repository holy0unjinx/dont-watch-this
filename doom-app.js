// 제어판을 열면 표시 설정 대신 DOOM이 뜬다. 엔진은 vendor/wasm-doom
// (MIT, 셰어웨어 WAD 내장 wasm 빌드)이고, DOS 에뮬레이션은 없다.
//
// 라이브러리의 start()는 자체 requestAnimationFrame 루프를 돌리고 멈출 방법이
// 없어서, loadGame()만 쓰고 루프는 여기서 직접 굴린다 — 창이 닫히거나
// 최소화되면 멈춰야 하기 때문.
import { DOOM } from "./vendor/wasm-doom/index.js";
import { desktop } from "./window-manager.js";

const DOOM_WIDTH = 640;
const DOOM_HEIGHT = 400;
const WINDOW_ID = "cpanel";

const card = document.querySelector(`.window-card[data-window="${WINDOW_ID}"]`);
const stage = card && card.querySelector(".doom-stage");
const canvas = card && card.querySelector(".doom-canvas");
const overlay = card && card.querySelector(".doom-overlay");
const statusEl = card && card.querySelector(".doom-status");
const startButton = card && card.querySelector(".doom-start");

function setStatus(text, { busy = false } = {}) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.toggle("is-busy", busy);
}

if (canvas && stage && startButton) {
  const context = canvas.getContext("2d");
  const desktopOnly = window.matchMedia("(min-width: 769px)");

  let exports = null;
  let raf = 0;
  let booting = false;

  function frame() {
    raf = requestAnimationFrame(frame);
    exports.doom_loop_step();
  }

  function resume() {
    if (raf || !exports) return;
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  async function boot() {
    if (booting || exports) return;
    booting = true;
    startButton.disabled = true;
    setStatus("DOOM.EXE 불러오는 중…", { busy: true });

    try {
      const game = new DOOM({
        screenWidth: DOOM_WIDTH,
        screenHeight: DOOM_HEIGHT,
        wasmURL: "vendor/wasm-doom/doom.wasm",
        // 키 입력을 창 안으로 가둔다 — 전역에 걸면 방향키가 페이지 스크롤을
        // 먹어버린다.
        keyboardTarget: stage,
        onFrameRender: ({ screen }) => {
          context.putImageData(new ImageData(screen, DOOM_WIDTH, DOOM_HEIGHT), 0, 0);
        },
      });

      const wasm = await game.loadGame();
      exports = wasm.instance.exports;
      game.keyboard.bindKeyDown((code) => exports.add_browser_event(0, code));
      game.keyboard.bindKeyUp((code) => exports.add_browser_event(1, code));
      exports.main();

      overlay.hidden = true;
      stage.classList.add("is-running");
      stage.focus();
      resume();
    } catch (err) {
      console.error("[doom] 실행 실패", err);
      setStatus("DOOM을 불러오지 못했습니다.");
      startButton.disabled = false;
    } finally {
      booting = false;
    }
  }

  startButton.addEventListener("click", boot);
  // 창 안을 클릭하면 키 입력이 그리로 가도록.
  stage.addEventListener("pointerdown", () => stage.focus());

  // 창이 닫히거나 최소화되면 루프를 멈춘다. 다시 열면 하던 판이 이어진다.
  desktop.subscribe(() => {
    if (!exports) return;
    if (desktop.isVisible(WINDOW_ID)) resume();
    else pause();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else if (desktop.isVisible(WINDOW_ID)) resume();
  });

  function syncAvailability() {
    const allowed = desktopOnly.matches;
    startButton.hidden = !allowed;
    if (!allowed) {
      pause();
      setStatus("DOOM은 데스크톱 화면에서만 실행됩니다.");
    } else if (!exports) {
      setStatus("표시 설정을 여는 중…");
    }
  }
  desktopOnly.addEventListener("change", syncAvailability);
  syncAvailability();
}
