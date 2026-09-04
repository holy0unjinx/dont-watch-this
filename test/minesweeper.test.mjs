import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  createGame,
  reveal,
  toggleFlag,
  chord,
  remainingMines,
  indexOf,
  neighborsOf,
} from "../minesweeper.js";

function seededRandom(seed = 3) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const mineCount = (game) => game.cells.filter((cell) => cell.mine).length;
const revealedCount = (game) => game.cells.filter((cell) => cell.revealed).length;

test("새 게임은 지뢰가 아직 놓이지 않은 ready 상태", () => {
  const game = createGame(DEFAULT_CONFIG);
  assert.equal(game.status, "ready");
  assert.equal(game.cells.length, DEFAULT_CONFIG.rows * DEFAULT_CONFIG.cols);
  assert.equal(mineCount(game), 0, "첫 클릭 전에는 배치하지 않는다");
  assert.equal(remainingMines(game), DEFAULT_CONFIG.mines);
});

test("첫 클릭 자리와 그 이웃은 지뢰가 아니다", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const game = createGame(DEFAULT_CONFIG);
    const start = indexOf(game, 4, 4);
    const opened = reveal(game, start, seededRandom(seed));
    assert.equal(opened.cells[start].mine, false, `seed ${seed}: 첫 클릭이 지뢰`);
    for (const neighbor of neighborsOf(opened, start)) {
      assert.equal(opened.cells[neighbor].mine, false, `seed ${seed}: 첫 클릭 이웃이 지뢰`);
    }
    assert.equal(mineCount(opened), DEFAULT_CONFIG.mines, `seed ${seed}: 지뢰 개수`);
  }
});

test("첫 클릭은 반드시 빈 칸이라 주변이 함께 열린다", () => {
  const game = reveal(createGame(DEFAULT_CONFIG), indexOf(createGame(DEFAULT_CONFIG), 4, 4), seededRandom(7));
  assert.ok(revealedCount(game) >= 9, `열린 칸 ${revealedCount(game)}개`);
  assert.equal(game.status, "playing");
});

test("인접 지뢰 수는 이웃 8칸만 센다", () => {
  const game = reveal(createGame({ rows: 5, cols: 5, mines: 5 }), 12, seededRandom(11));
  for (let index = 0; index < game.cells.length; index++) {
    const expected = neighborsOf(game, index).filter((n) => game.cells[n].mine).length;
    assert.equal(game.cells[index].adjacent, expected, `${index}번 칸`);
  }
});

test("연쇄 열기는 숫자 칸에서 멈춘다", () => {
  const game = reveal(createGame(DEFAULT_CONFIG), indexOf(createGame(DEFAULT_CONFIG), 0, 0), seededRandom(5));
  for (const cell of game.cells) {
    if (!cell.revealed) continue;
    assert.equal(cell.mine, false, "지뢰가 열리면 안 된다");
  }
  // 열린 0칸의 이웃은 전부 열려 있어야 한다.
  for (let index = 0; index < game.cells.length; index++) {
    if (!game.cells[index].revealed || game.cells[index].adjacent !== 0) continue;
    for (const neighbor of neighborsOf(game, index)) {
      assert.ok(game.cells[neighbor].revealed, `${index}번 0칸의 이웃 ${neighbor}이 안 열렸다`);
    }
  }
});

test("깃발 꽂은 칸은 열리지 않는다", () => {
  let game = reveal(createGame(DEFAULT_CONFIG), 40, seededRandom(9));
  const closed = game.cells.findIndex((cell) => !cell.revealed);
  game = toggleFlag(game, closed);
  assert.equal(game.cells[closed].flagged, true);
  assert.equal(remainingMines(game), DEFAULT_CONFIG.mines - 1);

  const after = reveal(game, closed, seededRandom(9));
  assert.equal(after.cells[closed].revealed, false);
  assert.equal(after, game, "아무 일도 없으면 같은 상태를 돌려준다");
});

