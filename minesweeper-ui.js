// 지뢰찾기 창의 화면과 입력. 규칙은 minesweeper.js(순수)에 있고 여기서는
// 그리기, 타이머, 클릭 배선만 한다.
import {
  DEFAULT_CONFIG,
  createGame,
  reveal,
  toggleFlag,
  chord,
  remainingMines,
} from "./minesweeper.js";

const card = document.querySelector('.window-card[data-window="minesweeper"]');
const grid = card && card.querySelector(".mine-grid");
const counterEl = card && card.querySelector(".mine-counter");
const timerEl = card && card.querySelector(".mine-timer");
const resetButton = card && card.querySelector(".mine-reset");

const pad = (value) => String(Math.max(0, Math.min(999, value))).padStart(3, "0");

if (grid) {
  let game = createGame(DEFAULT_CONFIG);
  let startedAt = 0;
  let timer = 0;
  const cellButtons = [];

  grid.style.setProperty("--mine-cols", String(game.cols));

  for (let index = 0; index < game.cells.length; index++) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mine-cell";
    button.dataset.index = String(index);
    button.setAttribute("role", "gridcell");
    grid.appendChild(button);
    cellButtons.push(button);
  }

  function stopTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = 0;
  }

  function startTimer() {
    if (timer) return;
    startedAt = Date.now();
    timer = setInterval(() => {
      timerEl.textContent = pad(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
  }

  function render() {
    for (let index = 0; index < game.cells.length; index++) {
      const cell = game.cells[index];
      const button = cellButtons[index];
      button.classList.toggle("is-revealed", cell.revealed);
      button.classList.toggle("is-flagged", cell.flagged && !cell.revealed);
      button.classList.toggle("is-mine", cell.revealed && cell.mine);
      button.classList.toggle("is-exploded", index === game.explodedIndex);
      button.dataset.adjacent = cell.revealed && !cell.mine ? String(cell.adjacent) : "";
      button.textContent = cell.revealed && !cell.mine && cell.adjacent > 0 ? String(cell.adjacent) : "";

      const label = cell.revealed
        ? cell.mine
          ? "지뢰"
          : `${cell.adjacent}`
        : cell.flagged
          ? "깃발"
          : "닫힌 칸";
      button.setAttribute("aria-label", label);
      button.disabled = false;
    }

    counterEl.textContent = pad(remainingMines(game));
    card.classList.toggle("is-won", game.status === "won");
    card.classList.toggle("is-lost", game.status === "lost");
    resetButton.dataset.state = game.status;

    if (game.status === "won" || game.status === "lost") stopTimer();
    else if (game.status === "playing") startTimer();
  }

  function update(next) {
    if (next === game) return;
    game = next;
    render();
  }

  function restart() {
    stopTimer();
    game = createGame(DEFAULT_CONFIG);
    timerEl.textContent = pad(0);
    render();
  }

  grid.addEventListener("click", (event) => {
    const button = event.target.closest(".mine-cell");
    if (!button) return;
    const index = Number(button.dataset.index);
    // 이미 열린 숫자를 누르면 코드(깃발 수가 맞으면 이웃 열기).
    update(game.cells[index].revealed ? chord(game, index) : reveal(game, index));
  });

  grid.addEventListener("contextmenu", (event) => {
    const button = event.target.closest(".mine-cell");
    if (!button) return;
    // 창 안에서 브라우저 메뉴가 뜨면 깃발을 꽂을 수가 없다.
    event.preventDefault();
    update(toggleFlag(game, Number(button.dataset.index)));
  });

  // 마우스가 없어도 깃발을 꽂을 수 있게 — 포커스된 칸에서 F.
  grid.addEventListener("keydown", (event) => {
    if (event.key !== "f" && event.key !== "F") return;
    const button = event.target.closest(".mine-cell");
    if (!button) return;
    event.preventDefault();
    update(toggleFlag(game, Number(button.dataset.index)));
  });

  resetButton.addEventListener("click", restart);

  restart();
}
