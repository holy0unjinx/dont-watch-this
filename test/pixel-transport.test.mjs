import test from "node:test";
import assert from "node:assert/strict";
import {
  luminance,
  buildTargetSlots,
  assignByLuminance,
  transportCost,
  improveAssignment,
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
