import test from "node:test";
import assert from "node:assert/strict";
import {
  luminance,
  buildTargetSlots,
  assignByLuminance,
  transportCost,
  improveAssignment,
  meanColorMismatch,
} from "../pixel-transport.js";

function seededRandom(seed = 5) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 왼쪽 절반은 검정, 오른쪽 절반은 흰색인 이미지.
function splitImage(width = 20, height = 20) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const value = x < width / 2 ? 0 : 255;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return { data, width, height };
}

const particle = (x, y, lum) => ({ x, y, lum });

test("밝기는 사람 눈 기준(초록이 가장 무겁다)", () => {
  assert.equal(luminance(0, 0, 0), 0);
  assert.equal(luminance(255, 255, 255), 1);
  assert.ok(luminance(0, 255, 0) > luminance(255, 0, 0));
  assert.ok(luminance(255, 0, 0) > luminance(0, 0, 255));
});

test("목표 자리는 격자로 솎아내고 최대 개수를 넘지 않는다", () => {
  const slots = buildTargetSlots(splitImage(100, 100), { maxSlots: 500 });
  assert.ok(slots.length > 0);
  assert.ok(slots.length <= 700, `자리 ${slots.length}개`);
  for (const slot of slots) {
    assert.ok(slot.x >= 0 && slot.x <= 1, `x=${slot.x}`);
    assert.ok(slot.y >= 0 && slot.y <= 1, `y=${slot.y}`);
  }
});

test("투명한 픽셀은 자리에서 빠진다", () => {
  const image = splitImage(10, 10);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 0;
  assert.deepEqual(buildTargetSlots(image, { maxSlots: 100 }), []);
});

test("어두운 입자는 어두운 자리로, 밝은 입자는 밝은 자리로 간다", () => {
  const slots = buildTargetSlots(splitImage(20, 20), { maxSlots: 100 });
  const particles = [
    particle(0.9, 0.5, 0.0),
    particle(0.1, 0.5, 1.0),
    particle(0.5, 0.5, 0.05),
    particle(0.5, 0.5, 0.95),
  ];
  const assignment = assignByLuminance(particles, slots);

  for (let i = 0; i < particles.length; i++) {
    const slot = slots[assignment[i]];
    assert.ok(slot, `${i}번 입자에 자리가 없다`);
    if (particles[i].lum < 0.5) assert.ok(slot.lum < 0.5, `어두운 입자가 밝은 자리로 갔다`);
    else assert.ok(slot.lum > 0.5, `밝은 입자가 어두운 자리로 갔다`);
  }
});

test("입자가 자리보다 많아도 전부 배정된다", () => {
  const slots = buildTargetSlots(splitImage(8, 8), { maxSlots: 16 });
  const particles = Array.from({ length: 200 }, (_, i) => particle(0.5, 0.5, i / 200));
  const assignment = assignByLuminance(particles, slots);
  for (let i = 0; i < particles.length; i++) {
    assert.ok(assignment[i] >= 0 && assignment[i] < slots.length, `${i}번 미배정`);
  }
});

test("자리가 없으면 -1로 두고 터지지 않는다", () => {
  const assignment = assignByLuminance([particle(0.5, 0.5, 0.5)], []);
  assert.equal(assignment[0], -1);
  assert.equal(transportCost([particle(0.5, 0.5, 0.5)], [], assignment), 0);
});

test("교환 개선은 총 이동 비용을 절대 늘리지 않는다", () => {
  const slots = buildTargetSlots(splitImage(24, 24), { maxSlots: 400 });
  const random = seededRandom(7);
  const particles = Array.from({ length: 300 }, () => {
    const lum = random();
    return particle(random(), random(), lum);
  });

  const assignment = assignByLuminance(particles, slots);
  const before = transportCost(particles, slots, assignment);
  improveAssignment(particles, slots, assignment, { iterations: 3000, random: seededRandom(11) });
  const after = transportCost(particles, slots, assignment);

  assert.ok(after <= before + 1e-9, `비용이 늘었다 ${before} → ${after}`);
});

test("서로 목적지가 꼬인 두 입자는 교환으로 풀린다", () => {
  // 왼쪽 입자가 오른쪽 자리를, 오른쪽 입자가 왼쪽 자리를 보고 있다.
  const slots = [
    { x: 0, y: 0, r: 0, g: 0, b: 0, lum: 0 },
    { x: 1, y: 0, r: 0, g: 0, b: 0, lum: 0 },
  ];
  const particles = [particle(0, 0, 0), particle(1, 0, 0)];
  const crossed = Int32Array.from([1, 0]);

  const before = transportCost(particles, slots, crossed);
  improveAssignment(particles, slots, crossed, { iterations: 50, random: seededRandom(3) });
  const after = transportCost(particles, slots, crossed);

  assert.ok(after < before, `꼬임이 안 풀렸다 ${before} → ${after}`);
  assert.deepEqual([...crossed], [0, 1]);
});

