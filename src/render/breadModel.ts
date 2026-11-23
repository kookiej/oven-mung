// 오븐 속 3D — Blender 카툰 에셋의 빵·그릇 메시(GLB)를 불러온다.
// GLB는 renders/blender_cartoon/render_game.py의 glb_jobs가 내보낸다(public/assets/models/<빵>.glb).
//   bread_* 메시: 빵 껍질 — 게임 셰이더(breadShader)로 부풀고 구워진다. 정점 속성 _toast(Blender의 굽기 분포),
//                 _score(바게트 칼집이 벌어진 변위)를 갖는다. 메시는 다 구운 모양이다.
//   vessel_*·extra_* 메시: 그릇, 컵케이크 종이컵, 파이 필링 — GLB 재질 그대로(조금 손본다)
// **같은 반죽 오브젝트** — 정점마다 "굽기 시작할 때 놓인 반죽 겉면의 자리"(aDough·aDoughN)를 찾아 둔다. 반죽은 토핑 화면·틀에
// 넣기에서 본 그 모양(placed.ts의 bakeStartSurfaces: 빚은 모양, 놓은 자리, 부은 높이)이라, 셰이더가 그 모습에서 시작해
// 다 구운 모양으로 부풀린다. 토핑 알갱이도 같은 알갱이(bits.ts)가 시작 자리 → 끝 자리로 따라간다.
// 불러오지 못하면 null — scene.ts가 예전 절차적 메시(breadMesh.ts·vessel.ts)로 그린다.
// 꺼내기(자르기) 단계도 같은 메시를 쓴다(cutScene.ts) — 그릇을 빼고 빵 하나만 골라 도마 크기에 맞춘다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { BreadDef, DoughLayout, ToppingId } from '../types';
import { bakeStartSurfaces, defaultPlaced, doughSpecs, pieceSpots, stageMeta } from './live/placed';
import { bitQuaternion, scatterBits } from './live/bits';
import { toonColor } from './live/materials';

/** 토핑 알갱이 하나 — 모델 좌표(게임 단위) */
export interface BitAnchor {
  /** 반죽 겉면의 자리 → 다 구운 겉면의 자리 */
  from: [number, number, number];
  to: [number, number, number];
  scale: [number, number, number];
  quat: [number, number, number, number];
  color: [number, number, number];
  /** 얹힌 빵의 가운데 x, z, 반폭, 바닥 높이 */
  bread: [number, number, number, number];
}

export interface BreadModel {
  /** 빵 껍질 메시들 — 변환을 정점에 구워 넣어 모두 같은 좌표계(게임 단위, Y 위)에 있다. 속성 aDough·aDoughN·toast·score */
  breads: THREE.Mesh[];
  /** 그릇·소품 메시들 — 같은 좌표계 */
  others: THREE.Mesh[];
  bits: BitAnchor[];
}

/** 그릇·트레이째 가로 폭 (게임 단위) — scene.ts의 카메라가 이 폭을 기준으로 거리를 잡는다.
 * 트레이 빵도 트레이 전체가 오븐 창에 들어온다(트레이를 확대해 넘치게 하지 않는다 — 사용자 요청) */
const FIT_WIDTH = 2.3;
/** 전체(그릇 포함) 높이의 상한 — 식빵틀처럼 높은 그릇이 오븐 창 위로 넘치지 않게 */
const FIT_HEIGHT = 1.25;

const loader = new GLTFLoader();

export async function loadBreadModel(
  def: BreadDef,
  toppingIds: readonly ToppingId[],
  seed: number,
  layout?: DoughLayout,
  /** 다른 모양의 GLB — 다 구운 와플을 격자 면으로 보여 줄 때 */
  variant?: string,
): Promise<BreadModel | null> {
  try {
    const gltf = await loader.loadAsync(`./assets/models/${variant ?? def.id}.glb`);
    return prepare(def, gltf.scene, toppingIds, seed, layout);
  } catch (e) {
    console.warn('bread model load failed', def.id, e);
    return null;
  }
}

