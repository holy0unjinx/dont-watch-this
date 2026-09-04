import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTargetSlots,
  assignByLuminance,
  improveAssignment,
  transportCost,
  luminance,
} from "../pixel-transport.js";
import { createParticle, stepParticles, applySeparation, settledRatio } from "../particle-flow.js";

// paint-app.js가 실제로 하는 순서 그대로 돌려본다: 사진에서 자리를 뽑고 →
// 배정하고 → 매 프레임 조금씩 개선하며 흘려보낸다.
function seededRandom(seed = 41) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 왼쪽 위가 어둡고 오른쪽 아래가 밝은 그러데이션 — 밝기 매칭이 자리를
// 실제로 갈라놓는지 보기 좋다.
function gradientImage(width = 60, height = 80) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const value = Math.round((255 * (x / width + y / height)) / 2);
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return { data, width, height };
}

test("그린 픽셀이 사진 자리로 모여 자리를 잡는다", () => {
  const random = seededRandom(5);
  const slots = buildTargetSlots(gradientImage(), { maxSlots: 3000 });
  assert.ok(slots.length > 500, `자리 ${slots.length}개`);

  // 캔버스 아무 데나 그은 획 흉내.
  const particles = Array.from({ length: 1500 }, () => {
    const gray = Math.round(random() * 255);
    return createParticle({
      x: random(),
      y: random() * 1.2,
      r: gray,
      g: gray,
      b: gray,
      lum: luminance(gray, gray, gray),
      phase: random() * Math.PI * 2,
    });
  });

  const assignment = assignByLuminance(particles, slots);
  const costBefore = transportCost(particles, slots, assignment);
  improveAssignment(particles, slots, assignment, { iterations: 30000, random: seededRandom(9) });
  const costAfter = transportCost(particles, slots, assignment);
  assert.ok(costAfter < costBefore, `개선이 없었다 ${costBefore} → ${costAfter}`);

  // 배정 결과를 목표 좌표/색으로 옮긴다(그림판이 하는 일과 같다).
  for (let i = 0; i < particles.length; i++) {
    const slot = slots[assignment[i]];
    particles[i].tx = slot.x;
    particles[i].ty = slot.y;
    particles[i].tr = slot.r;
    particles[i].tg = slot.g;
    particles[i].tb = slot.b;
  }

  for (let frame = 0; frame < 900; frame++) {
    applySeparation(particles, { dt: 1 / 60 });
    stepParticles(particles, 1 / 60);
  }

  for (const particle of particles) {
    assert.ok(Number.isFinite(particle.x) && Number.isFinite(particle.y), "좌표가 NaN");
  }

  const meanDistance =
    particles.reduce((sum, p) => sum + Math.hypot(p.tx - p.x, p.ty - p.y), 0) / particles.length;
  assert.ok(meanDistance < 0.02, `평균 거리 ${meanDistance}`);
  assert.ok(settledRatio(particles) > 0.8, `자리 잡은 비율 ${settledRatio(particles)}`);

  // 색도 목표를 따라갔는지 — 그림이 사진 색으로 물들어야 한다.
  const meanColorError =
    particles.reduce((sum, p) => sum + Math.abs(p.r - p.tr), 0) / particles.length;
  assert.ok(meanColorError < 6, `평균 색 오차 ${meanColorError}`);
});

test("어두운 획은 어두운 쪽, 밝은 획은 밝은 쪽에 자리 잡는다", () => {
  const slots = buildTargetSlots(gradientImage(), { maxSlots: 2000 });
  const particles = [
    createParticle({ x: 0.5, y: 0.5, r: 8, g: 8, b: 8, lum: luminance(8, 8, 8) }),
    createParticle({ x: 0.5, y: 0.5, r: 247, g: 247, b: 247, lum: luminance(247, 247, 247) }),
  ];
  const assignment = assignByLuminance(particles, slots);
  assert.ok(slots[assignment[0]].lum < slots[assignment[1]].lum, "밝기 순서가 뒤집혔다");
});
