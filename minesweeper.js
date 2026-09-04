// 지뢰찾기 보드 규칙. DOM을 모르는 순수 계층이라 node에서 그대로 테스트한다.
// 화면 그리기와 타이머는 minesweeper-ui.js가 맡는다.
//
// 상태 모양:
//   { rows, cols, mines, status: 'ready'|'playing'|'won'|'lost',
//     explodedIndex: number|null,
//     cells: [{ mine, adjacent, revealed, flagged }] }
//
// 지뢰는 첫 클릭 "후에" 놓는다. 그래야 첫 판이 한 번에 끝나지 않고, 클릭한
// 자리와 그 이웃까지 비워 둘 수 있어 항상 넓게 열리며 시작한다.

export const DEFAULT_CONFIG = { rows: 9, cols: 9, mines: 10 };

function emptyCell() {
  return { mine: false, adjacent: 0, revealed: false, flagged: false };
}

export function createGame({ rows, cols, mines } = DEFAULT_CONFIG) {
  const total = rows * cols;
  return {
    rows,
    cols,
    // 첫 클릭 자리 하나는 반드시 비어야 하므로 그만큼은 남겨 둔다.
    mines: Math.max(0, Math.min(mines, total - 1)),
    status: "ready",
    explodedIndex: null,
    cells: Array.from({ length: total }, emptyCell),
  };
}

export function indexOf(game, row, col) {
  return row * game.cols + col;
}

export function neighborsOf(game, index) {
  const row = Math.floor(index / game.cols);
  const col = index % game.cols;
  const result = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || c < 0 || r >= game.rows || c >= game.cols) continue;
      result.push(r * game.cols + c);
    }
  }
  return result;
}

export function remainingMines(game) {
  const flags = game.cells.filter((cell) => cell.flagged).length;
  return game.mines - flags;
}

function cloneCells(game) {
  return game.cells.map((cell) => ({ ...cell }));
}

// 첫 클릭 자리와 그 이웃을 피해서 지뢰를 뿌린다. 칸이 모자라면 이웃 보호를
// 포기하고 클릭한 칸만 지킨다(3x3처럼 작은 판).
function placeMines(game, safeIndex, random) {
  const total = game.rows * game.cols;
  const protectedCells = new Set([safeIndex, ...neighborsOf(game, safeIndex)]);
  if (total - protectedCells.size < game.mines) {
    protectedCells.clear();
    protectedCells.add(safeIndex);
  }

  const candidates = [];
  for (let index = 0; index < total; index++) {
    if (!protectedCells.has(index)) candidates.push(index);
  }

  // 피셔-예이츠로 섞어서 앞에서 필요한 만큼 쓴다.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const cells = cloneCells(game);
  for (const index of candidates.slice(0, game.mines)) cells[index].mine = true;
  for (let index = 0; index < total; index++) {
    cells[index].adjacent = neighborsOf(game, index).filter((n) => cells[n].mine).length;
  }
  return { ...game, cells, status: "playing" };
}

// 빈 칸(0)에서 시작하면 이웃을 따라 계속 연다.
function floodReveal(cells, game, startIndex) {
  const queue = [startIndex];
  const seen = new Set(queue);

  while (queue.length > 0) {
    const index = queue.pop();
    const cell = cells[index];
    if (cell.revealed || cell.flagged) continue;
    cell.revealed = true;
    if (cell.adjacent !== 0) continue;
    for (const neighbor of neighborsOf(game, index)) {
      if (!seen.has(neighbor) && !cells[neighbor].revealed && !cells[neighbor].flagged) {
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
}

function finish(game, cells, status, explodedIndex = null) {
  if (status === "lost") {
    for (const cell of cells) {
      if (cell.mine) cell.revealed = true;
    }
  } else if (status === "won") {
    // 남은 지뢰는 자동으로 깃발 처리 — 실제 게임과 같은 마무리.
    for (const cell of cells) {
      if (cell.mine) cell.flagged = true;
    }
  }
  return { ...game, cells, status, explodedIndex };
}

function checkWin(game, cells) {
  const safeTotal = game.rows * game.cols - game.mines;
  const revealed = cells.filter((cell) => cell.revealed && !cell.mine).length;
  return revealed >= safeTotal;
}

export function reveal(game, index, random = Math.random) {
  if (game.status === "won" || game.status === "lost") return game;
  const current = game.cells[index];
  if (!current || current.revealed || current.flagged) return game;

  const placed = game.status === "ready" ? placeMines(game, index, random) : game;
  const cells = cloneCells(placed);

  if (cells[index].mine) return finish(placed, cells, "lost", index);

  floodReveal(cells, placed, index);
  if (checkWin(placed, cells)) return finish(placed, cells, "won");
  return { ...placed, cells };
}

export function toggleFlag(game, index) {
  if (game.status === "won" || game.status === "lost") return game;
  const current = game.cells[index];
  if (!current || current.revealed) return game;
  const cells = cloneCells(game);
  cells[index].flagged = !cells[index].flagged;
  return { ...game, cells };
}

// 열린 숫자 칸을 눌렀을 때, 이웃 깃발 수가 숫자와 같으면 나머지를 연다.
// 깃발이 틀렸으면 그대로 지뢰를 밟는다 — 그게 이 기능의 위험이자 재미.
export function chord(game, index) {
  if (game.status !== "playing") return game;
  const current = game.cells[index];
  if (!current || !current.revealed || current.adjacent === 0) return game;

  const neighbors = neighborsOf(game, index);
  const flagged = neighbors.filter((n) => game.cells[n].flagged).length;
  if (flagged !== current.adjacent) return game;

  const targets = neighbors.filter((n) => !game.cells[n].revealed && !game.cells[n].flagged);
  if (targets.length === 0) return game;

  let next = game;
  for (const target of targets) {
    next = reveal(next, target);
    if (next.status === "lost") return next;
  }
  return next;
}