function prepare(def: BreadDef, root: THREE.Object3D, toppingIds: readonly ToppingId[], seed: number, layout?: DoughLayout): BreadModel {
  root.updateMatrixWorld(true);
  const breads: THREE.Mesh[] = [];
  const others: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    // 소금은 토핑 알갱이처럼 반죽과 함께 따라간다(bits.ts)
    if (o.name.includes('소금')) return;
    // 공유 메시(컵케이크 6개 등)도 변환을 정점에 구워 넣으려면 하나씩 복제한다
    const geo = (o.geometry as THREE.BufferGeometry).clone();
    geo.applyMatrix4(o.matrixWorld);
    const mesh = new THREE.Mesh(geo, o.material);
    mesh.name = o.name;
    (o.name.startsWith('bread_') ? breads : others).push(mesh);
  });

  // 한 덩이 트레이 빵은 놓은 자리에서 굽는다 — 다 부푼 모양이 트레이 밖으로 나가지 않는 만큼만
  const tray = def.vessel === 'tray' && !pieceSpots(def);
  if (tray) {
    const half = stageMeta(def).half ?? [0.165, 0.115];
    const b = boxOf(breads);
    const q = (layout?.placed ?? defaultPlaced(def))[0];
    const hx = Math.max(0, half[0] - 0.02 - (b.max.x - b.min.x) / 2);
    const hz = Math.max(0, half[1] - 0.02 - (b.max.z - b.min.z) / 2);
    const dx = Math.max(-hx, Math.min(hx, q[0]));
    const dz = Math.max(-hz, Math.min(hz, q[1]));
    for (const m of breads) (m.geometry as THREE.BufferGeometry).translate(dx, 0, dz);
  }

  // 크기·자리 맞추기 — 그릇째 가로 폭을 FIT_WIDTH로, 가운데를 원점으로, 바닥(가장 낮은 점)을 y=0으로
  const all = boxOf([...breads, ...others]);
  const k = Math.min(
    FIT_WIDTH / Math.max(all.max.x - all.min.x, all.max.z - all.min.z, 1e-6),
    FIT_HEIGHT / Math.max(all.max.y - all.min.y, 1e-6),
  );
  const m = new THREE.Matrix4()
    .makeScale(k, k, k)
    .premultiply(new THREE.Matrix4().makeTranslation(-((all.min.x + all.max.x) / 2) * k, -all.min.y * k, -((all.min.z + all.max.z) / 2) * k));
  for (const mesh of [...breads, ...others]) {
    const g = mesh.geometry as THREE.BufferGeometry;
    g.applyMatrix4(m);
    g.computeBoundingBox();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
  }

  // 같은 반죽 — 토핑 화면에서 본 그 반죽 겉면 (모델 좌표)
  const surfaces = bakeStartSurfaces(def, layout).map((g) => {
    g.applyMatrix4(m);
    g.computeBoundingBox();
    return g;
  });

  for (const mesh of breads) {
    const g = mesh.geometry as THREE.BufferGeometry;
    const n = g.getAttribute('position').count;
    // Blender의 굽기 분포(_toast) → 셰이더 속성 toast. 없으면 고르게 1
    const t = g.getAttribute('_toast') ?? g.getAttribute('_TOAST');
    g.setAttribute('toast', t ?? new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    // 칼집 변위(_score) — 가장 깊은 홈을 -1로 나눈 값. 없으면 0
    const sc = g.getAttribute('_score') ?? g.getAttribute('_SCORE');
    const sv = new Float32Array(n);
    let deepest = 0;
    if (sc) for (let i = 0; i < n; i++) deepest = Math.max(deepest, -sc.getX(i));
    if (sc && deepest > 0) for (let i = 0; i < n; i++) sv[i] = sc.getX(i) / deepest;
    g.setAttribute('score', new THREE.BufferAttribute(sv, 1));
    // 칼집의 높이 변위 — 굽는 중간에 칼집을 내는 빵만. Blender 값은 미터라 맞춘 크기(k)를 곱한다
    const sy = new Float32Array(n);
    if (sc && def.midScore) for (let i = 0; i < n; i++) sy[i] = sc.getX(i) * k;
    g.setAttribute('scoreY', new THREE.BufferAttribute(sy, 1));
    mapToDough(g, surfaces);
  }
  for (const s of surfaces) s.dispose();

  for (const mesh of others) {
    // 장면에 환경 맵이 없어 금속 재질은 거의 검게 보인다 — 금속감을 줄이고 색을 살린다
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat && 'metalness' in mat) {
      mat.metalness = Math.min(mat.metalness, 0.25);
      mat.roughness = Math.max(mat.roughness, 0.45);
      if (mesh.name.includes('필링')) mat.color.set('#d08a3a');
    }
  }
  return { breads, others, bits: anchorBits(def, breads, others, toppingIds, seed, layout, m, k) };
}

