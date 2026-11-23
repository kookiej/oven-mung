// 토핑 알갱이 — 반죽 윗면에 흩뿌린 작은 조각. 토핑 올리기에서 정해진 자리(같은 seed면 같은 자리)가
// 틀·트레이로 옮길 때도, 오븐에서 부풀 때도, 자른 뒤에도 그대로 따라간다. 프레첼의 굵은 소금도 같은 길을 간다.
//   위에서 광선을 쏘아 맞은 자리에, 위를 향한 면에만.
import * as THREE from 'three';
import type { BreadDef, ToppingId } from '../../types';
import { ROLLED_PEEK, bakedToppingIds, canonicalToppings, getTopping, isBowlTopping, toppingSlots } from '../../content/toppings';
import { rollsIn } from '../../content/forming';
import { seededRandom } from '../../util';
import type { DoughSpec } from './placed';

/** 밀어 편 판 위의 토핑이 놓이는 범위 — 판 가운데에서 가장자리까지의 이 비율 안쪽 */
const SHEET_INSET = 0.62;

/** 알갱이 하나 — 조각(piece) 기준 좌표 */
export interface Bit {
  piece: number;
  /** 어느 토핑의 알갱이인지 (프레첼 소금은 없다) */
  id?: ToppingId;
  p: [number, number, number];
  n: [number, number, number];
  /** 납작한 알갱이의 세 반지름 */
  s: [number, number, number];
  spin: number;
  color: string;
}

/** 흩뿌리는 방법 */
export interface ScatterOpts {
  /** 지금까지 올린 토핑 — 없으면 전부. 볼에 넣은 가루의 알갱이는 처음부터 있다 */
  active?: readonly ToppingId[];
  /** 밀어 편 판 위 — 올리는 토핑만, 다 올린 그대로(겉에 드러나는 비율을 줄이지 않는다) */
  sheet?: boolean;
}

/** 슬롯과 프레첼 소금 — 슈가파우더는 구운 뒤에 뿌리니 여기엔 없다 */
function slotsOf(def: BreadDef, ids: readonly ToppingId[], opts: ScatterOpts): { id?: ToppingId; color: string; density: number; size: number; seedAdd: number }[] {
  const baked = bakedToppingIds(ids);
  const list = canonicalToppings(baked);
  const peek = !opts.sheet && rollsIn(def) ? ROLLED_PEEK : 1;
  const out: { id?: ToppingId; color: string; density: number; size: number; seedAdd: number }[] = toppingSlots(baked, peek).map((s, i) => ({
    id: list[i],
    color: s.color,
    density: s.density,
    size: s.size,
    seedAdd: 13 + i * 101,
  }));
  const shown = out.filter((s) => {
    if (!s.id) return true;
    if (isBowlTopping(getTopping(s.id))) return !opts.sheet;
    return !opts.active || opts.active.includes(s.id);
  });
  if (def.id === 'pretzel' && !opts.sheet) shown.push({ color: '#f4f4ee', density: 0.55, size: 0.7, seedAdd: 7 });
  return shown;
}

/** 토핑을 흩뿌린다 — specs는 토핑 화면의 반죽. 파이는 토핑이 곧 필링이라 소복이 많이 */
export function scatterBits(def: BreadDef, specs: readonly DoughSpec[], ids: readonly ToppingId[], seed: number, opts: ScatterOpts = {}): Bit[] {
  const meshes = specs.flatMap((d, i) => {
    if (!d.surface) return [];
    const m = new THREE.Mesh(d.geo);
    m.position.copy(d.at);
    m.updateMatrixWorld(true);
    m.userData.piece = i;
    return [m];
  });
  if (!meshes.length) return [];
  const box = new THREE.Box3();
  for (const m of meshes) box.expandByObject(m);
  // 조각마다의 가운데(정점 평균) — 판 위 토핑을 가운데로 모을 때
  const centers: Record<number, THREE.Vector3> = {};
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    const c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) c.add(new THREE.Vector3().fromBufferAttribute(pos, i));
    centers[m.userData.piece as number] = c.multiplyScalar(1 / pos.count).add(m.position);
  }
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const area = (box.max.x - box.min.x) * (box.max.z - box.min.z);
  const pieK = def.id === 'pie' ? 2.2 : 1;
  const out: Bit[] = [];
  const q = new THREE.Quaternion();
  for (const slot of slotsOf(def, ids, opts)) {
    if (slot.density <= 0) continue;
    const rand = seededRandom(seed + slot.seedAdd);
    // 빵 하나(약 0.08 m 지름) 기준 개수를 넓이만큼 늘린다
    const count = Math.round((10 + slot.density * 26) * Math.max(1, area / 0.0064) * pieK);
    for (let n = 0, tries = 0; n < count && tries < count * 8; tries++) {
      const x = box.min.x + rand() * (box.max.x - box.min.x);
      const z = box.min.z + rand() * (box.max.z - box.min.z);
      ray.set(new THREE.Vector3(x, box.max.y + 0.1, z), down);
      let hit = ray.intersectObjects(meshes, false)[0];
      if (!hit?.face) continue;
      if (opts.sheet) {
        // 밀어 편 판 위 — 판 가운데 쪽으로 모아 가장자리에서 넉넉히 띄운다(말거나 접거나 감쌀 때 새지 않게, 사용자 요청)
        const c = centers[hit.object.userData.piece as number];
        ray.set(new THREE.Vector3(c.x + (x - c.x) * SHEET_INSET, box.max.y + 0.1, c.z + (z - c.z) * SHEET_INSET), down);
        hit = ray.intersectObjects([hit.object], false)[0];
        if (!hit?.face) continue;
      }
      const nrm = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (nrm.y < 0.45) continue;
      const r = (0.0022 + rand() * 0.0022) * slot.size;
      const piece = hit.object.userData.piece as number;
      const loc = hit.point.clone().addScaledVector(nrm, r * 0.2).sub(specs[piece].at);
      out.push({
        piece,
        id: slot.id,
        p: [loc.x, loc.y, loc.z],
        n: [nrm.x, nrm.y, nrm.z],
        s: [r, r * (0.45 + rand() * 0.25), r * (0.7 + rand() * 0.3)],
        spin: rand() * 6.28,
        color: slot.color,
      });
      n++;
    }
  }
  void q;
  return out;
}

/** 알갱이의 자세 — 노멀을 위로, spin만큼 돌린 쿼터니언 */
export function bitQuaternion(b: Bit, out = new THREE.Quaternion()): THREE.Quaternion {
  out.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(b.n[0], b.n[1], b.n[2]));
  return out.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.spin));
}
