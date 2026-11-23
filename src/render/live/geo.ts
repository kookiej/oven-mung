// 실시간 반죽 지오메트리 — renders/blender_cartoon/render_game.py·render_cartoon.py의 빌더를 three.js로 옮긴 것.
// 매 프레임(진행도가 바뀔 때) 다시 만들 수 있을 만큼 가볍게 — 덩어리, 줄(공 → 가래떡 → 고리·매듭),
// 별 모양 판(밀어 편 반죽), 그릇 속에 고인 반죽(벽을 타고 오르는 메니스커스).
// 좌표는 three.js(Y 위, 미터). 바닥 평면의 점은 [x, z]로 쓴다 — 화면 앞쪽이 +z.
import * as THREE from 'three';
import { noise3 } from './noise';

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** 정점 i의 노멀이 outward 쪽을 보도록 — 반대면 모든 삼각형을 뒤집는다 (감는 방향 실수에 안전하게) */
function faceOutward(g: THREE.BufferGeometry, i: number, outward: THREE.Vector3): void {
  g.computeVertexNormals();
  const n = new THREE.Vector3().fromBufferAttribute(g.getAttribute('normal') as THREE.BufferAttribute, i);
  if (n.dot(outward) >= 0) return;
  const idx = g.getIndex()!;
  const a = idx.array as Uint16Array | Uint32Array;
  for (let k = 0; k < a.length; k += 3) {
    const t = a[k + 1];
    a[k + 1] = a[k + 2];
    a[k + 2] = t;
  }
  idx.needsUpdate = true;
  g.computeVertexNormals();
}

// ---------------------------------------------------------------- 덩어리
/**
 * 반죽 덩어리 — 거침(rough) 0(매끈) ~ 1(덜 섞여 울퉁불퉁 + 밀가루 얼룩), 밑면은 바닥에 눌려 평평하다.
 * 정점 방향·노이즈를 미리 계산해 두고 update로 반지름·거침만 바꾼다(매 프레임 가능)
 */
export class Blob {
  readonly geometry: THREE.BufferGeometry;
  private dirs: Float32Array;
  private n1: Float32Array;
  private n2: Float32Array;
  private n0: Float32Array;
  private flourN: Float32Array;

  constructor(seed = 1.3, wseg = 48, hseg = 32) {
    const sphere = new THREE.SphereGeometry(1, wseg, hseg);
    this.geometry = sphere;
    const pos = sphere.getAttribute('position') as THREE.BufferAttribute;
    const n = pos.count;
    this.dirs = new Float32Array(pos.array as Float32Array);
    this.n1 = new Float32Array(n);
    this.n2 = new Float32Array(n);
    this.n0 = new Float32Array(n);
    this.flourN = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = this.dirs[i * 3];
      const y = this.dirs[i * 3 + 1];
      const z = this.dirs[i * 3 + 2];
      this.n1[i] = noise3(x * 2.4 + seed, y * 2.4, z * 2.4);
      this.n2[i] = noise3(x * 6 + seed + 3, y * 6, z * 6);
      this.n0[i] = noise3(x * 1.8 + seed, y * 1.8, z * 1.8);
      this.flourN[i] = noise3(x * 3.5 + 7, y * 3.5, z * 3.5 + seed);
    }
    sphere.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  }

  /**
   * R = [가로, 높이, 깊이] 반지름. 밑면은 높이의 flat배 아래에서 눌린다. 원점은 덩어리 바닥 가운데.
   * rot을 주면 결(울퉁불퉁함·밀가루 얼룩)이 그만큼 굴러간 채로 — 밑면은 늘 바닥에 붙어 있다
   */
  update(
    R: [number, number, number],
    rough: number,
    flat = 0.55,
    flour = 0,
    rot?: THREE.Quaternion,
    /** 바닥 평면의 방향 (dx, dz)으로 s배 늘이고 높이는 sy배 — 움직이는 반죽이 늘어나는 모습 */
    stretch?: { dx: number; dz: number; s: number; sy: number },
  ): void {
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const c = col.array as Float32Array;
    const lift = R[1] * flat;
    const d = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const k = 1 + rough * (0.17 * this.n1[i] + 0.06 * this.n2[i]) + (1 - rough) * 0.02 * this.n0[i];
      d.set(this.dirs[i * 3], this.dirs[i * 3 + 1], this.dirs[i * 3 + 2]);
      if (rot) d.applyQuaternion(rot);
      const x = d.x * R[0] * k;
      let y = d.y * R[1] * k;
      const z = d.z * R[2] * k;
      if (y < -lift) y = -lift + (y + lift) * 0.06;
      let sx = x;
      let sz = z;
      let sy = y + lift;
      if (stretch) {
        const along = x * stretch.dx + z * stretch.dz;
        sx += along * (stretch.s - 1) * stretch.dx;
        sz += along * (stretch.s - 1) * stretch.dz;
        sy *= stretch.sy;
      }
      a[i * 3] = sx;
      a[i * 3 + 1] = sy;
      a[i * 3 + 2] = sz;
      // 밀가루 얼룩 — 덜 섞인 반죽에만 하얗게
      const f = flour * smooth(0.25, 0.45, this.flourN[i]);
      c[i * 3] = 1 + f * 0.12;
      c[i * 3 + 1] = 1 + f * 0.16;
      c[i * 3 + 2] = 1 + f * 0.22;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }
}

