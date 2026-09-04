// 섹션이 처음 화면을 덮을 때 한 번, Win7 부팅 → 로그온 → 데스크톱 순서를
// 보여준다. 진행 규칙은 boot-state.js(순수)에 있고 여기서는 타이머와 화면,
// 그리고 "건너뛰기"만 다룬다. 연출이 방해가 되면 안 되므로 아무 입력이나
// 들어오면 즉시 끝낸다.
import {
  createBoot,
  currentStage,
  advance,
  skip,
  isDone,
  shouldPlay,
  STORAGE_KEY,
} from "./boot-state.js";

const section = document.getElementById("windows");
const overlay = section && section.querySelector(".boot-sequence");

function alreadyPlayed() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // 사생활 보호 모드 등에서 sessionStorage가 막혀 있으면 그냥 튼다.
    return false;
  }
}

function markPlayed() {
  try {
    sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* 저장 못 해도 연출은 이미 끝났으니 문제 없다 */
  }
}

if (overlay) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wideScreen = window.matchMedia("(min-width: 769px)").matches;

  if (!shouldPlay({ reducedMotion, alreadyPlayed: alreadyPlayed(), wideScreen })) {
    overlay.remove();
  } else {
    let state = createBoot();
    let timer = 0;

    function paint() {
      overlay.dataset.stage = state.stage;
      overlay.hidden = false;
    }

    function finish() {
      clearTimeout(timer);
      markPlayed();
      overlay.classList.add("is-finishing");
      // 페이드가 끝난 뒤에 치운다 — 남겨두면 클릭을 가로챈다.
      overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
      setTimeout(() => overlay.remove(), 900);
      detach();
    }

    function step() {
      state = advance(state);
      if (isDone(state)) {
        finish();
        return;
      }
      paint();
      timer = setTimeout(step, currentStage(state).duration);
    }

    function onSkip() {
      state = skip(state);
      finish();
    }

    const onKey = (event) => {
      if (event.key === "Tab") return; // 포커스 이동까지 막을 이유는 없다
      onSkip();
    };

    function detach() {
      document.removeEventListener("keydown", onKey);
      overlay.removeEventListener("pointerdown", onSkip);
      window.removeEventListener("wheel", onSkip);
    }

    function begin() {
      paint();
      timer = setTimeout(step, currentStage(state).duration);
      document.addEventListener("keydown", onKey);
      overlay.addEventListener("pointerdown", onSkip);
      window.addEventListener("wheel", onSkip, { passive: true });
    }

    // 섹션이 화면 대부분을 덮었을 때 시작한다 — 위쪽 섹션을 읽는 동안
    // 아래에서 혼자 연출이 끝나 있으면 의미가 없다.
    const observer = new IntersectionObserver(
      (entries, self) => {
        if (!entries.some((entry) => entry.intersectionRatio >= 0.6)) return;
        self.disconnect();
        begin();
      },
      { threshold: [0, 0.6, 1] }
    );
    observer.observe(section);
  }
}