// ---------------------------------------------------------------- 정점 → 반죽 겉면
/** 격자로 나눈 점들 — 가장 가까운 점 찾기 */
class PointGrid {
  private cells = new Map<string, number[]>();
  private cell: number;
  constructor(
    private pos: ArrayLike<number>,
    bounds: THREE.Box3,
    count: number,
    private accept: (i: number) => boolean = () => true,
  ) {
    const size = bounds.getSize(new THREE.Vector3());
    const vol = Math.max(size.x, 1e-4) * Math.max(size.y, 1e-4) * Math.max(size.z, 1e-4);
    this.cell = Math.max(Math.cbrt((vol / Math.max(count, 1)) * 8), Math.max(size.x, size.y, size.z) / 128);
    for (let i = 0; i < count; i++) {
      if (!accept(i)) continue;
      const k = this.key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      const l = this.cells.get(k);
      if (l) l.push(i);
      else this.cells.set(k, [i]);
    }
  }
  private key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  /** 가장 가까운 점 — ok를 주면 그걸 만족하는 점 중에서, maxD(미터)보다 멀면 찾지 않는다(-1) */
  nearest(x: number, y: number, z: number, ok?: (i: number) => boolean, maxD = Infinity): number {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const cz = Math.floor(z / this.cell);
    let best = -1;
    let bd = Infinity;
    for (let r = 0; r < 200; r++) {
      // 찾은 점이 이번 껍질보다 가까우면 끝
      if (best >= 0 && (r - 1) * this.cell > Math.sqrt(bd)) break;
      if ((r - 1) * this.cell > maxD) break;
      for (let a = -r; a <= r; a++) {
        for (let b = -r; b <= r; b++) {
          for (let c = -r; c <= r; c++) {
            if (Math.max(Math.abs(a), Math.abs(b), Math.abs(c)) !== r) continue;
            const l = this.cells.get(`${cx + a},${cy + b},${cz + c}`);
            if (!l) continue;
            for (const i of l) {
              if (ok && !ok(i)) continue;
              const dx = this.pos[i * 3] - x;
              const dy = this.pos[i * 3 + 1] - y;
              const dz = this.pos[i * 3 + 2] - z;
              const d = dx * dx + dy * dy + dz * dz;
              if (d < bd) {
                bd = d;
                best = i;
              }
            }
          }
        }
      }
    }
    return best;
  }
}