// ---------------------------------------------------------------- 줄
export type RopePt = [number, number, number]; // x, z, 반지름

/**
 * 반죽 줄 — 바닥 평면 위의 중심선(pts)을 따라가는 관. 밑은 바닥(baseY)에 눌려 평평하고,
 * 열린 줄의 양 끝은 반구처럼 둥글게 오므린다. lift[i]만큼 들어 올리면 겹친 매듭의 위쪽 팔이 된다
 */
export function ropeGeometry(
  pts: readonly RopePt[],
  baseY: number,
  opts: {
    closed?: boolean;
    lift?: readonly number[];
    nseg?: number;
    disp?: (i: number, th: number, p: THREE.Vector3, radial: THREE.Vector3) => number;
    /** 자리 i의 단면 배율 [옆, 위아래] — 눌러 납작해진 끝처럼 */
    section?: (i: number) => [number, number];
    /** 열린 줄의 끝을 둥글게 오므린 정도 — 1 반구(기본), 0 잘린 그대로의 납작한 끝 */
    capRound?: number;
    /** 마지막 끝만 따로 오므린 정도 (없으면 capRound) — 다른 끝을 감싸는 소매처럼 덜 오므린 끝 */
    capRoundEnd?: number;
  } = {},
): THREE.BufferGeometry {
  const { closed = false, lift, nseg = 28, disp, section, capRound = 1, capRoundEnd } = opts;
  const M = pts.length;
  const C = pts.map(([x, z, r], i) => new THREE.Vector3(x, baseY + r * 0.78 * (section ? section(i)[1] : 1) + (lift ? lift[i] : 0), z));
  const R = pts.map((p) => p[2]);
  if (!closed) {
    const d = [0];
    for (let i = 1; i < M; i++) d.push(d[i - 1] + C[i].distanceTo(C[i - 1]));
    const L = d[M - 1];
    for (let i = 0; i < M; i++) {
      const e = Math.min(d[i], L - d[i]);
      if (e < R[i]) {
        const round = R[i] * Math.sqrt(Math.max(0, 1 - ((R[i] - e) / R[i]) ** 2)) + 0.0004;
        // 잘린 끝 — 맨 끝 한 줄만 오므려 마개가 된다
        const cut = e < 1e-6 ? R[i] * 0.55 : R[i];
        const k = capRoundEnd !== undefined && d[i] > L / 2 ? capRoundEnd : capRound;
        R[i] = cut + (round - cut) * k;
      }
    }
  }
  const up = new THREE.Vector3(0, 1, 0);
  const V: number[] = [];
  const T = new THREE.Vector3();
  const side = new THREE.Vector3();
  const upv = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const P = new THREE.Vector3();
  for (let i = 0; i < M; i++) {
    if (closed) T.subVectors(C[(i + 1) % M], C[(i - 1 + M) % M]);
    else T.subVectors(C[Math.min(i + 1, M - 1)], C[Math.max(i - 1, 0)]);
    if (T.lengthSq() < 1e-12) T.set(1, 0, 0);
    T.normalize();
    side.crossVectors(T, up);
    if (side.lengthSq() < 1e-9) side.set(0, 0, 1);
    side.normalize();
    upv.crossVectors(side, T).normalize();
    const [sx, sy] = section ? section(i) : [1, 1];
    for (let k = 0; k < nseg; k++) {
      const th = (2 * Math.PI * k) / nseg;
      radial.copy(side).multiplyScalar(Math.cos(th) * sx).addScaledVector(upv, Math.sin(th) * 0.92 * sy);
      P.copy(C[i]).addScaledVector(radial, R[i]);
      if (disp) P.addScaledVector(radial.normalize(), disp(i, th, P, radial));
      if (P.y < baseY) P.y = baseY + (P.y - baseY) * 0.04;
      V.push(P.x, P.y, P.z);
    }
  }
  const idx: number[] = [];
  const rows = closed ? M : M - 1;
  for (let i = 0; i < rows; i++) {
    const i2 = (i + 1) % M;
    for (let k = 0; k < nseg; k++) {
      const k2 = (k + 1) % nseg;
      const a = i * nseg + k;
      const b = i2 * nseg + k;
      const c = i2 * nseg + k2;
      const d = i * nseg + k2;
      idx.push(a, b, c, a, c, d);
    }
  }
  if (!closed) {
    // 양 끝 마개
    for (const [ci, ring, rev] of [
      [0, 0, true],
      [M - 1, (M - 1) * nseg, false],
    ] as [number, number, boolean][]) {
      const c = V.length / 3;
      V.push(C[ci].x, Math.max(C[ci].y, baseY), C[ci].z);
      for (let k = 0; k < nseg; k++) {
        const a = ring + k;
        const b = ring + ((k + 1) % nseg);
        if (rev) idx.push(c, b, a);
        else idx.push(c, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  g.setIndex(idx);
  // 가운데 줄의 위쪽 정점은 위(바깥)를 봐야 한다
  const mid = Math.floor(M / 2) * nseg + Math.round(nseg / 4);
  faceOutward(g, mid, new THREE.Vector3(V[mid * 3] - C[Math.floor(M / 2)].x, V[mid * 3 + 1] - C[Math.floor(M / 2)].y, V[mid * 3 + 2] - C[Math.floor(M / 2)].z));
  return g;
}

/** 길이 L을 phi만큼 앞쪽으로 휜 줄의 중심선 — 0 곧은 줄, π U자, 2π 고리. 양 끝이 뒤(-z)로 올라간다 */
export function bent(L: number, phi: number, r: (u: number) => number, n = 72, cx = 0, cz = 0): RopePt[] {
  const out: RopePt[] = [];
  if (phi < 1e-3) {
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      out.push([cx + (u - 0.5) * L, cz, r(u)]);
    }
    return out;
  }
  const rho = L / phi;
  const height = phi <= Math.PI ? rho * (1 - Math.cos(phi / 2)) : 2 * rho;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const a = (u - 0.5) * phi;
    out.push([cx + rho * Math.sin(a), cz + height / 2 - rho * (1 - Math.cos(a)), r(u)]);
  }
  return out;
}

// ---------------------------------------------------------------- 접은 판
/** 단면의 닫힌 외곽 (z, y) — 접은 반죽을 x로 밀어 낸다. 양 끝은 둥글게 오므린다. 같은 점 수끼리 섞으면 모양이 이어진다 */
export function extrudeOutline(
  hx: number,
  outline: readonly [number, number][],
  baseY: number,
  nx = 36,
  /** 외곽 점마다의 반폭 — 타원으로 민 판처럼 자리마다 폭이 다를 때 (없으면 모두 hx) */
  widths?: readonly number[],
): THREE.BufferGeometry {
  const M = outline.length;
  let cz = 0;
  let cy = 0;
  for (const [z, y] of outline) {
    cz += z / M;
    cy += y / M;
  }
  const V: number[] = [];
  for (let i = 0; i <= nx; i++) {
    const u = (i / nx) * 2 - 1;
    const s = (1 - Math.abs(u) ** 12) ** 0.3;
    outline.forEach(([z, y], k) => V.push(u * (widths ? widths[k] : hx), Math.max(baseY, cy + (y - cy) * s), cz + (z - cz) * s));
  }
  const idx: number[] = [];
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < M; k++) {
      const k2 = (k + 1) % M;
      const a = i * M + k;
      const b = (i + 1) * M + k;
      const c = (i + 1) * M + k2;
      const d = i * M + k2;
      // 외곽은 윗면을 +z로 지나 아랫면으로 돌아오는 방향으로 고정이다 — 접혀서 겹쳐도 면 방향이 뒤집히지 않는다
      idx.push(a, c, b, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 휘어진 판의 한 줄 — 단면 중심선 위의 점(z, y), 윗면 쪽 노멀(nz, ny), 반두께 h, 반폭 w(x 방향), x 가운데 cx */
export interface SheetSample {
  z: number;
  y: number;
  nz: number;
  ny: number;
  h: number;
  w: number;
  cx?: number;
}

/**
 * 휘어지거나 말린 판 — 단면 중심선을 따라 놓인 줄(samples)마다 폭 w로 x 방향에 펼친다. 가장자리(x)는 둥글게 닫히고,
 * 양 끝 줄은 h를 0으로 주면 저절로 닫힌다. 돌돌 마는 반죽(나선)처럼 중심선이 감겨도 윗면·아랫면이 뒤집히지 않는다
 */
export function sheetGeometry(samples: readonly SheetSample[], baseY: number, nu = 22, E = 6): THREE.BufferGeometry {
  const N = samples.length;
  // 가장자리 쪽으로 촘촘한 x 자리 — 둥근 가장자리가 각지지 않게
  const us: number[] = [];
  for (let j = 0; j <= nu; j++) us.push(Math.sin((Math.PI / 2) * (-1 + (2 * j) / nu)));
  const ring: [number, number][] = [];
  for (let j = 0; j <= nu; j++) ring.push([us[j], 1]);
  for (let j = nu - 1; j >= 1; j--) ring.push([us[j], -1]);
  const R = ring.length;
  const V: number[] = [];
  for (const s of samples) {
    for (const [u, side] of ring) {
      const off = side * s.h * Math.pow(Math.max(0, 1 - Math.abs(u) ** E), 1 / E);
      let y = s.y + s.ny * off;
      if (y < baseY) y = baseY + (y - baseY) * 0.04;
      V.push((s.cx ?? 0) + u * s.w, y, s.z + s.nz * off);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < R; j++) {
      const j2 = (j + 1) % R;
      const a = i * R + j;
      const b = (i + 1) * R + j;
      const c = (i + 1) * R + j2;
      const d = i * R + j2;
      // 윗면: j가 +x, i가 중심선을 따라 — (b - a) × (c - a)가 윗면 노멀
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- 판
/**
 * 별 모양 판 — 밀어 편 반죽. R(θ) = 가운데에서 가장자리까지. 가장자리는 위아래 모두 둥글다 — 윗면은 가장자리로 갈수록 내려오고,
 * 아랫면은 가운데가 판에 닿아 평평하다가 가장자리에서 둥글게 말려 올라가 윗면과 만난다(사용자 요청: 아랫면 가장자리도 윗면처럼 둥글고 매끈하게)
 */
export function slabGeometry(
  cx: number,
  cz: number,
  R: (a: number) => number,
  H: number,
  baseY: number,
  bumps?: (x: number, z: number) => number,
  nt = 96,
  nr = 20,
  ek = 6,
): THREE.BufferGeometry {
  // 가장자리가 만나는 높이 — 얇은 판은 두께의 가운데, 두툼한 덩이는 밑동 근처
  const c = Math.min(H * 0.5, 0.0035);
  // 아랫면이 둥글게 말려 올라가기 시작하는 자리(지수가 클수록 가장자리 가까이에서만)
  const ekB = 18;
  // 가장자리 쪽 고리를 촘촘하게 — 둥근 테가 각지지 않게
  const rhoOf = (j: number) => 1 - (1 - j / nr) ** 1.6;
  const V: number[] = [cx, baseY + H + (bumps ? bumps(cx, cz) : 0), cz];
  for (let j = 1; j <= nr; j++) {
    const rho = rhoOf(j);
    for (let i = 0; i < nt; i++) {
      const a = (2 * Math.PI * i) / nt;
      const rr = R(a) * rho;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      let h = c + (H - c) * Math.sqrt(Math.max(0, 1 - rho ** ek));
      if (bumps) h += bumps(x, z) * (1 - rho ** 8);
      V.push(x, baseY + h, z);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < nt; i++) idx.push(0, 1 + i, 1 + ((i + 1) % nt));
  for (let j = 0; j < nr - 1; j++) {
    for (let i = 0; i < nt; i++) {
      const a0 = 1 + j * nt + i;
      const a1 = 1 + j * nt + ((i + 1) % nt);
      const b0 = a0 + nt;
      const b1 = a1 + nt;
      idx.push(a0, b0, b1, a0, b1, a1);
    }
  }
  // 아랫면 — 가장자리 고리(rho = 1)를 윗면과 같이 쓰고 안쪽으로 내려가 판에 닿는다. 가장자리에서 둘 다 옆을 보니 매끈하게 이어진다
  const top0 = 1 + (nr - 1) * nt;
  const bc = V.length / 3;
  V.push(cx, baseY - 0.0002, cz);
  const bStart = V.length / 3;
  for (let j = nr - 1; j >= 1; j--) {
    const rho = rhoOf(j);
    for (let i = 0; i < nt; i++) {
      const a = (2 * Math.PI * i) / nt;
      const rr = R(a) * rho;
      const y = baseY - 0.0002 + (c + 0.0002) * (1 - Math.sqrt(Math.max(0, 1 - rho ** ekB)));
      V.push(cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr);
    }
  }
  // 바깥(가장자리 고리) → 안쪽 고리들 → 가운데
  const ring = (k: number) => (k === 0 ? top0 : bStart + (k - 1) * nt);
  for (let k = 0; k < nr - 1; k++) {
    const o = ring(k);
    const n = ring(k + 1);
    for (let i = 0; i < nt; i++) {
      const i2 = (i + 1) % nt;
      idx.push(o + i, o + i2, n + i2, o + i, n + i2, n + i);
    }
  }
  const last = ring(nr - 1);
  for (let i = 0; i < nt; i++) idx.push(bc, last + ((i + 1) % nt), last + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  g.setIndex(idx);
  faceOutward(g, 0, new THREE.Vector3(0, 1, 0)); // 가운데 꼭대기는 위를 본다
  return g;
}

/** 다각형 외곽(가운데 기준) → 반지름 함수. 모서리는 이웃 각도의 평균으로 둥글게 */
export function polyRadius(poly: readonly [number, number][], win = 0.14, n = 180): (a: number) => number {
  const ray = (a: number) => {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = 1e9;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const ex = x2 - x1;
      const ey = y2 - y1;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = (x1 * ey - y1 * ex) / den;
      const u = (x1 * dy - y1 * dx) / den;
      if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
    }
    return best === 1e9 ? 0 : best;
  };
  const raw = Array.from({ length: n }, (_, k) => ray((2 * Math.PI * k) / n));
  const w = Math.max(1, Math.round(win / ((2 * Math.PI) / n)));
  const sm = raw.map((_, k) => {
    let s = 0;
    for (let d = -w; d <= w; d++) s += raw[(k + d + n) % n];
    return s / (2 * w + 1);
  });
  return (a: number) => {
    const f = ((((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)) * n;
    const k = Math.floor(f) % n;
    const t = f - Math.floor(f);
    return sm[k] * (1 - t) + sm[(k + 1) % n] * t;
  };
}

// ---------------------------------------------------------------- 그릇 속에 고인 반죽
export type WallTable = readonly [number, number][]; // [높이, 반지름] 바닥 → 위

export function wallAt(wall: WallTable, y: number): number {
  if (y <= wall[0][0]) return wall[0][1];
  for (let i = 0; i < wall.length - 1; i++) {
    const [y0, r0] = wall[i];
    const [y1, r1] = wall[i + 1];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return wall[wall.length - 1][1];
}

/** 높이 y까지의 부피 (원형 단면, 안쪽 벽이 있으면 고리) */
export function volumeTo(wall: WallTable, y: number, inner?: WallTable, steps = 40): number {
  const y0 = wall[0][0];
  if (y <= y0) return 0;
  let v = 0;
  const dy = (y - y0) / steps;
  for (let i = 0; i < steps; i++) {
    const yy = y0 + (i + 0.5) * dy;
    const ro = wallAt(wall, yy);
    const ri = inner ? wallAt(inner, yy) : 0;
    v += Math.PI * (ro * ro - ri * ri) * dy;
  }
  return v;
}

/** 부피 vol을 담았을 때의 높이 */
export function levelFor(wall: WallTable, vol: number, inner?: WallTable): number {
  let lo = wall[0][0];
  let hi = wall[wall.length - 1][0];
  for (let k = 0; k < 30; k++) {
    const m = (lo + hi) / 2;
    if (volumeTo(wall, m, inner) < vol) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * 원형(또는 고리) 그릇 속에 고인 반죽·액체 — 평평한 윗면, 벽에 닿는 가장자리는 meniscus만큼 살짝 타고 올라간다.
 * 회전체라 가운데 축이 y. cx, cz로 옮긴다. flute(θ, r)는 타르트팬의 주름처럼 벽 쪽 반지름을 바꾼다
 */
export function pooledGeometry(
  wall: WallTable,
  floorY: number,
  level: number,
  opts: { inner?: WallTable; meniscus?: number; segments?: number; flute?: (th: number) => number } = {},
): THREE.BufferGeometry {
  const { inner, meniscus = 0.0014, segments = 72, flute } = opts;
  const rw = wallAt(wall, level) - 0.0005;
  const mw = Math.min(0.006, rw * 0.15);
  const prof: THREE.Vector2[] = [];
  const r0 = inner ? wallAt(inner, level) + 0.0005 : 0;
  if (inner) {
    for (let k = 0; k <= 6; k++) {
      const a = (Math.PI / 2) * (k / 6);
      prof.push(new THREE.Vector2(r0 + mw * (1 - Math.cos(a)), level + meniscus * (1 - Math.sin(a))));
    }
  } else prof.push(new THREE.Vector2(0, level));
  const start = prof[prof.length - 1].x;
  for (let k = 1; k <= 16; k++) prof.push(new THREE.Vector2(start + ((rw - mw - start) * k) / 16, level));
  for (let k = 1; k <= 6; k++) {
    const a = (Math.PI / 2) * (k / 6);
    prof.push(new THREE.Vector2(rw - mw + mw * Math.sin(a), level + meniscus * (1 - Math.cos(a))));
  }
  for (let k = 1; k <= 8; k++) {
    const y = level + ((floorY - level) * k) / 8;
    prof.push(new THREE.Vector2(wallAt(wall, y) - 0.0005, y));
  }
  if (inner) {
    for (let k = 0; k <= 8; k++) {
      const y = floorY + ((level - floorY) * k) / 8;
      prof.push(new THREE.Vector2(wallAt(inner, y) + 0.0005, y));
    }
    prof.push(prof[0].clone());
  } else prof.push(new THREE.Vector2(0, floorY));
  // LatheGeometry는 (반지름, 높이) 평면에서 반시계 방향이어야 겉면이 바깥을 본다 — 위에서 시작해 시계 방향으로
  // 만들었으니 뒤집는다(바닥 → 벽 위로 → 윗면 → 가운데)
  prof.reverse();
  const g = new THREE.LatheGeometry(prof, segments);
  if (flute) {
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r < rw * 0.9) continue;
      const th = Math.atan2(z, x);
      const k = (r + flute(th)) / r;
      pos.setXYZ(i, x * k, pos.getY(i), z * k);
    }
  }
  g.computeVertexNormals();
  return g;
}

/** 와플 몰드의 네모 칸에 고인 반죽 — 칸 벽까지 빈틈없이, 모서리는 칸처럼 둥글게(rc) */
export function squarePoolGeometry(half: number, floorY: number, level: number, rc = 0.007): THREE.BufferGeometry {
  const h = Math.max(0.0005, level - floorY);
  const g = new THREE.BoxGeometry(half * 2, h, half * 2, 32, 1, 32);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const inner = half - rc;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const qx = Math.abs(x) - inner;
    const qz = Math.abs(z) - inner;
    if (qx <= 0 || qz <= 0) continue;
    const d = Math.hypot(qx, qz);
    if (d <= rc) continue;
    pos.setXYZ(i, Math.sign(x) * (inner + (qx / d) * rc), pos.getY(i), Math.sign(z) * (inner + (qz / d) * rc));
  }
  g.translate(0, floorY + h / 2, 0);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- 3D 줄기·관
/** 3차원 중심선을 따라가는 관 — r(u)는 자리마다 반지름. 쿠키 반죽의 늘어나는 목 따위 */
export function tubeGeometry3(pts: readonly THREE.Vector3[], r: (u: number) => number, nseg = 12): THREE.BufferGeometry {
  const M = pts.length;
  const V: number[] = [];
  const idx: number[] = [];
  const T = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  for (let i = 0; i < M; i++) {
    T.subVectors(pts[Math.min(i + 1, M - 1)], pts[Math.max(i - 1, 0)]).normalize();
    side.set(0, 1, 0).cross(T);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    up.crossVectors(T, side).normalize();
    const rr = r(i / (M - 1));
    for (let k = 0; k < nseg; k++) {
      const a = (2 * Math.PI * k) / nseg;
      V.push(
        pts[i].x + (side.x * Math.cos(a) + up.x * Math.sin(a)) * rr,
        pts[i].y + (side.y * Math.cos(a) + up.y * Math.sin(a)) * rr,
        pts[i].z + (side.z * Math.cos(a) + up.z * Math.sin(a)) * rr,
      );
    }
  }
  for (let i = 0; i < M - 1; i++) {
    for (let k = 0; k < nseg; k++) {
      const k2 = (k + 1) % nseg;
      const a = i * nseg + k;
      const b = (i + 1) * nseg + k;
      const c = (i + 1) * nseg + k2;
      const d = i * nseg + k2;
      idx.push(a, d, c, a, c, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * 붓는 줄기 — 입구에서 떨어지는 3D 관. 메시를 매 프레임 다시 쓴다(지오메트리를 새로 만들지 않는다).
 * 위는 굵고 떨어지며 가늘어지다 닿는 자리에서 살짝 퍼지고, 표면이 아주 약하게 일렁인다.
 */
export class PourStream {
  readonly mesh: THREE.Mesh;
  private readonly rows = 22;
  private readonly seg = 12;
  private pos: THREE.BufferAttribute;

  constructor(material: THREE.Material) {
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(this.rows * this.seg * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    const idx: number[] = [];
    for (let i = 0; i < this.rows - 1; i++) {
      for (let k = 0; k < this.seg; k++) {
        const k2 = (k + 1) % this.seg;
        const a = i * this.seg + k;
        const b = (i + 1) * this.seg + k;
        const c = (i + 1) * this.seg + k2;
        const d = i * this.seg + k2;
        idx.push(a, d, c, a, c, b);
      }
    }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /**
   * top → bottom으로 떨어지는 줄기. r = 입구 쪽 반지름, cut 0~1 = 끝날 때 위에서부터 끊겨 떨어진 정도.
   * viscous면 끈적한 줄기 — 떨리지 않고, 닿는 자리에서 퍼지지 않고, 곧게 늘어지며 가늘어진다
   */
  update(top: THREE.Vector3, bottom: THREE.Vector3, r: number, time: number, cut = 0, viscous = false): void {
    const a = this.pos.array as Float32Array;
    const c = new THREE.Vector3();
    const p = new THREE.Vector3();
    const T = new THREE.Vector3();
    const side = new THREE.Vector3();
    const up = new THREE.Vector3();
    /** u: 0(입구) ~ 1(닿는 자리) — 옆으로는 일정하게, 아래로는 떨어지며 빨라진다(포물선) */
    const at = (u: number, out: THREE.Vector3) => {
      const w = viscous ? 0 : Math.sin(time * 9 + u * 7) * 0.0009 * u * (1 - u) * 4;
      return out.set(top.x + (bottom.x - top.x) * u + w, top.y + (bottom.y - top.y) * u * u, top.z + (bottom.z - top.z) * u);
    };
    for (let i = 0; i < this.rows; i++) {
      const v = i / (this.rows - 1);
      const u = cut + (1 - cut) * v;
      at(u, c);
      at(Math.min(1, u + 0.02), p);
      T.copy(p).sub(c);
      at(Math.max(0, u - 0.02), p);
      T.add(c).sub(p).normalize();
      side.set(1, 0, 0).cross(T);
      if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
      side.normalize();
      up.crossVectors(T, side).normalize();
      // 떨어지며 가늘어지다 닿는 자리에서 퍼진다
      const thin = 1 - 0.5 * Math.sqrt(u);
      const land = Math.max(0, (u - 0.93) / 0.07) ** 2;
      const rr = viscous
        ? r * (1 - 0.62 * Math.sqrt(u)) * (cut > 0 && v < 0.08 ? v / 0.08 : 1)
        : r * (thin + land * 1.6) * (1 + 0.05 * Math.sin(time * 13 + u * 11)) * (cut > 0 && v < 0.08 ? v / 0.08 : 1);
      for (let k = 0; k < this.seg; k++) {
        const th = (2 * Math.PI * k) / this.seg;
        const j = (i * this.seg + k) * 3;
        a[j] = c.x + (side.x * Math.cos(th) + up.x * Math.sin(th)) * rr;
        a[j + 1] = c.y + (side.y * Math.cos(th) + up.y * Math.sin(th)) * rr;
        a[j + 2] = c.z + (side.z * Math.cos(th) + up.z * Math.sin(th)) * rr;
      }
    }
    this.pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}
