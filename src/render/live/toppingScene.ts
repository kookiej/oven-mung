// 토핑 올리기 화면의 3D — 반죽(placed.ts의 doughSpecs) 그대로에 토핑을 얹는다.
//   틀 빵: 틀에 넣기 단계를 마친 모습 그대로(식빵틀 속 통 반죽, 칸마다 부은 반죽). 파이는 크러스트 안의 필링 — 고른 토핑이 곧 필링
//   트레이 빵: 트레이 무대 앞쪽의 반죽 판 위, 모양 빚기에서 빚은 자리 그대로 — 토핑을 올린 뒤 틀에 넣기 단계(mold)에서
//              조각을 하나씩 트레이로 옮긴다. 그래서 조각마다 그룹(PieceNode)이고 토핑 알갱이·소도 그 그룹에 붙는다.
//   토핑 알갱이: bits.ts의 scatterBits — 같은 seed면 같은 자리이고, 오븐·꺼내기도 같은 알갱이를 쓴다
//   물들이는 재료(녹차·커피…): 반죽 색 자체를 tintedBread로
//   속에 넣는 소(앙금): 반죽 위에 한 숟갈 얹혔다가(reveal 1) 속으로 쏙 들어간다(reveal 0)
import * as THREE from 'three';
import type { BreadDef, DoughLayout, ToppingId } from '../../types';
import { fillingsOf, tintedBread } from '../../content/toppings';
import { bitQuaternion, scatterBits, type Bit } from './bits';
import { Blob } from './geo';
import { batterMaterial, doughMaterial, toonColor } from './materials';
import { doughSpecs, pieFillingColor, type DoughSpec } from './placed';
import type { LiveStage } from './liveStage';

/** 반죽 한 조각 — 그룹째 옮기면 토핑도 같이 움직인다 */
export interface PieceNode {
  group: THREE.Group;
  /** 처음 놓인 자리 (월드) */
  home: THREE.Vector3;
}

export class ToppingScene {
  private root = new THREE.Group();
  readonly pieces: PieceNode[] = [];
  private specs: DoughSpec[];
  /** 토핑이 얹히는 반죽 겉면 */
  private surfaces: THREE.Mesh[] = [];
  private doughMats: (THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial)[] = [];
  private fillingMat: THREE.MeshStandardMaterial | null = null;
  /** 파이 필링 — 처음엔 빈 크러스트이고, 필링을 올리면 차오른다 */
  private fillingMesh: THREE.Mesh | null = null;
  private fillingBase = 0;
  private filled = 1;
  private fillGoal = 1;
  private bits: THREE.InstancedMesh[] = [];
  /** 지금 떨어지고 있는 알갱이들 */
  private drops: { im: THREE.InstancedMesh; list: Bit[]; t: number }[] = [];
  /** 이미 올려 둔 토핑 — 새로 올린 것만 떨어진다 */
  private landed = new Set<string>();
  private dollops: { mesh: THREE.Mesh; at: THREE.Vector3 }[] = [];

  constructor(
    stage: LiveStage,
    private def: BreadDef,
    layout?: DoughLayout,
  ) {
    stage.scene.add(this.root);
    // 빚은 반죽(칼집 금이 정점 색)은 vertexColors, 크러스트는 그냥, 부은 반죽은 무광 크림
    const doughV = doughMaterial(def.doughColor, true);
    const crust = doughMaterial(def.doughColor);
    const batter = batterMaterial(def.doughColor);
    const filling = batterMaterial(pieFillingColor([]));
    filling.roughness = 0.5;
    this.specs = doughSpecs(def, layout);
    const matOf = { dough: doughV, crust, batter, filling };
    for (const d of this.specs) {
      const g = new THREE.Group();
      g.position.copy(d.at);
      this.root.add(g);
      this.pieces.push({ group: g, home: d.at.clone() });
      const m = new THREE.Mesh(d.geo, matOf[d.kind]);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      if (d.surface) this.surfaces.push(m);
      if (d.kind === 'filling') {
        this.fillingMat = filling;
        this.fillingMesh = m;
        d.geo.computeBoundingBox();
        this.fillingBase = d.geo.boundingBox!.min.y;
      }
      else if (!this.doughMats.includes(matOf[d.kind])) this.doughMats.push(matOf[d.kind]);
    }
  }

