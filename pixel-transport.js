// 그린 픽셀을 목표 사진의 픽셀 자리로 "옮겨 담는" 문제를 푼다.
// 완전한 할당 문제(헝가리안)는 O(n^3)이라 수천 개 입자에는 못 쓴다. 대신
//   1) 밝기 순위로 1차 매칭(밝은 픽셀은 밝은 자리로) — O(n log n)
//   2) 무작위 두 쌍을 골라 서로 바꿔보고 총 이동 비용이 줄 때만 채택
// 이렇게 근사한다. 2번은 비용이 절대 늘지 않으므로 오래 돌릴수록 좋아진다.
//
// DOM도 캔버스도 모르는 순수 계층이라 node에서 그대로 테스트한다.
// 좌표는 0~1로 정규화해서 캔버스 크기와 무관하게 다룬다.

export function luminance(r, g, b) {
  // 사람 눈 기준 밝기(Rec. 601). 회색조 매칭의 기준값.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// 목표 이미지에서 자리 목록을 만든다. 픽셀을 전부 쓰면 너무 많아서 격자로
// 솎아내고, 투명한 부분은 건너뛴다.
export function buildTargetSlots(
  { data, width, height },
  { maxSlots = 6000, alphaThreshold = 8, maxLuminance = 1 } = {}
) {
  const total = width * height;
  const step = Math.max(1, Math.round(Math.sqrt(total / Math.max(1, maxSlots))));
  const slots = [];

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const index = (y * width + x) * 4;
      if (data[index + 3] < alphaThreshold) continue;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const lum = luminance(r, g, b);
      // 흰 배경처럼 밝기만 높은 부분은 자리에서 빼서, 사진이 네모난 덩어리가
      // 아니라 피사체 모양으로 드러나게 한다.
      if (lum > maxLuminance) continue;
      slots.push({
        // 이미지 중앙을 원점(0.5, 0.5)으로 하는 0~1 좌표.
        x: (x + 0.5) / width,
        y: (y + 0.5) / height,
        r,
        g,
        b,
        lum,
      });
    }
  }
  return slots;
}

// 입자 수가 자리 수보다 많으면 자리를 돌려쓰고(여러 입자가 같은 자리),
// 적으면 앞에서부터 필요한 만큼만 쓴다.
function slotIndexFor(rank, slotCount) {
  return slotCount === 0 ? -1 : rank % slotCount;
}

// 1차 매칭: 양쪽을 밝기로 정렬해 같은 순위끼리 잇는다. 어두운 획은 어두운
// 부분으로, 밝은 획은 밝은 부분으로 간다.
export function assignByLuminance(particles, slots) {
  const assignment = new Int32Array(particles.length).fill(-1);
  if (slots.length === 0 || particles.length === 0) return assignment;

  const particleOrder = particles
    .map((particle, index) => ({ index, lum: particle.lum }))
    .sort((a, b) => a.lum - b.lum || a.index - b.index);
  const slotOrder = slots
    .map((slot, index) => ({ index, lum: slot.lum }))
    .sort((a, b) => a.lum - b.lum || a.index - b.index);

  for (let rank = 0; rank < particleOrder.length; rank++) {
    // 입자가 더 많을 때도 밝기 순서가 유지되도록 비율로 대응시킨다.
    const scaled = Math.floor((rank * slotOrder.length) / particleOrder.length);
    assignment[particleOrder[rank].index] = slotOrder[slotIndexFor(scaled, slotOrder.length)].index;
  }
  return assignment;
}

function pairCost(particle, slot) {
  const dx = particle.x - slot.x;
  const dy = particle.y - slot.y;
  return dx * dx + dy * dy;
}

// 총 이동 비용(거리 제곱 합). 작을수록 픽셀이 덜 움직인다.
export function transportCost(particles, slots, assignment) {
  let total = 0;
  for (let i = 0; i < particles.length; i++) {
    const slot = slots[assignment[i]];
    if (!slot) continue;
    total += pairCost(particles[i], slot);
  }
  return total;
}

// 무작위 두 입자의 목적지를 맞바꿔 보고, 총 비용이 줄어들 때만 채택한다.
// 비용이 늘어나는 교환은 절대 받지 않으므로 호출할수록 단조롭게 좋아진다.
export function improveAssignment(particles, slots, assignment, { iterations = 4000, random = Math.random } = {}) {
  const count = particles.length;
  if (count < 2 || slots.length === 0) return assignment;

  for (let step = 0; step < iterations; step++) {
    const a = Math.floor(random() * count);
    const b = Math.floor(random() * count);
    if (a === b) continue;

    const slotA = slots[assignment[a]];
    const slotB = slots[assignment[b]];
    if (!slotA || !slotB) continue;

    const before = pairCost(particles[a], slotA) + pairCost(particles[b], slotB);
    const after = pairCost(particles[a], slotB) + pairCost(particles[b], slotA);
    if (after < before) {
      const temp = assignment[a];
      assignment[a] = assignment[b];
      assignment[b] = temp;
    }
  }
  return assignment;
}
