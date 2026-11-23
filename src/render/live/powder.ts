// 볼에 쌓인 가루 — 덩어리 하나가 아니라 재료마다 진짜 같은 결로.
//   밀가루: 고운 입자가 보슬보슬 무너져 내린 부드러운 더미, 둘레로 가루가 날린다
//   설탕: 반짝이는 결정 — 알갱이가 또렷하고 표면이 까끌하다
//   소금: 굵고 각진 결정
//   이스트: 동글동글한 황갈색 알갱이가 소복하다
// 앞서 들어온 재료가 있으면 그 생김새를 따라 덮인다(drape.ts).
import * as THREE from 'three';
import type { PowderGrain } from '../../content/ingredients';
import { DrapedLayer, type HeightFn } from './drape';
import { noise3 } from './noise';

interface GrainStyle {
  /** 표면 울퉁불퉁함 (단위 높이 기준) */
  lump: number;
  /** 표면 입자의 주파수 — 높을수록 곱다 */
  detail: number;
  rough: number;
  /** 흩어진 알갱이 수·크기 (단위 반지름 기준)·세로 비율 */
  bits: number;
  bitSize: number;
  bitFlat: number;
  /** 각진 알갱이(결정)인지 */
  cubic: boolean;
  /** 표면 무늬의 어두운 점·밝은 점 진하기 */
  dark: number;
  bright: number;
  /** 표면 무늬 점의 크기(텍스처 픽셀) */
  speck: number;
}

const STYLE: Record<PowderGrain, GrainStyle> = {
  flour: { lump: 0.09, detail: 7, rough: 1, bits: 140, bitSize: 0.012, bitFlat: 0.6, cubic: false, dark: 0.05, bright: 0.04, speck: 1.2 },
  sugar: { lump: 0.05, detail: 16, rough: 0.42, bits: 240, bitSize: 0.022, bitFlat: 0.9, cubic: true, dark: 0.14, bright: 0.5, speck: 1.6 },
  salt: { lump: 0.06, detail: 12, rough: 0.5, bits: 130, bitSize: 0.04, bitFlat: 0.85, cubic: true, dark: 0.16, bright: 0.45, speck: 2.6 },
  yeast: { lump: 0.1, detail: 20, rough: 0.85, bits: 170, bitSize: 0.04, bitFlat: 0.7, cubic: false, dark: 0.42, bright: 0.22, speck: 3.2 },
};

/** 더미의 높이 (반지름 비율 rho, 각도 a) — 가장자리가 무너져 내린 완만한 원뿔. draped면 앞선 재료를 덮는 둥근 층 */
function moundHeight(rho: number, a: number, seed: number, st: GrainStyle, draped: boolean): number {
  // 윤곽은 완만하게 — 주파수가 높으면 꼭대기부터 주름이 져 머랭처럼 보인다
  const edge = 1 + 0.2 * noise3(Math.cos(a) * 0.9 + seed, Math.sin(a) * 0.9, seed) + 0.035 * noise3(Math.cos(a) * 2.6, Math.sin(a) * 2.6, seed + 2);
  const q = rho / edge;
  if (q >= 1) return 0;
  // 위쪽은 원뿔처럼, 아래쪽은 흘러내려 완만하게
  const body = draped ? 1 - q * q : (1 - q) ** 1.05 * (0.72 + 0.28 * (1 - q));
  const x = Math.cos(a) * rho;
  const z = Math.sin(a) * rho;
  const n = noise3(x * 3.1 + seed, z * 3.1, seed * 0.7) * st.lump + noise3(x * st.detail, z * st.detail, seed + 5) * st.lump * 0.35;
  return Math.max(0, body + n * Math.min(1, (1 - q) * 3));
}

