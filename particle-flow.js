// 배정된 자리로 픽셀이 "흘러가는" 움직임. 한 번에 순간이동시키지 않고
// 용수철(목표로 당김) + 감쇠 + 소용돌이 + 이웃 밀어내기를 섞어서 물처럼
// 모여들게 한다. DOM을 모르는 순수 계층이라 node에서 테스트한다.

export const DEFAULTS = {
  stiffness: 9,
  damping: 0.86,
  maxSpeed: 2.4,
  swirl: 1.6,
  arriveDistance: 0.0025,
  arriveSpeed: 0.02,
  colorBlend: 3.5,
};

export function createParticle({ x, y, r, g, b, lum, phase = 0 }) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    r,
    g,
    b,
    lum,
    // 목표 자리와 목표 색. 배정 전에는 제자리를 목표로 둔다.
    tx: x,
    ty: y,
    tr: r,
    tg: g,
    tb: b,
    phase,
    settled: false,
  };
}

function approach(current, target, rate) {
  return current + (target - current) * rate;
}

// 한 스텝 진행. dt가 너무 크면(탭 복귀 등) 용수철이 발산하므로 잘라낸다.
export function stepParticles(particles, dt, options = {}) {
  const { stiffness, damping, maxSpeed, swirl, arriveDistance, arriveSpeed, colorBlend } = {
    ...DEFAULTS,
    ...options,
  };
  const step = Math.min(Math.max(dt, 0), 1 / 30);
  if (step === 0) return particles;

  // 감쇠를 프레임 수가 아니라 시간에 맞춰 적용해야 기기마다 같게 움직인다.
  const damp = Math.pow(damping, step * 60);

  for (const particle of particles) {
    const dx = particle.tx - particle.x;
    const dy = particle.ty - particle.y;
    const distance = Math.hypot(dx, dy);

    // 목표로 당기는 힘 + 목표 주위를 살짝 감아 도는 힘(멀수록 크게).
    const swirlScale = swirl * Math.min(distance, 0.4) * Math.sin(particle.phase);
    particle.vx += (dx * stiffness - dy * swirlScale) * step;
    particle.vy += (dy * stiffness + dx * swirlScale) * step;

    particle.vx *= damp;
    particle.vy *= damp;

    const speed = Math.hypot(particle.vx, particle.vy);
    if (speed > maxSpeed) {
      particle.vx = (particle.vx / speed) * maxSpeed;
      particle.vy = (particle.vy / speed) * maxSpeed;
    }

    particle.x += particle.vx * step;
    particle.y += particle.vy * step;

    // 자리에 가까워질수록 목표 색으로 물든다 — 그림이 서서히 사진이 된다.
    const blend = Math.min(1, colorBlend * step);
    particle.r = approach(particle.r, particle.tr, blend);
    particle.g = approach(particle.g, particle.tg, blend);
    particle.b = approach(particle.b, particle.tb, blend);

    particle.settled = distance < arriveDistance && Math.hypot(particle.vx, particle.vy) < arriveSpeed;
  }
  return particles;
}

// 같은 칸에 몰린 입자들을 서로 밀어낸다. 격자로 이웃만 보기 때문에 입자 수에
// 비례하는 비용으로 끝난다. 이게 "유체처럼 퍼지는" 느낌을 만든다.
export function applySeparation(particles, { radius = 0.006, strength = 0.6, dt = 1 / 60 } = {}) {
  if (particles.length < 2 || radius <= 0) return particles;

  const cellSize = radius;
  const grid = new Map();
  const keyOf = (x, y) => `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;

  for (const particle of particles) {
    const key = keyOf(particle.x, particle.y);
    let bucket = grid.get(key);
    if (!bucket) grid.set(key, (bucket = []));
    bucket.push(particle);
  }

  const radiusSquared = radius * radius;
  for (const particle of particles) {
    const cellX = Math.floor(particle.x / cellSize);
    const cellY = Math.floor(particle.y / cellSize);

    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const bucket = grid.get(`${cellX + ox}:${cellY + oy}`);
        if (!bucket) continue;
        for (const other of bucket) {
          if (other === particle) continue;
          const dx = particle.x - other.x;
          const dy = particle.y - other.y;
          const distanceSquared = dx * dx + dy * dy;
          if (distanceSquared >= radiusSquared || distanceSquared === 0) continue;
          const distance = Math.sqrt(distanceSquared);
          const push = ((radius - distance) / radius) * strength * dt;
          particle.vx += (dx / distance) * push;
          particle.vy += (dy / distance) * push;
        }
      }
    }
  }
  return particles;
}

export function settledRatio(particles) {
  if (particles.length === 0) return 1;
  let settled = 0;
  for (const particle of particles) if (particle.settled) settled++;
  return settled / particles.length;
}
