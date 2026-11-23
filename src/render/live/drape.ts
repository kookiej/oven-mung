// 볼에 쌓이는 재료 한 층 — 정해진 모양(윗면 높이 표)을 아래에 깔린 것의 모양을 따라 얹는다.
// 가루 더미 위의 가루, 더미에 흘러내린 달걀 흰자처럼 먼저 들어온 재료의 생김새대로 올라앉는다.
// 메시는 극좌표 격자 — 표(unit)는 반지름 1 기준 두께(0~1)이고, shape가 무대 좌표의 정점을 다시 계산한다.
import * as THREE from 'three';

/** 아래에 깔린 면의 높이 — 무대 좌표 (x, z) */
export type HeightFn = (x: number, z: number) => number;

/** 층 가장자리를 아래층 속으로 집어넣는 깊이(미터) — 윤곽이 아래 면과의 얕은 교차(각진 볼 메시)가 아니라 층 모양대로 나오게 뚝 떨어뜨린다 */
const TUCK = 0.004;
/** 이 두께(미터)보다 얇은 자리부터 가라앉는다 */
const TUCK_FROM = 0.0007;

export class DrapedLayer {
  readonly geometry = new THREE.BufferGeometry();
  private readonly unit: Float32Array;
  private readonly pos: THREE.BufferAttribute;
  r = 0;
  h = 0;
  cx = 0;
  cz = 0;

  constructor(
    unitAt: (rho: number, a: number) => number,
    private readonly nt: number,
    private readonly nr: number,
    /** 표의 반지름 범위 — 들쭉날쭉한 가장자리까지 덮을 만큼 */
    private readonly rhoMax: number,
    /** 가장자리를 가라앉히는 깊이 — 묽은 재료는 얕게 해서 윤곽이 아래 면으로 스며들게 */
    private readonly tuck = TUCK,
  ) {
    const n = 1 + nr * nt;
    this.unit = new Float32Array(n);
    const uv = new Float32Array(n * 2);
    this.unit[0] = unitAt(0, 0);
    uv.set([0.5, 0.5], 0);
    for (let j = 1; j <= nr; j++) {
      const rho = (j / nr) * rhoMax;
      for (let i = 0; i < nt; i++) {
        const a = (2 * Math.PI * i) / nt;
        const v = 1 + (j - 1) * nt + i;
        this.unit[v] = unitAt(rho, a);
        uv.set([0.5 + Math.cos(a) * rho * 0.5, 0.5 + Math.sin(a) * rho * 0.5], v * 2);
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < nt; i++) idx.push(0, 1 + ((i + 1) % nt), 1 + i);
    for (let j = 0; j < nr - 1; j++) {
      for (let i = 0; i < nt; i++) {
        const a0 = 1 + j * nt + i;
        const a1 = 1 + j * nt + ((i + 1) % nt);
        idx.push(a0, a1, a1 + nt, a0, a1 + nt, a0 + nt);
      }
    }
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geometry.setIndex(idx);
  }

  /** 무대 좌표 (x, z)에서 이 층의 두께 */
  thickness(x: number, z: number): number {
    if (this.r <= 1e-6 || this.h <= 0) return 0;
    const dx = x - this.cx;
    const dz = z - this.cz;
    const fr = (Math.hypot(dx, dz) / this.r / this.rhoMax) * this.nr;
    if (fr >= this.nr) return 0;
    let a = (Math.atan2(dz, dx) / (2 * Math.PI)) * this.nt;
    if (a < 0) a += this.nt;
    const j = Math.floor(fr);
    const i0 = Math.floor(a) % this.nt;
    const i1 = (i0 + 1) % this.nt;
    const ft = a - Math.floor(a);
    const ring = (jj: number) =>
      jj === 0 ? this.unit[0] : this.unit[1 + (jj - 1) * this.nt + i0] * (1 - ft) + this.unit[1 + (jj - 1) * this.nt + i1] * ft;
    const f = fr - j;
    return this.h * (ring(j) * (1 - f) + (j < this.nr ? ring(j + 1) : 0) * f);
  }

  /** 반지름 r, 높이 h로, (cx, cz) 자리에, below의 생김새를 따라 앉힌다 */
  shape(r: number, h: number, cx: number, cz: number, below: HeightFn): void {
    this.r = r;
    this.h = h;
    this.cx = cx;
    this.cz = cz;
    const a = this.pos.array as Float32Array;
    const put = (v: number, x: number, z: number) => {
      const t = this.unit[v] * h;
      a[v * 3] = x;
      a[v * 3 + 1] = below(x, z) + t - this.tuck * (1 - Math.min(1, t / TUCK_FROM));
      a[v * 3 + 2] = z;
    };
    put(0, cx, cz);
    for (let j = 1; j <= this.nr; j++) {
      const rho = (j / this.nr) * this.rhoMax * r;
      for (let i = 0; i < this.nt; i++) {
        const ang = (2 * Math.PI * i) / this.nt;
        put(1 + (j - 1) * this.nt + i, cx + Math.cos(ang) * rho, cz + Math.sin(ang) * rho);
      }
    }
    this.pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