test("이미 열린 칸에는 깃발을 못 꽂는다", () => {
  const game = reveal(createGame(DEFAULT_CONFIG), 40, seededRandom(9));
  const open = game.cells.findIndex((cell) => cell.revealed);
  assert.equal(toggleFlag(game, open), game);
});

test("지뢰를 밟으면 패배하고 모든 지뢰가 드러난다", () => {
  let game = reveal(createGame(DEFAULT_CONFIG), 40, seededRandom(13));
  const mine = game.cells.findIndex((cell) => cell.mine);
  game = reveal(game, mine, seededRandom(13));
  assert.equal(game.status, "lost");
  assert.equal(game.explodedIndex, mine);
  for (const cell of game.cells) {
    if (cell.mine) assert.ok(cell.revealed, "지뢰가 안 드러났다");
  }
});

test("지뢰 아닌 칸을 모두 열면 승리하고 남은 지뢰에 깃발이 꽂힌다", () => {
  let game = reveal(createGame({ rows: 4, cols: 4, mines: 2 }), 5, seededRandom(21));
  for (let index = 0; index < game.cells.length; index++) {
    if (!game.cells[index].mine) game = reveal(game, index, seededRandom(21));
  }
  assert.equal(game.status, "won");
  assert.equal(remainingMines(game), 0);
  for (const cell of game.cells) {
    if (cell.mine) assert.equal(cell.flagged, true);
  }
});

test("끝난 게임은 더 이상 반응하지 않는다", () => {
  let game = reveal(createGame(DEFAULT_CONFIG), 40, seededRandom(13));
  const mine = game.cells.findIndex((cell) => cell.mine);
  game = reveal(game, mine, seededRandom(13));
  const closed = game.cells.findIndex((cell) => !cell.revealed);
  assert.equal(reveal(game, closed, seededRandom(1)), game);
  assert.equal(toggleFlag(game, closed), game);
});

test("숫자 칸 코드(깃발 수가 맞으면 이웃을 연다)", () => {
  let game = reveal(createGame(DEFAULT_CONFIG), 40, seededRandom(17));
  // 이웃에 지뢰가 하나 있고 이미 열린 숫자 칸을 찾는다.
  const numbered = game.cells.findIndex(
    (cell, index) =>
      cell.revealed &&
      cell.adjacent > 0 &&
      neighborsOf(game, index).some((n) => !game.cells[n].revealed && !game.cells[n].mine)
  );
  assert.ok(numbered >= 0, "테스트 조건에 맞는 칸이 없다");

  // 지뢰에 정확히 깃발을 꽂으면 나머지 이웃이 열린다.
  for (const neighbor of neighborsOf(game, numbered)) {
    if (game.cells[neighbor].mine) game = toggleFlag(game, neighbor);
  }
  const before = revealedCount(game);
  game = chord(game, numbered);
  assert.ok(revealedCount(game) > before, "코드로 아무것도 안 열렸다");

  // 깃발이 부족하면 아무 일도 없다.
  let other = reveal(createGame(DEFAULT_CONFIG), 40, seededRandom(19));
  const numbered2 = other.cells.findIndex((cell) => cell.revealed && cell.adjacent > 0);
  assert.equal(chord(other, numbered2), other);
});

test("지뢰 수는 칸 수보다 많을 수 없다", () => {
  const game = reveal(createGame({ rows: 3, cols: 3, mines: 99 }), 4, seededRandom(2));
  assert.ok(mineCount(game) <= 9 - 1, `지뢰 ${mineCount(game)}개`);
});

test("원래 상태를 건드리지 않는다", () => {
  const game = reveal(createGame(DEFAULT_CONFIG), 40, seededRandom(23));
  const snapshot = JSON.stringify(game);
  reveal(game, game.cells.findIndex((cell) => !cell.revealed), seededRandom(2));
  toggleFlag(game, 0);
  assert.equal(JSON.stringify(game), snapshot);
});
