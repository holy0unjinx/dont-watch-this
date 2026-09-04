import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS,
  createParticle,
  stepParticles,
  applySeparation,
  settledRatio,
} from "../particle-flow.js";

function withTarget(particle, tx, ty, color = {}) {
  particle.tx = tx;
  particle.ty = ty;
  if (color.r !== undefined) {
    particle.tr = color.r;
    particle.tg = color.g;
    particle.tb = color.b;
  }
  return particle;
}

const distanceToTarget = (p) => Math.hypot(p.tx - p.x, p.ty - p.y);

test("입자는 배정된 자리로 다가간다", () => {
  const particle = withTarget(createParticle({ x: 0.1, y: 0.1, r: 0, g: 0, b: 0, lum: 0 }), 0.8, 0.7);
  const before = distanceToTarget(particle);
  for (let i = 0; i < 60; i++) stepParticles([particle], 1 / 60);
  assert.ok(distanceToTarget(particle) < before, "가까워지지 않았다");
});

test("결국 자리에 도착해 settled가 된다", () => {
  const particle = withTarget(
    createParticle({ x: 0.2, y: 0.9, r: 10, g: 10, b: 10, lum: 0.04 }),
    0.5,
    0.5
  );
  for (let i = 0; i < 1200; i++) stepParticles([particle], 1 / 60);
  assert.ok(particle.settled, `거리 ${distanceToTarget(particle)}`);
  assert.equal(settledRatio([particle]), 1);
});

test("색은 목표 색으로 물든다", () => {
  const particle = withTarget(
    createParticle({ x: 0.5, y: 0.5, r: 0, g: 0, b: 0, lum: 0 }),
    0.5,
    0.5,
    { r: 255, g: 128, b: 64 }
  );
  for (let i = 0; i < 120; i++) stepParticles([particle], 1 / 60);
  assert.ok(Math.abs(particle.r - 255) < 2, `r=${particle.r}`);
  assert.ok(Math.abs(particle.g - 128) < 2, `g=${particle.g}`);
  assert.ok(Math.abs(particle.b - 64) < 2, `b=${particle.b}`);
});

test("속도는 상한을 넘지 않는다", () => {
  const particle = withTarget(createParticle({ x: 0, y: 0, r: 0, g: 0, b: 0, lum: 0 }), 50, 50);
  for (let i = 0; i < 30; i++) stepParticles([particle], 1 / 60);
  assert.ok(Math.hypot(particle.vx, particle.vy) <= DEFAULTS.maxSpeed + 1e-9);
});

test("긴 프레임 간격에도 발산하지 않는다", () => {
  const particle = withTarget(createParticle({ x: 0.1, y: 0.2, r: 0, g: 0, b: 0, lum: 0 }), 0.9, 0.9);
  for (const dt of [0.016, 5, 60, 0.016]) stepParticles([particle], dt);
  assert.ok(Number.isFinite(particle.x) && Number.isFinite(particle.y), "좌표가 NaN");
  assert.ok(Math.hypot(particle.vx, particle.vy) <= DEFAULTS.maxSpeed + 1e-9);
});

test("dt가 0이면 아무 일도 없다", () => {
  const particle = withTarget(createParticle({ x: 0.3, y: 0.3, r: 0, g: 0, b: 0, lum: 0 }), 0.9, 0.9);
  const snapshot = { ...particle };
  stepParticles([particle], 0);
  assert.deepEqual({ ...particle }, snapshot);
});

test("겹친 입자는 서로 밀어낸다", () => {
  const a = createParticle({ x: 0.5, y: 0.5, r: 0, g: 0, b: 0, lum: 0 });
  const b = createParticle({ x: 0.5015, y: 0.5, r: 0, g: 0, b: 0, lum: 0 });
  applySeparation([a, b], { radius: 0.006, strength: 1, dt: 1 / 60 });
  assert.ok(a.vx < 0, `왼쪽 입자가 왼쪽으로 밀려야 한다 (vx=${a.vx})`);
  assert.ok(b.vx > 0, `오른쪽 입자가 오른쪽으로 밀려야 한다 (vx=${b.vx})`);
  assert.ok(Math.abs(a.vx + b.vx) < 1e-9, "밀어내는 힘은 대칭이어야 한다");
});

test("멀리 떨어진 입자는 서로를 밀지 않는다", () => {
  const a = createParticle({ x: 0.1, y: 0.1, r: 0, g: 0, b: 0, lum: 0 });
  const b = createParticle({ x: 0.9, y: 0.9, r: 0, g: 0, b: 0, lum: 0 });
  applySeparation([a, b], { radius: 0.006, strength: 1, dt: 1 / 60 });
  assert.equal(a.vx, 0);
  assert.equal(b.vy, 0);
});

test("같은 자리에 정확히 겹쳐 있어도 터지지 않는다", () => {
  const a = createParticle({ x: 0.5, y: 0.5, r: 0, g: 0, b: 0, lum: 0 });
  const b = createParticle({ x: 0.5, y: 0.5, r: 0, g: 0, b: 0, lum: 0 });
  applySeparation([a, b], { radius: 0.006, strength: 1, dt: 1 / 60 });
  assert.ok(Number.isFinite(a.vx) && Number.isFinite(b.vx));
});