/** 메시의 정점마다 가장 가까운 반죽 겉면의 자리·노멀 → aDough·aDoughN. 메시와 겹치는 반죽만 본다(컵케이크는 제 칸의 반죽) */
function mapToDough(g: THREE.BufferGeometry, surfaces: readonly THREE.BufferGeometry[]): void {
  const box = g.boundingBox!.clone().expandByScalar(0.02);
  let near = surfaces.filter((s) => s.boundingBox!.intersectsBox(box));
  if (!near.length) near = [...surfaces];
  // 합치기
  let vcount = 0;
  for (const s of near) vcount += s.getAttribute('position').count;
  const P = new Float32Array(vcount * 3);
  const N = new Float32Array(vcount * 3);
  const tris: number[] = [];
  let off = 0;
  const bounds = new THREE.Box3();
  for (const s of near) {
    const p = s.getAttribute('position') as THREE.BufferAttribute;
    const n = s.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      P.set([p.getX(i), p.getY(i), p.getZ(i)], (off + i) * 3);
      N.set([n.getX(i), n.getY(i), n.getZ(i)], (off + i) * 3);
    }
    const ix = s.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) tris.push(off + ix.getX(i));
    else for (let i = 0; i < p.count; i++) tris.push(off + i);
    off += p.count;
    bounds.union(s.boundingBox!);
  }
  // 정점 → 닿은 삼각형들
  const incident: number[][] = Array.from({ length: vcount }, () => []);
  for (let t = 0; t < tris.length; t += 3) {
    incident[tris[t]].push(t);
    incident[tris[t + 1]].push(t);
    incident[tris[t + 2]].push(t);
  }
  const grid = new PointGrid(P, bounds, vcount);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const outP = new Float32Array(pos.count * 3);
  const outN = new Float32Array(pos.count * 3);
  const q = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const cp = new THREE.Vector3();
  const bary = new THREE.Vector3();
  const tri = new THREE.Triangle();
  const gn = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const qn = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    q.fromBufferAttribute(pos, i);
    let v = grid.nearest(q.x, q.y, q.z);
    // 같은 쪽을 보는 반죽 겉면에 — 가장 가까운 점이 반대쪽을 보면(꼬인 프레첼의 옆 팔, 끝이 얹힌 배 위, 겹친 자리) 그 자리로 모이면
    // 시작할 때 반죽이 뭉개지고 트레이에 묻힌 것처럼 보인다. 너무 멀리 가지는 않는다
    if (gn && v >= 0) {
      qn.fromBufferAttribute(gn, i);
      const dot = (j: number) => qn.x * N[j * 3] + qn.y * N[j * 3 + 1] + qn.z * N[j * 3 + 2];
      if (dot(v) < 0.2) {
        const d0 = Math.hypot(P[v * 3] - q.x, P[v * 3 + 1] - q.y, P[v * 3 + 2] - q.z);
        const w = grid.nearest(q.x, q.y, q.z, (j) => dot(j) >= 0.2, d0 * 2.5 + 0.03);
        if (w >= 0) v = w;
      }
    }
    let bestD = Infinity;
    let px = P[v * 3];
    let py = P[v * 3 + 1];
    let pz = P[v * 3 + 2];
    let nx = N[v * 3];
    let ny = N[v * 3 + 1];
    let nz = N[v * 3 + 2];
    for (const t of incident[v]) {
      const i0 = tris[t];
      const i1 = tris[t + 1];
      const i2 = tris[t + 2];
      a.fromArray(P, i0 * 3);
      b.fromArray(P, i1 * 3);
      c.fromArray(P, i2 * 3);
      tri.set(a, b, c);
      tri.closestPointToPoint(q, cp);
      const d = cp.distanceToSquared(q);
      if (d < bestD && tri.getBarycoord(cp, bary)) {
        bestD = d;
        px = cp.x;
        py = cp.y;
        pz = cp.z;
        nx = N[i0 * 3] * bary.x + N[i1 * 3] * bary.y + N[i2 * 3] * bary.z;
        ny = N[i0 * 3 + 1] * bary.x + N[i1 * 3 + 1] * bary.y + N[i2 * 3 + 1] * bary.z;
        nz = N[i0 * 3 + 2] * bary.x + N[i1 * 3 + 2] * bary.y + N[i2 * 3 + 2] * bary.z;
      }
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    outP.set([px, py, pz], i * 3);
    outN.set([nx / len, ny / len, nz / len], i * 3);
  }
  g.setAttribute('aDough', new THREE.BufferAttribute(outP, 3));
  g.setAttribute('aDoughN', new THREE.BufferAttribute(outN, 3));
}