test("개선을 더 오래 돌리면 결과가 나빠지지 않는다", () => {
  const slots = buildTargetSlots(splitImage(16, 16), { maxSlots: 200 });
  const random = seededRandom(23);
  const particles = Array.from({ length: 150 }, () => particle(random(), random(), random()));

  const short = assignByLuminance(particles, slots);
  improveAssignment(particles, slots, short, { iterations: 200, random: seededRandom(2) });
  const long = assignByLuminance(particles, slots);
  improveAssignment(particles, slots, long, { iterations: 8000, random: seededRandom(2) });

  assert.ok(
    transportCost(particles, slots, long) <= transportCost(particles, slots, short) + 1e-9
  );
});

test("maxLuminance로 흰 배경을 자리에서 뺀다", () => {
  const image = splitImage(20, 20); // 왼쪽 검정, 오른쪽 흰색
  const all = buildTargetSlots(image, { maxSlots: 400 });
  const noBackground = buildTargetSlots(image, { maxSlots: 400, maxLuminance: 0.92 });

  assert.ok(noBackground.length > 0, "전부 잘려나갔다");
  assert.ok(noBackground.length < all.length, "밝은 쪽이 그대로 남았다");
  for (const slot of noBackground) {
    assert.ok(slot.lum <= 0.92, `밝기 ${slot.lum}인 자리가 남았다`);
    assert.ok(slot.x < 0.5, "검정 영역(왼쪽)만 남아야 한다");
  }
});

test("colorWeight를 주면 색이 어울리는 자리로 바꾼다", () => {
  // 두 자리: 왼쪽은 빨강, 오른쪽은 파랑. 입자는 반대로 서 있다.
  const slots = [
    { x: 0, y: 0, r: 255, g: 0, b: 0, lum: 0.3 },
    { x: 1, y: 0, r: 0, g: 0, b: 255, lum: 0.1 },
  ];
  const particles = [
    { x: 0, y: 0, r: 0, g: 0, b: 255, lum: 0.1 },
    { x: 1, y: 0, r: 255, g: 0, b: 0, lum: 0.3 },
  ];
  const assignment = Int32Array.from([0, 1]); // 각자 제자리(색은 안 맞음)

  // 색을 안 보면 이미 최적(거리 0)이라 아무것도 안 바뀐다.
  const spatialOnly = Int32Array.from(assignment);
  improveAssignment(particles, slots, spatialOnly, { iterations: 200, random: seededRandom(3) });
  assert.deepEqual([...spatialOnly], [0, 1]);

  // 색을 보면 멀어지더라도 어울리는 자리로 간다.
  improveAssignment(particles, slots, assignment, {
    iterations: 200,
    random: seededRandom(3),
    colorWeight: 4,
  });
  assert.deepEqual([...assignment], [1, 0]);
  assert.equal(meanColorMismatch(particles, slots, assignment), 0);
});

test("색이 뒤섞인 배정도 colorWeight로 돌리면 제 색 자리를 찾아간다", () => {
  const random = seededRandom(31);
  // 노랑 자리와 파랑 자리가 섞여 있고, 입자도 노랑/파랑 절반씩.
  const makeColor = (yellow) =>
    yellow ? { r: 240, g: 210, b: 60 } : { r: 20, g: 40, b: 200 };
  const slots = Array.from({ length: 400 }, (_, i) => {
    const color = makeColor(i % 2 === 0);
    return { x: random(), y: random(), ...color, lum: luminance(color.r, color.g, color.b) };
  });
  const particles = Array.from({ length: 400 }, (_, i) => {
    const color = makeColor(i % 2 === 0);
    return { x: random(), y: random(), ...color, lum: luminance(color.r, color.g, color.b) };
  });

  // 일부러 아무렇게나 섞은 배정에서 시작한다.
  const assignment = Int32Array.from({ length: particles.length }, (_, i) => i);
  const shuffle = seededRandom(59);
  for (let i = assignment.length - 1; i > 0; i--) {
    const j = Math.floor(shuffle() * (i + 1));
    const temp = assignment[i];
    assignment[i] = assignment[j];
    assignment[j] = temp;
  }

  const before = meanColorMismatch(particles, slots, assignment);
  assert.ok(before > 0.05, `시작부터 색이 맞아 있으면 시험이 안 된다 (${before})`);

  improveAssignment(particles, slots, assignment, {
    iterations: 60000,
    random: seededRandom(37),
    colorWeight: 8,
  });
  const after = meanColorMismatch(particles, slots, assignment);
  assert.ok(after < before / 4, `색 오차가 충분히 안 줄었다 ${before} → ${after}`);
});

test("colorWeight를 켜도 총 비용은 늘지 않는다", () => {
  const random = seededRandom(47);
  const slots = buildTargetSlots(splitImage(24, 24), { maxSlots: 400 });
  const particles = Array.from({ length: 250 }, () => {
    const gray = Math.round(random() * 255);
    return { x: random(), y: random(), r: gray, g: gray, b: gray, lum: luminance(gray, gray, gray) };
  });
  const assignment = assignByLuminance(particles, slots);
  const options = { colorWeight: 3 };
  const before = transportCost(particles, slots, assignment, options);
  improveAssignment(particles, slots, assignment, {
    ...options,
    iterations: 5000,
    random: seededRandom(53),
  });
  assert.ok(transportCost(particles, slots, assignment, options) <= before + 1e-9);
});
