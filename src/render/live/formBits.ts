// 밀어 편 반죽 위의 토핑 — 모양 빚기의 토핑 단계(말거나 접어 빚는 빵). 칩을 올리면 위에서 흩어져 떨어지고,
// 반죽을 말거나 접으면 지나간 자리부터 속으로 들어가 사라진다(sheetCover). 다 빚으면 겉에 드러난 몇 알만 남는다.
import * as THREE from 'three';
import type { BreadDef, ToppingId } from '../../types';
import { getTopping, placedToppings } from '../../content/toppings';
import { seededRandom } from '../../util';
import { bitQuaternion, scatterBits, type Bit } from './bits';
import { toonColor } from './materials';
import type { DoughSpec } from './placed';

/** 흩어져 떨어지는 시간(초) */
const DROP_SEC = 0.45;
/** 알갱이마다 늦게 떨어지는 폭(초) */
const STAGGER_SEC = 0.35;

interface Batch {
  im: THREE.InstancedMesh;
  list: Bit[];
  /** 알갱이 하나씩의 떨어지기 시작하는 시각 — 아직 안 올렸으면 Infinity */
  born: number[];
}

export class FormBits {
  readonly group = new THREE.Group();
  private batches: Batch[] = [];
  private offset = new THREE.Vector3();

  constructor(private def: BreadDef) {}

  private clear(): void {
    for (const b of this.batches) {
      b.im.geometry.dispose();
      (b.im.material as THREE.Material).dispose();
      this.group.remove(b.im);
    }
    this.batches = [];
  }

  private build(list: Bit[], at: THREE.Vector3): void {
    this.clear();
    this.offset.copy(at);
    const byKey = new Map<string, Bit[]>();
    for (const b of list) {
      const k = `${b.id ?? ''}|${b.color}`;
      const l = byKey.get(k);
      if (l) l.push(b);
      else byKey.set(k, [b]);
    }
    for (const [, l] of byKey) {
      const mat = new THREE.MeshStandardMaterial({ color: toonColor(l[0].color, 1.05, 1.02), roughness: 0.55 });
      const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), mat, l.length);
      im.castShadow = true;
      im.frustumCulled = false;
      this.group.add(im);
      this.batches.push({ im, list: l, born: l.map(() => Infinity) });
    }
  }

  /**
   * 판 위 토핑의 자리를 정해 둔다 — put으로 하나씩 올린다. 판이 여럿이면(플랫브레드) 판마다.
   * 앙금 같은 소는 판 가운데에, 가장자리에서 넉넉히 떨어져 놓인다(사용자 요청)
   */
  layout(sheets: THREE.BufferGeometry[], ids: readonly ToppingId[], seed: number): void {
    const specs: DoughSpec[] = sheets.map((geo) => ({ geo, at: new THREE.Vector3(), surface: true, kind: 'dough' }));
    const list = scatterBits(this.def, specs, ids, seed, { sheet: true });
    const rand = seededRandom(seed + 311);
    const fills = placedToppings(ids).filter((p) => p.filling);
    sheets.forEach((sheet, piece) => {
      sheet.computeBoundingBox();
      const box = sheet.boundingBox!;
      // 판의 가운데 — 세모처럼 한쪽으로 치우친 판은 정점의 평균이 무게 중심에 가깝다
      const pos = sheet.getAttribute('position');
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < pos.count; i++) {
        cx += pos.getX(i) / pos.count;
        cz += pos.getZ(i) / pos.count;
      }
      const W = box.max.x - box.min.x;
      const D = box.max.z - box.min.z;
      // 작은 판엔 한 숟갈, 넓은 판엔 가운데 줄에 몇 숟갈 — 판 폭의 가운데 절반 안에서
      const n = Math.max(1, Math.min(4, Math.round(W / 0.06)));
      const k = Math.min(1, Math.min(W, D) / 0.06);
      fills.forEach((t, fi) => {
        for (let j = 0; j < n; j++) {
          list.push({
            piece,
            id: t.id,
            p: [cx + (j - (n - 1) / 2) * ((W * 0.5) / n), box.max.y + 0.0015, cz + (fills.length > 1 ? (fi - 0.5) * D * 0.16 : 0) + (rand() - 0.5) * 0.006 * k],
            n: [0, 1, 0],
            s: [0.016 * k, 0.0055 * k, 0.014 * k],
            spin: rand() * 6.28,
            color: t.color,
          });
        }
      });
    });
    this.build(list, new THREE.Vector3());
  }

  /** 토핑 하나를 올린다 */
  put(id: ToppingId, clock: number): void {
    void getTopping(id);
    for (const b of this.batches) {
      if (b.list[0].id !== id) continue;
      b.born = b.list.map((_, i) => clock + (i / b.list.length) * STAGGER_SEC);
    }
  }

  /** 다 빚은 모양의 겉에 드러난 알갱이 — 오븐이 그대로 이어받는 자리. 알갱이 좌표는 조각 기준이라 조각 자리를 더해 둔다 */
  showFinal(specs: DoughSpec[], ids: readonly ToppingId[], seed: number, clock: number): void {
    const list = scatterBits(this.def, specs, ids, seed).map((b) => {
      const at = specs[b.piece].at;
      return { ...b, p: [b.p[0] + at.x, b.p[1] + at.y, b.p[2] + at.z] as [number, number, number] };
    });
    this.build(list, new THREE.Vector3());
    for (const b of this.batches) b.born = b.list.map(() => clock);
  }

  /** 매 프레임 — cover(x, z) = 지금 단계에서 그 자리의 알갱이가 보이는 정도 */
  update(clock: number, cover: (x: number, z: number) => number): void {
    const M = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const P = new THREE.Vector3();
    const S = new THREE.Vector3();
    for (const b of this.batches) {
      b.list.forEach((bit, i) => {
        const e = Math.min(1, Math.max(0, (clock - b.born[i]) / DROP_SEC));
        const k = Math.min(1, e * 4) * cover(bit.p[0], bit.p[2]);
        P.set(bit.p[0], bit.p[1] + (1 - e) ** 2 * 0.06, bit.p[2]).add(this.offset);
        S.set(bit.s[0] * k + 1e-6, bit.s[1] * k + 1e-6, bit.s[2] * k + 1e-6);
        M.compose(P, bitQuaternion(bit, q), S);
        b.im.setMatrixAt(i, M);
      });
      b.im.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.clear();
  }
}