// ---------------------------------------------------------------- 토핑 알갱이
/** 토핑 화면의 알갱이 → 오븐 모델 좌표. 끝 자리는 그 반죽 자리에서 부푼 빵 겉면(위를 향한 가까운 정점) */
function anchorBits(
  def: BreadDef,
  breads: readonly THREE.Mesh[],
  others: readonly THREE.Mesh[],
  toppingIds: readonly ToppingId[],
  seed: number,
  layout: DoughLayout | undefined,
  m: THREE.Matrix4,
  k: number,
): BitAnchor[] {
  const specs = doughSpecs(def, layout);
  const list = scatterBits(def, specs, toppingIds, seed);
  if (!list.length) return [];
  const isPie = def.id === 'pie';
  const top = stageMeta(def).topY ?? 0.0009;
  const placed = def.vessel === 'tray' ? (layout?.placed ?? defaultPlaced(def)) : null;
  // 알갱이가 놓일 겉면 — 빵 정점의 시작 자리. 파이는 필링 위라 필링 정점
  const targets = (isPie ? others.filter((o) => o.name.includes('필링')) : [...breads]).map((mesh) => {
    const g = mesh.geometry as THREE.BufferGeometry;
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    const src = (isPie ? g.getAttribute('position') : g.getAttribute('aDough')) as THREE.BufferAttribute;
    const grid = new PointGrid(src.array, g.boundingBox!.clone().expandByScalar(0.3), src.count, (i) => nrm.getY(i) > 0.3);
    const b = g.boundingBox!;
    const bread: [number, number, number, number] = [
      (b.min.x + b.max.x) / 2,
      (b.min.z + b.max.z) / 2,
      Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2,
      b.min.y,
    ];
    return { g, nrm, src, grid, bread, center: new THREE.Vector2(bread[0], bread[1]), half: bread[2] };
  });
  if (!targets.length) return [];
  const q = new THREE.Quaternion();
  const D = new THREE.Vector3();
  const pa = new THREE.Vector3();
  return list.map((bit) => {
    if (placed) {
      const pl = placed[Math.min(bit.piece, placed.length - 1)];
      D.set(pl[0] + bit.p[0], top + bit.p[1], pl[1] + bit.p[2]);
    } else D.set(specs[bit.piece].at.x + bit.p[0], specs[bit.piece].at.y + bit.p[1], specs[bit.piece].at.z + bit.p[2]);
    D.applyMatrix4(m);
    // 이 자리가 들어 있는 빵 (쿠키는 조각마다 따로)
    const tgt = targets.reduce((best, t) =>
      t.center.distanceTo(new THREE.Vector2(D.x, D.z)) - t.half < best.center.distanceTo(new THREE.Vector2(D.x, D.z)) - best.half ? t : best,
    );
    const v = tgt.grid.nearest(D.x, D.y, D.z);
    const pos = tgt.g.getAttribute('position') as THREE.BufferAttribute;
    pa.fromBufferAttribute(pos, Math.max(v, 0));
    const nrm = tgt.nrm;
    const to: [number, number, number] = [
      pa.x + nrm.getX(v) * bit.s[0] * k * 0.2,
      pa.y + nrm.getY(v) * bit.s[0] * k * 0.2,
      pa.z + nrm.getZ(v) * bit.s[0] * k * 0.2,
    ];
    bitQuaternion(bit, q);
    const col = toonColor(bit.color, 1.05, 1.02);
    return {
      from: isPie ? to : [D.x, D.y, D.z],
      to,
      scale: [bit.s[0] * k, bit.s[1] * k, bit.s[2] * k],
      quat: [q.x, q.y, q.z, q.w],
      color: [col.r, col.g, col.b],
      bread: tgt.bread,
    };
  });
}

function boxOf(meshes: THREE.Mesh[]): THREE.Box3 {
  const b = new THREE.Box3();
  for (const m of meshes) {
    const g = m.geometry as THREE.BufferGeometry;
    g.computeBoundingBox();
    b.union(g.boundingBox!);
  }
  return b;
}