  /**
   * 반죽 색을 물들이고 알갱이를 흩뿌린다. ids는 고른 토핑 전부(물들이기는 가루가 볼에서 이미 끝났다), active는 지금까지 올린 토핑(없으면 전부).
   * animate면 새로 올린 토핑이 위에서 떨어진다 — update를 매 프레임 불러야 한다
   */
  setToppings(ids: readonly ToppingId[], seed: number, opts: { active?: readonly ToppingId[]; animate?: boolean } = {}): void {
    const { active, animate = false } = opts;
    const tinted = tintedBread(this.def, ids);
    for (const m of this.doughMats) m.color.copy(toonColor(tinted.doughColor, 1.1, 1.05));
    if (this.fillingMat) this.fillingMat.color.copy(toonColor(pieFillingColor(active ?? ids), 1.1, 1.03));
    // 알갱이 — 조각 그룹마다, 색마다 하나의 InstancedMesh
    for (const im of this.bits) {
      im.geometry.dispose();
      (im.material as THREE.Material).dispose();
      im.parent?.remove(im);
    }
    this.bits = [];
    this.drops = [];
    const list = scatterBits(this.def, this.specs, ids, seed, { active });
    const groups = new Map<string, typeof list>();
    for (const b of list) {
      const k = `${b.piece}|${b.color}`;
      const l = groups.get(k);
      if (l) l.push(b);
      else groups.set(k, [b]);
    }
    const M = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (const [, l] of groups) {
      const mat = new THREE.MeshStandardMaterial({ color: toonColor(l[0].color, 1.05, 1.02), roughness: 0.55 });
      const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), mat, l.length);
      im.castShadow = true;
      l.forEach((b, i) => {
        M.compose(new THREE.Vector3(...b.p), bitQuaternion(b, q), new THREE.Vector3(...b.s));
        im.setMatrixAt(i, M);
      });
      im.instanceMatrix.needsUpdate = true;
      this.pieces[l[0].piece].group.add(im);
      this.bits.push(im);
      const key = `${l[0].piece}|${l[0].color}`;
      if (animate && !this.landed.has(key)) this.drops.push({ im, list: l, t: 0 });
      this.landed.add(key);
    }
    // 속에 넣는 소 — 첫 조각 윗면 가운데에 한 숟갈 (파이는 필링 자체가 토핑이라 없다)
    for (const d of this.dollops) {
      d.mesh.geometry.dispose();
      d.mesh.parent?.remove(d.mesh);
    }
    this.dollops = [];
    const fills = this.def.id === 'pie' ? [] : fillingsOf(active ?? ids);
    const first = this.surfaces[0];
    if (fills.length && first) {
      this.root.updateMatrixWorld(true);
      const ray = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      const fb = new THREE.Box3().setFromObject(first);
      const c = fb.getCenter(new THREE.Vector3());
      // 고리(베이글)·초승달(크루아상)은 가운데가 비어 있다 — 앞쪽 몸통에
      const shift = this.def.id === 'bagel' ? (fb.max.z - fb.min.z) * 0.36 : this.def.id === 'croissant' ? -(fb.max.z - fb.min.z) * 0.25 : 0;
      const g = first.parent as THREE.Group;
      fills.forEach((f, i) => {
        const x = c.x + (fills.length > 1 ? (i - 0.5) * 0.025 : 0);
        const z = c.z + shift;
        ray.set(new THREE.Vector3(x, fb.max.y + 0.1, z), down);
        const hit = ray.intersectObjects(this.surfaces, false)[0];
        const at = g.worldToLocal(hit ? hit.point.clone() : new THREE.Vector3(x, fb.max.y, z));
        const b = new Blob(i * 3.1 + 2, 24, 16);
        b.update([0.012, 0.007, 0.011], 0.35, 0.5);
        b.geometry.deleteAttribute('color');
        const m = new THREE.Mesh(b.geometry, new THREE.MeshPhysicalMaterial({ color: toonColor(f.color, 1.05, 1.02), roughness: 0.45, clearcoat: 0.2 }));
        m.castShadow = true;
        g.add(m);
        this.dollops.push({ mesh: m, at });
      });
    }
  }

  /** 파이 필링을 채웠는지 — 비우면 빈 크러스트만 보인다. animate면 update를 따라 차오른다 */
  setFilled(on: boolean, animate = false): void {
    this.fillGoal = on ? 1 : 0;
    if (!animate) this.filled = this.fillGoal;
    this.applyFill();
  }

  private applyFill(): void {
    const m = this.fillingMesh;
    if (!m) return;
    const k = 1 - (1 - this.filled) ** 2;
    m.visible = k > 0.01;
    // 바닥에서부터 차오른다
    m.scale.y = Math.max(0.01, k);
    m.position.y = this.fillingBase * (1 - Math.max(0.01, k));
  }

  /** 새로 올린 토핑이 흩어져 떨어지는 모션 */
  update(dt: number): void {
    if (this.filled !== this.fillGoal) {
      this.filled = this.fillGoal > this.filled ? Math.min(this.fillGoal, this.filled + dt / 0.6) : this.fillGoal;
      this.applyFill();
    }
    if (!this.drops.length) return;
    const M = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const P = new THREE.Vector3();
    const S = new THREE.Vector3();
    for (const d of this.drops) {
      d.t = Math.min(1, d.t + dt / 0.8);
      d.list.forEach((b, i) => {
        const e = Math.min(1, Math.max(0, (d.t - (i / d.list.length) * 0.44) / 0.56));
        const k = Math.min(1, e * 4);
        P.set(b.p[0], b.p[1] + (1 - e) ** 2 * 0.06, b.p[2]);
        S.set(b.s[0] * k + 1e-6, b.s[1] * k + 1e-6, b.s[2] * k + 1e-6);
        M.compose(P, bitQuaternion(b, q), S);
        d.im.setMatrixAt(i, M);
      });
      d.im.instanceMatrix.needsUpdate = true;
    }
    this.drops = this.drops.filter((d) => d.t < 1);
  }

  /** 소가 들어가는 모션 — reveal 1(위에 얹힘) → 0(속에 들어가 안 보임) */
  setFillingReveal(reveal: number): void {
    for (const { mesh, at } of this.dollops) {
      mesh.visible = reveal > 0.01;
      const k = Math.max(0.01, reveal);
      mesh.scale.set(0.6 + 0.4 * k, k, 0.6 + 0.4 * k);
      mesh.position.set(at.x, at.y - (1 - reveal) * 0.008, at.z);
    }
  }
}