/** 표면 결 텍스처 — 고운 입자(바탕)에 어두운 점·밝은 점 */
function grainTexture(color: string, st: GrainStyle, seed: number): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const base = new THREE.Color(color);
  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, S, S);
  let s = Math.floor(seed * 1000) + 11;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const dark = `#${base.clone().multiplyScalar(1 - st.dark).getHexString()}`;
  const bright = `#${base.clone().lerp(new THREE.Color('#ffffff'), 0.85).getHexString()}`;
  const n = Math.round(40000 / (st.speck * st.speck));
  for (let i = 0; i < n; i++) {
    const hi = rand() < 0.45;
    g.globalAlpha = (hi ? st.bright : 1) * (0.35 + rand() * 0.65);
    g.fillStyle = hi ? bright : dark;
    const r = st.speck * (0.5 + rand() * 0.8);
    g.fillRect(rand() * S, rand() * S, r, r * (0.7 + rand() * 0.6));
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * 볼에 쌓이는 가루 한 층. 먼저 들어온 재료가 있으면 그 생김새를 따라 덮이고(draped — 원뿔이 아니라 둥근 층), 알갱이도 그 면에 앉는다.
 * shape가 정점·알갱이를 다시 계산한다.
 */
export class PowderPile {
  readonly mesh: THREE.Mesh;
  private readonly layer: DrapedLayer;
  private readonly st: GrainStyle;
  private readonly bits: THREE.InstancedMesh;
  private readonly bitSpec: { a: number; rho: number; size: number; quat: THREE.Quaternion; wide: number }[] = [];
  private readonly draped: boolean;

  constructor(color: string, grain: PowderGrain, seed: number, draped: boolean) {
    const st = STYLE[grain];
    this.st = st;
    this.draped = draped;
    this.layer = new DrapedLayer((rho, a) => moundHeight(rho, a, seed, st, draped), 96, 28, 1.3);
    const tex = grainTexture(color, st, seed);
    tex.repeat.set(3, 3);
    const mat = new THREE.MeshStandardMaterial({
      // 흰 가루가 조명에 하얗게 날아가 결이 사라지지 않게 조금 어둡게
      color: new THREE.Color(grain === 'yeast' ? 0.95 : 0.78, grain === 'yeast' ? 0.95 : 0.78, grain === 'yeast' ? 0.95 : 0.76),
      map: tex,
      bumpMap: tex,
      bumpScale: grain === 'flour' ? 0.25 : 0.9,
      roughness: st.rough,
      metalness: 0,
    });
    this.mesh = new THREE.Mesh(this.layer.geometry, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;

    // 흩어진 알갱이 — 더미 위와 둘레. 결정은 각지고 반짝, 가루는 작고 부드럽게
    const bitGeo: THREE.BufferGeometry = st.cubic ? new THREE.BoxGeometry(1, 1, 1) : new THREE.SphereGeometry(1, 6, 5);
    const bitMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).multiplyScalar(grain === 'yeast' ? 0.85 : 0.9),
      roughness: st.cubic ? 0.25 : 0.9,
    });
    this.bits = new THREE.InstancedMesh(bitGeo, bitMat, st.bits);
    this.bits.castShadow = st.bitSize > 0.03;
    this.bits.frustumCulled = false;
    let s = Math.floor(seed * 777) + 3;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const e = new THREE.Euler();
    for (let i = 0; i < st.bits; i++) {
      e.set(rand() * 6.3, rand() * 6.3, rand() * 6.3);
      this.bitSpec.push({
        a: rand() * Math.PI * 2,
        // 대부분은 가장자리 둘레에 흩어지고 일부는 더미 위에 얹힌다
        rho: rand() < 0.65 ? 0.7 + rand() * 0.75 : Math.sqrt(rand()) * 0.8,
        size: st.bitSize * (0.6 + rand() * 0.8),
        quat: new THREE.Quaternion().setFromEuler(e),
        wide: 0.75 + rand() * 0.5,
      });
    }
    this.mesh.add(this.bits);
  }

  /** 높이 ÷ 반지름 — 첫 더미는 낮은 원뿔(0.6), 얹힌 층은 둥글게 덮여 부피가 같아도 낮다(0.4). 어느 쪽이든 반지름 = ∛(5v/π) */
  get heightRatio(): number {
    return this.draped ? 0.4 : 0.6;
  }

  thickness(x: number, z: number): number {
    return this.layer.thickness(x, z);
  }

  shape(r: number, h: number, cx: number, cz: number, below: HeightFn): void {
    this.layer.shape(r, h, cx, cz, below);
    const M = new THREE.Matrix4();
    const P = new THREE.Vector3();
    const S = new THREE.Vector3();
    for (let i = 0; i < this.bitSpec.length; i++) {
      const b = this.bitSpec[i];
      const x = cx + Math.cos(b.a) * b.rho * r;
      const z = cz + Math.sin(b.a) * b.rho * r;
      const size = b.size * r;
      P.set(x, below(x, z) + this.layer.thickness(x, z) + size * 0.3, z);
      M.compose(P, b.quat, S.set(size, size * this.st.bitFlat * 1.2, size * b.wide));
      this.bits.setMatrixAt(i, M);
    }
    this.bits.instanceMatrix.needsUpdate = true;
  }
}
