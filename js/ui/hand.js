// A pitch-black, long-fingered hand. Shared shape + timing so it can be drawn
// at any angle (it reaches in diagonally from a corner of the forage screen).

export const HAND_W = 26;
export const HAND_H = 12;

const rand = (a, b) => a + Math.random() * (b - a);

/** The hand as a pixel grid, reaching to the right: x = 0 is the forearm, x = 25 the fingertips. */
export function handGrid(curled) {
  const grid = Array.from({ length: HAND_H }, () => new Array(HAND_W).fill(0));
  const set = (x, y) => { if (x >= 0 && y >= 0 && x < HAND_W && y < HAND_H) grid[y][x] = 1; };
  const line = (pts) => {
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i];
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 || 1;
      for (let k = 0; k <= n; k++) set(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n));
    }
  };
  // forearm (tapering) and palm
  for (let x = 0; x <= 9; x++) for (let y = 4; y <= (x < 6 ? 8 : 7); y++) set(x, y);
  for (let x = 9; x <= 13; x++) for (let y = 3; y <= 8; y++) set(x, y);
  const fingers = curled
    ? [
      [[11, 3], [14, 2], [15, 3]], // thumb
      [[13, 3], [17, 2], [18, 4], [16, 5]],
      [[13, 5], [17, 5], [17, 7], [15, 7]],
      [[13, 6], [16, 7], [16, 9], [14, 9]],
      [[13, 8], [15, 9], [14, 10]],
    ]
    : [
      [[11, 3], [14, 1], [17, 1], [18, 2]],
      [[13, 3], [19, 2], [23, 4], [24, 6]],
      [[13, 5], [20, 4], [24, 7], [24, 9]],
      [[13, 6], [19, 6], [22, 9], [22, 11]],
      [[13, 8], [17, 8], [19, 10], [19, 11]],
    ];
  for (const f of fingers) line(f);
  return grid;
}

/** Timing for one appearance: creep in, rest (with a finger twitch), then snatched back. */
export function newHandVisit() {
  const creep = rand(1.4, 2.2);
  const hold = rand(1.2, 2.8);
  return {
    t: 0, creep, hold, retract: 0.3,
    reach: rand(16, 19), // how far the fingertips come in past the corner, in native pixels
    twitch: creep + rand(0.3, Math.max(0.4, hold - 0.4)),
    end: creep + hold + 0.3,
  };
}

/** How far in the fingertips are right now, and which pose. */
export function handFrame(h) {
  if (h.t < h.creep) {
    const k = h.t / h.creep;
    return { reveal: h.reach * (1 - (1 - k) ** 2), curled: false }; // slow creep, easing to a stop
  }
  if (h.t < h.creep + h.hold) {
    return { reveal: h.reach, curled: h.t > h.twitch && h.t < h.twitch + 0.16 };
  }
  const k = Math.min(1, (h.t - h.creep - h.hold) / h.retract);
  return { reveal: h.reach * (1 - k * k) - 4 * k * k, curled: true }; // snatched back, accelerating
}
