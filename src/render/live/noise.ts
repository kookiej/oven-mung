// 3D simplex 노이즈 (Stefan Gustavson의 공개 구현을 줄인 것) — 실시간 반죽 메시의 울퉁불퉁함.
// Blender 빌더(render_cartoon.py의 pn)와 값이 같지는 않지만 결이 비슷한 부드러운 노이즈다.

const GRAD = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];
const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  // 고정 시드 섞기 — 실행할 때마다 같은 결
  let s = 1234567;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

const F3 = 1 / 3;
const G3 = 1 / 6;

/** -1 ~ 1 */
export function noise3(x: number, y: number, z: number): number {
  const s = (x + y + z) * F3;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const k = Math.floor(z + s);
  const t = (i + j + k) * G3;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const z0 = z - (k - t);
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
    else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
  } else if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
  else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
  else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
  const corners: [number, number, number, number, number, number][] = [
    [x0, y0, z0, 0, 0, 0],
    [x0 - i1 + G3, y0 - j1 + G3, z0 - k1 + G3, i1, j1, k1],
    [x0 - i2 + 2 * G3, y0 - j2 + 2 * G3, z0 - k2 + 2 * G3, i2, j2, k2],
    [x0 - 1 + 3 * G3, y0 - 1 + 3 * G3, z0 - 1 + 3 * G3, 1, 1, 1],
  ];
  const ii = i & 255;
  const jj = j & 255;
  const kk = k & 255;
  let n = 0;
  for (const [cx, cy, cz, di, dj, dk] of corners) {
    let tt = 0.6 - cx * cx - cy * cy - cz * cz;
    if (tt < 0) continue;
    const g = GRAD[PERM[ii + di + PERM[jj + dj + PERM[kk + dk]]] % 12];
    tt *= tt;
    n += tt * tt * (g[0] * cx + g[1] * cy + g[2] * cz);
  }
  return 32 * n;
}
