// 꺼내기(자르기) 단계의 3D — 오븐에서 구운 그 빵(breadModel.ts의 GLB + 토핑 알갱이)을 그릇에서 꺼내 반죽 판 위에 놓는다.
// 무대는 다른 단계와 같은 반죽 판·같은 시점(stage/cut — 밀가루 없이 깨끗한 판). 빵은 실시간 3D 층에 그린다.
//   컵케이크: 먼저 종이컵을 벗긴다 — 앞쪽부터 벽이 바깥으로 젖혀져 꽃처럼 펼쳐지고, 치워진다(setPeel)
//   자르기: 처음엔 통째다. 긴 빵은 화면에 가로로 놓이고 빵칼은 세로(날이 앞뒤 방향, 손잡이가 앞쪽)로 그 위에 선다.
//           손가락을 위에서 아래로 쓸면 빵칼이 따라 내려간다. 다 잘라도 저절로 벌어지지 않는다 — 가는 틈만 남고,
//           빵을 톡 누르면 왼쪽·오른쪽 두 쪽이 책 펼치듯 돌아누워 자른 면이 보인다(setOpen)
//   메시 나누기: 메시를 평면으로 실제로 나눈다(삼각형을 쪼갠다). 잘린 자리의 선분을 이어 단면 다각형을 만들고
//           삼각분할해 뚜껑(자른 면)을 씌운다. 자른 면은 속살 기공 무늬 + 소(앙금)를 다각형 안쪽에만 그린 텍스처.
//   셰이더: 오븐과 같은 빵 셰이더(breadShader) — 메시 그대로(uStatic), 갈변·물들임이 오븐에서 본 그대로다. 조명만 오븐 밖 빛(uDay).
//   일찍 꺼낸 빵은 덜 부푼 모양 그대로(progress) — 같은 반죽 오브젝트라 그 시점의 모양을 잘라 보여 준다.
import * as THREE from 'three';
import type { BreadDef, ToppingId } from '../types';
import { fillingsOf, placedToppings, tintedBread } from '../content/toppings';
import { rollsIn } from '../content/forming';
import { makeBreadMaterial } from './breadShader';
import type { BitAnchor, BreadModel } from './breadModel';
import type { LiveStage } from './live/liveStage';
import { META } from './sprites';
import { pieFillingColor, pieHollow } from './live/placed';
import { toonColor } from './live/materials';
import { seededRandom } from '../util';

/** 반죽 판 위 빵의 크기(미터) — 가로·깊이 중 큰 쪽. 쿠키든 케이크든 자르기 좋은 크기로 */
const FIT = 0.17;
/** 아주 긴 빵(바게트)의 길이(미터) — 가로로 놓이니 판에 넉넉히 들어가고, 가늘어서 이만큼은 되어야 자른 면이 보인다 */
const FIT_LONG = 0.26;
/** 자르는 평면 x — 가운데에서 아주 살짝 비킨 자리. 긴 빵은 메시가 가로(x)로 길어서 길이를 가로지르는 면이 된다 */
const CUT_X = 0.00017;
/** 자른 면을 카메라 쪽으로 돌리는 정도 — 1이면 완전 정면 */
const OPEN_FACE = 0.64;
/** 빵칼을 옆으로 눕힌 각도 — 0이면 판에 곧게 선다(사용자 요청: 비스듬히 기울이지 않는다) */
const KNIFE_ROLL = 0;
const ease = (t: number) => t * t * (3 - 2 * t);

type V3 = [number, number, number];

interface Half {
  group: THREE.Group;
  /** -1 왼쪽 반, 1 오른쪽 반 */
  side: -1 | 1;
}

export class CutScene {
  private root = new THREE.Group();
  private halves: Half[] = [];
  private knife = new THREE.Group();
  private liner: { mesh: THREE.Mesh; peel: { value: number } } | null = null;
  private breadMats: ReturnType<typeof makeBreadMaterial>[] = [];
  private baseY: number;
  private top: number;
  /** 벌렸을 때의 자세 */
  private tilt = 0;
  private lift = 0;
  private gapX = 0;
  private shiftZ = 0;

  constructor(
    private stage: LiveStage,
    def: BreadDef,
    toppingIds: readonly ToppingId[],
    seed: number,
    browning: number,
    model: BreadModel,
    /** 꺼낸 시점의 굽기 진행도 — 덜 구웠으면 덜 부푼 모양 */
    progress: number,
    /** 굽는 중간에 낸 칼집이 벌어진 정도 (1이면 메시 그대로) */
    scoreOpen = 1,
  ) {
    stage.scene.add(this.root);
    this.baseY = META.stage.cut?.topY ?? 0.022;

    const picked = pickOne(model);
    const { breads, bits } = picked;
    // 토핑 없는 파이는 속이 비어 있다 — 필링을 자르지 않는다
    const extras = pieHollow(def, toppingIds) ? picked.extras.filter((m) => !m.name.includes('필링')) : picked.extras;
    // 꺼낸 시점의 모양 — 오븐 셰이더와 같은 식으로 정점을 옮겨 둔다(그래야 자른 면이 껍질과 맞는다)
    for (const m of breads) {
      closeScore(m, scoreOpen);
      settleAt(m, progress);
    }
    const bitsAt = bits.map((b) => settleBit(b, progress));

    const k = fitTo([...breads, ...extras], bitsAt, this.baseY);
    void k;
    const box = boxOf([...breads, ...extras]);
    this.top = box.max.y;
    const size = box.getSize(new THREE.Vector3());

    // 빵 셰이더 — 메시 그대로, 오븐 밖 조명. 토핑 알갱이는 3D로 따로
    const tinted = tintedBread(def, toppingIds);
    for (const side of [-1, 1] as const) {
      const g = new THREE.Group();
      this.root.add(g);
      this.halves.push({ group: g, side });
    }
    const fills = fillingsOf(toppingIds);
    // 종이컵은 자르지 않는다 — 먼저 벗긴다
    const linerSrc = extras.find((m) => m.name.includes('컵받침'));
    const cuttable = [...breads, ...extras.filter((m) => m !== linerSrc)];
    // 평면을 가운데에서 아주 살짝 비킨다 — 대칭으로 만든 메시는 가운데 줄에 정점이 놓여 평면을 가로지르는 삼각형이 없다
    const splits = cuttable.map((m) => splitAt(m.geometry as THREE.BufferGeometry, CUT_X));
    // 소는 단면이 가장 두툼한 메시에 (파이는 토핑이 곧 필링이라 없다)
    const depthOf = (sp: Split) => Math.max(0, ...nest(sp.loops).map(({ outer, holes }) => deepest(outer, holes)?.r ?? 0));
    const main = cuttable[splits.map(depthOf).reduce((bi, d, i, arr) => (d > arr[bi] ? i : bi), 0)];
    cuttable.forEach((src, si) => {
      const isBread = breads.includes(src);
      const geo = src.geometry as THREE.BufferGeometry;
      const parts = splits[si];
      const filling = src.name.includes('필링');
      let mat: THREE.Material;
      if (isBread) {
        const m = makeBreadMaterial(def, toppingIds, seed);
        const b = geo.boundingBox!;
        m.uniforms.uProgress.value = 1;
        m.uniforms.uBrowning.value = browning;
        m.uniforms.uStatic.value = 1;
        m.uniforms.uDay.value = 1;
        m.uniforms.uScoreOpen.value = 1; // 칼집은 closeScore가 메시에 이미 구워 넣었다
        this.breadMats.push(m);
        m.uniforms.uGrid.value = 0;
        m.uniforms.uTopDen.value = m.uniforms.uTopDen.value.map(() => 0);
        m.uniforms.uBaseY.value = b.min.y;
        m.uniforms.uTopY.value = b.max.y;
        mat = m;
      } else {
        const m = (src.material as THREE.MeshStandardMaterial).clone();
        if (filling) m.color.copy(toonColor(pieFillingColor(toppingIds), 1.1, 1.03));
        m.side = THREE.DoubleSide;
        mat = m;
      }
      // 자른 면 — 닫힌 단면이 있는 메시만
      let capMat: THREE.Material | null = null;
      if (parts.loops.length) {
        const tex = crumbTexture(
          filling ? pieFillingColor(toppingIds) : tinted.crumbColor,
          parts.loops,
          src === main && def.id !== 'pie' ? fills.map((f) => f.color) : [],
          seed,
          filling,
          // 말거나 접어 빚은 빵 — 토핑이 속살에 박혀 있다 (나선 결은 그리지 않는다 — 사용자 요청)
          rollsIn(def) && !filling ? placedToppings(toppingIds).filter((t) => !t.filling).map((t) => t.color) : [],
        );
        capMat = new THREE.MeshStandardMaterial({ map: tex, roughness: filling ? 0.45 : 0.9 });
      }
      for (const h of this.halves) {
        const pg = h.side < 0 ? parts.left : parts.right;
        if (pg.getAttribute('position').count === 0) continue;
        const mesh = new THREE.Mesh(pg, mat);
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        h.group.add(mesh);
        if (capMat) {
          const cap = capGeometry(parts.loops, h.side);
          const cm = new THREE.Mesh(cap, capMat);
          cm.castShadow = true;
          h.group.add(cm);
        }
      }
    });
    // 속이 빈 파이 — 격자 아래 빈 속은 그늘이 진다. 그대로면 밝게 비친 크러스트 바닥 안쪽이 필링처럼 보인다(사용자 요청: 필링이 없어야 한다)
    const crust = pieHollow(def, toppingIds) ? breads.find((m) => m.name.includes('바닥')) : undefined;
    if (crust) {
      const b = (crust.geometry as THREE.BufferGeometry).boundingBox!;
      // Blender build_pie의 바닥 크러스트: 밑 0.0026 · 안쪽 바닥 0.0071 · 테 꼭대기 약 0.0284, 안쪽 벽 반지름 약 0.096 / 바깥 0.11
      const floorY = b.min.y + ((0.0071 - 0.0026) / (0.0284 - 0.0026)) * (b.max.y - b.min.y);
      const r = ((b.max.x - b.min.x) / 2) * 0.87;
      const shade = new THREE.MeshBasicMaterial({ color: '#2a160b', transparent: true, opacity: 0.5, depthWrite: false });
      for (const h of this.halves) {
        const disc = new THREE.CircleGeometry(r, 64, h.side < 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI);
        disc.rotateX(-Math.PI / 2);
        disc.translate((b.min.x + b.max.x) / 2, floorY + 0.0006, (b.min.z + b.max.z) / 2);
        h.group.add(new THREE.Mesh(disc, shade));
      }
    }
    for (const m of cuttable) m.geometry.dispose();

    // 토핑 알갱이 — 앉은 쪽 반으로
    this.addBits(bitsAt, browning);

    // 종이컵
    if (linerSrc) {
      const g = linerSrc.geometry as THREE.BufferGeometry;
      g.computeBoundingBox();
      this.liner = peelingLiner(g, linerSrc.material as THREE.MeshStandardMaterial);
      this.root.add(this.liner.mesh);
    }

    // 벌렸을 때 — 자른 면을 카메라 쪽으로 눕혀 거의 정면에서 보이게 한다(완전 정면은 아니다 — 사용자 요청).
    // 카메라가 판을 내려다보는 각도의 OPEN_FACE만큼 눕히고, 뒤로 넘어간 몸통이 판에 덜 묻히게 들어 올린다 — 다 들어 올리면
    // 빵이 공중에 뜬 것처럼 보여서 조금만(뒤 끝은 판에 가려진다)
    // 돌아누운 뒤의 크기: 가로는 메시의 z, 깊이의 절반은 메시의 x 절반
    const halfDepth = size.x / 2;
    const view = new THREE.Vector3();
    stage.camera.getWorldDirection(view);
    this.tilt = Math.asin(Math.min(1, Math.max(0, -view.y))) * OPEN_FACE;
    this.lift = halfDepth * Math.sin(this.tilt) * 0.6;
    this.gapX = size.z / 2 + 0.012;
    this.shiftZ = halfDepth * 0.6 * Math.cos(this.tilt);

    this.buildKnife(size.z);
    this.setKnife(true, 0, 0, 0);
    this.setOpen(0);
  }

  private addBits(bits: readonly BitAnchor[], browning: number): void {
    const dark = 1 - ease(Math.min(1, Math.max(0, (browning - 0.5) / 1.1))) * 0.35;
    const M = new THREE.Matrix4();
    for (const h of this.halves) {
      const mine = bits.filter((b) => (h.side < 0 ? b.to[0] < CUT_X : b.to[0] >= CUT_X));
      const byColor = new Map<string, BitAnchor[]>();
      for (const b of mine) {
        const key = b.color.join();
        const l = byColor.get(key);
        if (l) l.push(b);
        else byColor.set(key, [b]);
      }
      for (const [, l] of byColor) {
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.55 });
        mat.color.setRGB(l[0].color[0] * dark, l[0].color[1] * dark, l[0].color[2] * dark);
        const im = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), mat, l.length);
        im.castShadow = true;
        im.frustumCulled = false;
        l.forEach((b, i) => {
          M.compose(new THREE.Vector3(...b.to), new THREE.Quaternion(...b.quat), new THREE.Vector3(...b.scale));
          im.setMatrixAt(i, M);
        });
        im.instanceMatrix.needsUpdate = true;
        h.group.add(im);
      }
    }
  }

  /** 빵칼 — 톱니 날이 긴 빵칼. 화면에 세로로 선다: 날이 앞뒤(z) 방향, 칼끝이 안쪽, 손잡이가 앞쪽. 원점은 날 가운데 아래 */
  private buildKnife(span: number): void {
    const L = Math.max(0.17, span * 1.25);
    const H = 0.026;
    const teeth = 24;
    const sh = new THREE.Shape();
    // 칼끝(왼쪽 둥글게) → 톱니 날(아래, 오른쪽으로) → 턱 → 등(위, 왼쪽으로)
    sh.moveTo(-L / 2, H * 0.55);
    sh.quadraticCurveTo(-L / 2, 0.002, -L / 2 + 0.012, 0);
    const x0 = -L / 2 + 0.012;
    const step = (L - 0.012) / teeth;
    for (let i = 0; i < teeth; i++) {
      // 물결 모양 톱니 — 오목하게 파인 조각이 줄지어 있다
      sh.quadraticCurveTo(x0 + step * (i + 0.5), 0.0034, x0 + step * (i + 1), 0);
    }
    sh.lineTo(L / 2, H);
    sh.lineTo(-L / 2 + 0.03, H);
    sh.quadraticCurveTo(-L / 2 + 0.006, H, -L / 2, H * 0.55);
    // 곧게 서면 카메라에 칼날 등이 보인다 — 너무 얇으면 선 하나로 사라져 조금 두툼하게
    const bladeGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.0022, bevelEnabled: false, curveSegments: 6 });
    bladeGeo.translate(0, 0, -0.0011);
    const blade = new THREE.Mesh(bladeGeo, new THREE.MeshStandardMaterial({ color: '#dfe5e7', metalness: 0.35, roughness: 0.28 }));
    blade.castShadow = true;
    // 손잡이 — 둥근 나무 자루와 쇠 징 둘
    const hLen = 0.1;
    const hs = new THREE.Shape();
    const hh = 0.0115;
    hs.moveTo(0, -hh);
    hs.lineTo(hLen - hh, -hh);
    hs.quadraticCurveTo(hLen, -hh, hLen, 0);
    hs.quadraticCurveTo(hLen, hh, hLen - hh, hh);
    hs.lineTo(0, hh);
    hs.closePath();
    const handleGeo = new THREE.ExtrudeGeometry(hs, { depth: 0.008, bevelEnabled: true, bevelSize: 0.0025, bevelThickness: 0.0025, bevelSegments: 3, curveSegments: 8 });
    handleGeo.translate(L / 2, H * 0.62, -0.004);
    const handle = new THREE.Mesh(handleGeo, new THREE.MeshStandardMaterial({ color: toonColor('#8a5a34', 1.05, 1.02), roughness: 0.6 }));
    handle.castShadow = true;
    this.knife.add(blade, handle);
    for (const x of [0.028, 0.072]) {
      const rivet = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0024, 0.0024, 0.0135, 12),
        new THREE.MeshStandardMaterial({ color: '#c9cdd0', metalness: 0.4, roughness: 0.3 }),
      );
      rivet.rotation.x = Math.PI / 2;
      rivet.position.set(L / 2 + x, H * 0.62, 0);
      this.knife.add(rivet);
    }
    // 칼날(지금 x 방향)을 앞뒤 방향으로 돌려 곧게 세운다 — 자르는 면과 같은 평면(기울이지 않는다, 사용자 요청)
    this.knife.rotation.order = 'ZYX';
    this.knife.rotation.set(0, -Math.PI / 2, -KNIFE_ROLL);
    this.stage.scene.add(this.knife);
  }

  /** 슈가파우더 0~1 — 위를 향한 면에 하얗게 내려앉는다 */
  setSugar(v: number): void {
    for (const m of this.breadMats) m.uniforms.uSugar.value = v;
  }

  get hasLiner(): boolean {
    return !!this.liner;
  }

  /** 종이컵 벗기기 0~1 — 앞쪽부터 벽이 바깥으로 젖혀진다. gone 0~1은 다 벗긴 컵이 치워지는 정도 */
  setPeel(t: number, gone = 0): void {
    if (!this.liner) return;
    this.liner.peel.value = t;
    const m = this.liner.mesh;
    m.position.x = ease(gone) * 0.24;
    m.position.y = Math.sin(gone * Math.PI) * 0.02;
    m.visible = gone < 1;
  }

  /** 빵칼 — depth 0(빵 위) ~ 1(판까지), saw는 앞뒤로 써는 양, away 0~1은 위로 빠져나간 정도 */
  setKnife(visible: boolean, depth = 0, saw = 0, away = 0): void {
    this.knife.visible = visible && away < 1;
    const y = this.top + 0.012 + (this.baseY + 0.0008 - this.top - 0.012) * depth;
    this.knife.position.set(CUT_X, y + ease(away) * 0.22, saw * 0.03 + away * 0.05);
  }

  /** 다 자른 뒤의 가는 틈 — 저절로 벌어지지 않는다 */
  setSeam(on: boolean): void {
    for (const h of this.halves) h.group.position.x = on ? h.side * 0.0011 : 0;
  }

  /** 자른 면 보기 0(붙어 있음) ~ 1(나란히 돌아누워 자른 면이 보임). 두 쪽이 책 펼치듯 자른 면을 앞으로 돌린다 */
  setOpen(t: number): void {
    const e = ease(t);
    const P = new THREE.Vector3(0, this.baseY, 0);
    const up = new THREE.Vector3(0, 1, 0);
    const rx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.tilt);
    for (const h of this.halves) {
      if (t <= 0) break;
      // 왼쪽 반의 자른 면(+x)도 오른쪽 반의 자른 면(-x)도 앞(+z)을 보게
      const target = rx.clone().multiply(new THREE.Quaternion().setFromAxisAngle(up, (h.side * Math.PI) / 2));
      h.group.quaternion.identity().slerp(target, e);
      // 도는 만큼 옆으로 비킨다 — 뒤쪽 끝이 서로 파고들지 않게
      const to = new THREE.Vector3(h.side * this.gapX * Math.sin((e * Math.PI) / 2), this.baseY + this.lift * e, this.shiftZ * e);
      h.group.position.copy(to).sub(P.clone().applyQuaternion(h.group.quaternion));
    }
  }

  /** 화면 좌표(캔버스 CSS 픽셀)의 세로 자리 → 칼이 내려간 정도 0~1 */
  depthAt(py: number): number {
    const a = this.stage.project(new THREE.Vector3(0, this.top, 0));
    const b = this.stage.project(new THREE.Vector3(0, this.baseY, 0));
    return Math.min(1, Math.max(0, (py - a.y) / Math.max(b.y - a.y, 1)));
  }

  /** 빵 위를 눌렀는지 (화면 좌표) */
  hit(px: number, py: number): boolean {
    const c = this.stage.project(new THREE.Vector3(0, (this.baseY + this.top) / 2, 0));
    return Math.hypot(px - c.x, py - c.y) < this.stage.box.size * 0.28;
  }
}

/** 종이컵 — 정점 셰이더가 벽을 바닥 둘레를 축으로 바깥으로 젖힌다. 앞쪽(+z)에서 시작해 뒤로 번진다 */
function peelingLiner(g: THREE.BufferGeometry, src: THREE.MeshStandardMaterial): { mesh: THREE.Mesh; peel: { value: number } } {
  const b = g.boundingBox!;
  const c = new THREE.Vector2((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2);
  const w = (b.max.x - b.min.x) / 2;
  const peel = { value: 0 };
  const mat = src.clone();
  mat.side = THREE.DoubleSide;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPeel = peel;
    sh.uniforms.uPeelC = { value: c };
    // 바닥 반지름은 위쪽 반지름의 약 0.69 (render_cartoon.build_cupcakes: 0.0242 / 0.0352)
    sh.uniforms.uPeelB = { value: w * 0.69 };
    sh.uniforms.uPeelY = { value: b.min.y };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uPeel;\nuniform vec2 uPeelC;\nuniform float uPeelB;\nuniform float uPeelY;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  vec2 rel = transformed.xz - uPeelC;
  float rr = length(rel);
  if (rr > uPeelB * 0.97) {
    float d = abs(atan(rel.x, rel.y)) / 3.14159;
    float ang = smoothstep(d, d + 0.45, uPeel * 1.45) * 2.5;
    float h0 = transformed.y - uPeelY;
    float o0 = rr - uPeelB;
    float r2 = uPeelB + o0 * cos(ang) + h0 * sin(ang);
    transformed.xz = uPeelC + rel / rr * r2;
    transformed.y = max(uPeelY + h0 * cos(ang) - o0 * sin(ang), uPeelY + 0.0004);
  }`,
      );
  };
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  return { mesh, peel };
}

/** 칼집을 덜 벌어진 만큼 메시에서 되돌린다 — open 0이면 매끈한 윗면 (오븐 셰이더의 scoreClosed와 같은 식) */
function closeScore(m: THREE.Mesh, open: number): void {
  const g = m.geometry as THREE.BufferGeometry;
  const sy = g.getAttribute('scoreY') as THREE.BufferAttribute | undefined;
  if (!sy || open >= 1) return;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const toast = g.getAttribute('toast') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const s = sy.getX(i);
    if (s === 0) continue;
    pos.setY(i, pos.getY(i) - s * (1 - open));
    const k = (1 - open) * Math.min(1, Math.abs(s) * 150);
    const nx = lerp(nrm.getX(i), 0, k);
    const ny = lerp(nrm.getY(i), 1, k);
    const nz = lerp(nrm.getZ(i), 0, k);
    const len = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(i, nx / len, ny / len, nz / len);
    toast.setX(i, lerp(toast.getX(i), 1, k));
  }
  g.computeBoundingBox();
}

/** 오븐 셰이더의 부풀기와 같은 식 — 꺼낸 시점(progress)의 모양을 정점에 굽는다 */
function settleAt(m: THREE.Mesh, progress: number): void {
  const g = m.geometry as THREE.BufferGeometry;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const dp = g.getAttribute('aDough') as THREE.BufferAttribute | undefined;
  const dn = g.getAttribute('aDoughN') as THREE.BufferAttribute | undefined;
  if (!dp || !dn || progress >= 0.9) return;
  const b = g.boundingBox!;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const hw = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
  for (let i = 0; i < pos.count; i++) {
    const e = Math.min(1, Math.hypot(pos.getX(i) - cx, pos.getZ(i) - cz) / Math.max(hw, 0.01));
    const k = sstep(0.02 + 0.14 * e * e, 0.8 + 0.06 * e, progress);
    pos.setXYZ(i, lerp(dp.getX(i), pos.getX(i), k), lerp(dp.getY(i), pos.getY(i), k), lerp(dp.getZ(i), pos.getZ(i), k));
    const nx = lerp(dn.getX(i), nrm.getX(i), k);
    const ny = lerp(dn.getY(i), nrm.getY(i), k);
    const nz = lerp(dn.getZ(i), nrm.getZ(i), k);
    const len = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(i, nx / len, ny / len, nz / len);
  }
  g.computeBoundingBox();
}

function settleBit(b: BitAnchor, progress: number): BitAnchor {
  const e = Math.min(1, Math.hypot(b.to[0] - b.bread[0], b.to[2] - b.bread[1]) / Math.max(b.bread[2], 0.01));
  const k = progress >= 0.9 ? 1 : sstep(0.02 + 0.14 * e * e, 0.8 + 0.06 * e, progress);
  return { ...b, to: [lerp(b.from[0], b.to[0], k), lerp(b.from[1], b.to[1], k), lerp(b.from[2], b.to[2], k)] };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (e0: number, e1: number, x: number) => ease(Math.min(1, Math.max(0, (x - e0) / (e1 - e0))));

// ---------------------------------------------------------------- 빵 하나 고르기·맞추기
/** 여러 개 구운 빵(쿠키 6개, 컵케이크 6개…)에서 한 덩이 — 그 빵 껍질과 같은 자리의 소품(종이컵·필링)·토핑 알갱이 */
function pickOne(model: BreadModel): { breads: THREE.Mesh[]; extras: THREE.Mesh[]; bits: BitAnchor[] } {
  const centerOf = (m: THREE.Mesh) => {
    const b = (m.geometry as THREE.BufferGeometry).boundingBox!;
    return new THREE.Vector2((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2);
  };
  const halfOf = (m: THREE.Mesh) => {
    const b = (m.geometry as THREE.BufferGeometry).boundingBox!;
    return Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
  };
  const all = boxOf(model.breads);
  const mid = new THREE.Vector2((all.min.x + all.max.x) / 2, (all.min.z + all.max.z) / 2);
  // 가장 큰 껍질 중 가운데에 가장 가까운 것 — 파이처럼 여러 메시가 한 빵이면 바닥 크러스트
  const big = Math.max(...model.breads.map(halfOf));
  const seedMesh = model.breads
    .filter((m) => halfOf(m) > big * 0.6)
    .sort((a, b) => centerOf(a).distanceTo(mid) - centerOf(b).distanceTo(mid))[0];
  const c = centerOf(seedMesh);
  const r = halfOf(seedMesh);
  const near = (m: THREE.Mesh) => centerOf(m).distanceTo(c) < r * 0.9;
  const clone = (m: THREE.Mesh) => {
    const n = new THREE.Mesh((m.geometry as THREE.BufferGeometry).clone(), m.material);
    n.name = m.name;
    n.geometry.computeBoundingBox();
    return n;
  };
  return {
    breads: model.breads.filter(near).map(clone),
    extras: model.others.filter((m) => m.name.startsWith('extra_') && near(m)).map(clone),
    bits: model.bits.filter((b) => Math.hypot(b.to[0] - c.x, b.to[2] - c.y) < r * 1.1),
  };
}

/** 가운데를 원점, 바닥을 baseY, 가로·깊이 중 큰 쪽을 FIT(아주 긴 빵은 FIT_LONG)으로 — 토핑 알갱이도 같이 */
function fitTo(meshes: THREE.Mesh[], bits: BitAnchor[], baseY: number): number {
  const b = boxOf(meshes);
  const long = Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 1e-6);
  const short = Math.max(Math.min(b.max.x - b.min.x, b.max.z - b.min.z), 1e-6);
  const k = (long / short > 2.5 ? FIT_LONG : FIT) / long;
  const m = new THREE.Matrix4()
    .makeScale(k, k, k)
    .premultiply(new THREE.Matrix4().makeTranslation(-((b.min.x + b.max.x) / 2) * k, baseY - b.min.y * k, -((b.min.z + b.max.z) / 2) * k));
  for (const mesh of meshes) {
    const g = mesh.geometry as THREE.BufferGeometry;
    g.applyMatrix4(m);
    g.computeBoundingBox();
  }
  const v = new THREE.Vector3();
  for (const bit of bits) {
    v.set(...bit.to).applyMatrix4(m);
    bit.to = [v.x, v.y, v.z];
    bit.scale = [bit.scale[0] * k, bit.scale[1] * k, bit.scale[2] * k];
  }
  return k;
}

function boxOf(meshes: THREE.Mesh[]): THREE.Box3 {
  const b = new THREE.Box3();
  for (const m of meshes) {
    const g = m.geometry as THREE.BufferGeometry;
    if (!g.boundingBox) g.computeBoundingBox();
    b.union(g.boundingBox!);
  }
  return b;
}

// ---------------------------------------------------------------- 메시를 평면으로 나누기
interface Split {
  left: THREE.BufferGeometry;
  right: THREE.BufferGeometry;
  /** 단면 고리들 — 자르는 평면 위의 (y, z) 점 */
  loops: [number, number][][];
}

/** x = cx 평면으로 메시를 나눈다. 평면을 가로지르는 삼각형은 쪼개고, 잘린 자리의 선분으로 단면 고리를 잇는다 */
function splitAt(src: THREE.BufferGeometry, cx: number): Split {
  const geo = src.index ? src.toNonIndexed() : src;
  // position이 맨 앞 — 교점(v[...][0])과 순서 비교가 위치를 쓴다
  const names = ['position', ...Object.keys(geo.attributes).filter((n) => n !== 'position')];
  const attrs = names.map((n) => geo.getAttribute(n) as THREE.BufferAttribute);
  const out = { left: names.map(() => [] as number[]), right: names.map(() => [] as number[]) };
  const segs: [V3, V3][] = [];
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  /** 정점 i의 모든 속성 */
  const vert = (i: number) => attrs.map((a) => Array.from({ length: a.itemSize }, (_, k) => a.array[i * a.itemSize + k] as number));
  const lerpV = (a: number[][], b: number[][], t: number) => a.map((arr, j) => arr.map((v, k) => v + (b[j][k] - v) * t));
  const push = (side: 'left' | 'right', ...vs: number[][][]) => {
    for (const v of vs) v.forEach((arr, j) => out[side][j].push(...arr));
  };
  for (let t = 0; t < n; t += 3) {
    const v = [vert(t), vert(t + 1), vert(t + 2)];
    const d = [pos.getX(t) - cx, pos.getX(t + 1) - cx, pos.getX(t + 2) - cx];
    const neg = d.filter((x) => x < 0).length;
    if (neg === 3 || (neg > 0 && d.every((x) => x <= 0))) {
      push('left', ...v);
      continue;
    }
    if (neg === 0) {
      push('right', ...v);
      continue;
    }
    // 한쪽에 홀로 남은 꼭짓점 i
    const lone = neg === 1 ? d.findIndex((x) => x < 0) : d.findIndex((x) => x >= 0);
    const j = (lone + 1) % 3;
    const k = (lone + 2) % 3;
    // 같은 모서리는 이웃 삼각형에서도 똑같은 순서로 계산해야 교점이 비트 단위로 같다 — 고리를 이을 때 끝점이 맞물린다
    const cut = (a: number, b: number) =>
      before(v[a][0], v[b][0]) ? lerpV(v[a], v[b], d[a] / (d[a] - d[b])) : lerpV(v[b], v[a], d[b] / (d[b] - d[a]));
    const Ij = cut(lone, j);
    const Ik = cut(lone, k);
    const loneSide = d[lone] < 0 ? 'left' : 'right';
    const other = loneSide === 'left' ? 'right' : 'left';
    push(loneSide, v[lone], Ij, Ik);
    push(other, Ij, v[j], v[k], Ij, v[k], Ik);
    segs.push([Ij[0] as V3, Ik[0] as V3]);
  }
  const build = (side: 'left' | 'right') => {
    const g = new THREE.BufferGeometry();
    names.forEach((nm, j) => g.setAttribute(nm, new THREE.Float32BufferAttribute(out[side][j], attrs[j].itemSize)));
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
  };
  return { left: build('left'), right: build('right'), loops: chain(segs) };
}

/** 잘린 선분들을 이어 닫힌 고리로 — 끝점을 아주 가까운 것끼리 같은 점으로 본다. 닫히지 않는 사슬은 버린다 */
/** 두 점의 정해진 순서 (x → y → z) */
function before(a: number[], b: number[]): boolean {
  return a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
}

function chain(segs: [V3, V3][]): [number, number][][] {
  if (!segs.length) return [];
  let span = 0;
  for (const [a, b] of segs) span = Math.max(span, Math.abs(a[1]), Math.abs(a[2]), Math.abs(b[1]), Math.abs(b[2]));
  const eps = Math.max(span, 1e-3) * 2e-5;
  const key = (p: V3) => `${Math.round(p[1] / eps)},${Math.round(p[2] / eps)}`;
  const adj = new Map<string, number[]>();
  segs.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      const k = key(p);
      const l = adj.get(k);
      if (l) l.push(i);
      else adj.set(k, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops: [number, number][][] = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const startKey = key(segs[s][0]);
    const loop: [number, number][] = [[segs[s][0][1], segs[s][0][2]]];
    let cur = segs[s][1];
    let closed = false;
    for (let guard = 0; guard < segs.length + 2; guard++) {
      const k = key(cur);
      if (k === startKey) {
        closed = true;
        break;
      }
      loop.push([cur[1], cur[2]]);
      const next = (adj.get(k) ?? []).find((i) => !used[i]);
      if (next === undefined) break;
      used[next] = 1;
      const [a, b] = segs[next];
      cur = key(a) === k ? b : a;
    }
    if (closed && loop.length >= 3 && Math.abs(area(loop)) > eps * eps * 100) loops.push(loop);
  }
  return loops;
}

function area(p: readonly [number, number][]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

function inside(pt: [number, number], poly: readonly [number, number][]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 고리들 → 바깥 고리마다 그 안의 구멍들 (다른 고리 안에 홀수 번 들어 있으면 구멍) */
function nest(loops: [number, number][][]): { outer: [number, number][]; holes: [number, number][][] }[] {
  const depth = loops.map((l, i) => loops.filter((o, j) => j !== i && inside(l[0], o)).length);
  const shapes = loops.map((l, i) => ({ l, i })).filter(({ i }) => depth[i] % 2 === 0);
  return shapes.map(({ l, i }) => ({
    outer: l,
    holes: loops.filter((h, j) => depth[j] === depth[i] + 1 && inside(h[0], l)),
  }));
}

/** 자른 면 — 평면 x = 0에 씌우는 뚜껑. side쪽 반의 바깥(왼쪽 반은 +x, 오른쪽 반은 -x)을 본다. uv = (z, y) */
function capGeometry(loops: [number, number][][], side: -1 | 1): THREE.BufferGeometry {
  const P: number[] = [];
  const N: number[] = [];
  const UV: number[] = [];
  const nx = -side; // 왼쪽 반(-1)의 자른 면은 +x를 본다
  const off = nx * 0.00008; // 껍질과 겹쳐 깜박이지 않게 아주 살짝 바깥으로
  const bb = boundsOf(loops);
  for (const { outer, holes } of nest(loops)) {
    const toV = (l: [number, number][]) => {
      const v = l.map(([y, z]) => new THREE.Vector2(z, y));
      return THREE.ShapeUtils.isClockWise(v) ? v : v.reverse();
    };
    const contour = toV(outer);
    const hs = holes.map((h) => toV(h).reverse());
    const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
    const pts = [...contour, ...hs.flat()];
    for (const [a, b, c] of tris) {
      // 감는 방향을 바깥 노멀(nx, 0, 0)에 맞춘다
      const pa = pts[a];
      const pb = pts[b];
      const pc = pts[c];
      // (x, y, z) = (off, v.y, v.x). 노멀 x 성분 = (b-a)×(c-a)의 x = (yb-ya)(zc-za) - (zb-za)(yc-ya)
      const cxn = (pb.y - pa.y) * (pc.x - pa.x) - (pb.x - pa.x) * (pc.y - pa.y);
      const order = cxn * nx >= 0 ? [pa, pb, pc] : [pa, pc, pb];
      for (const p of order) {
        P.push(CUT_X + off, p.y, p.x);
        N.push(nx, 0, 0);
        UV.push((p.x - bb.z0) / bb.s, (p.y - bb.y0) / bb.s);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  return g;
}

function boundsOf(loops: [number, number][][]): { y0: number; z0: number; s: number } {
  let y0 = Infinity;
  let y1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const l of loops)
    for (const [y, z] of l) {
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
  return { y0, z0, s: Math.max(y1 - y0, z1 - z0, 1e-6) };
}

// ---------------------------------------------------------------- 자른 면 텍스처
/**
 * 속살 — 고운 기공이 숭숭 난 면. 속에 넣은 소(앙금)는 단면 다각형 안쪽 깊숙한 자리에 몽글하게 —
 * 다각형 안쪽으로 물러난 거리 안에서만 그려 빵 밖으로 삐져나오지 않는다. uv = (z, y)를 가장 긴 변으로 나눈 값
 */
function crumbTexture(color: string, loops: [number, number][][], fills: string[], seed: number, plain: boolean, chips: string[] = []): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const bb = boundsOf(loops);
  const toPx = (y: number, z: number): [number, number] => [((z - bb.z0) / bb.s) * S, S - ((y - bb.y0) / bb.s) * S];
  const base = toonColor(color, 1.1, 1.04);
  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, S, S);
  const rand = seededRandom(seed + 7);
  if (!plain) {
    // 기공 — 작고 납작한 타원, 가운데가 조금 더 성기다
    const dark = base.clone().multiply(new THREE.Color(0.9, 0.82, 0.7));
    g.fillStyle = `#${dark.getHexString()}`;
    for (let i = 0; i < 900; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const r = 1.5 + rand() ** 2 * 6;
      g.beginPath();
      g.ellipse(x, y, r, r * (0.55 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 260; i++) {
      g.beginPath();
      g.arc(rand() * S, rand() * S, 1 + rand() * 2, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    // 필링 — 조린 사과 조각이 군데군데
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(255,${200 + rand() * 40},120,${0.18 + rand() * 0.2})`;
      g.beginPath();
      g.ellipse(rand() * S, rand() * S, 6 + rand() * 12, 4 + rand() * 7, rand() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  const bbTop = 1 - boundsHeight(loops) / bb.s;
  const bbBot = 1;
  const bbRight = boundsWidth(loops) / bb.s;
  // 속으로 들어간 토핑 — 말거나 접을 때 반죽 사이에 박힌 알갱이
  for (const col of chips) {
    g.fillStyle = `#${toonColor(col, 1.05, 1.02).getHexString()}`;
    for (let i = 0; i < 26; i++) {
      const x = S * bbRight * rand();
      const y = S * (bbTop + (bbBot - bbTop) * rand());
      const r = S * (0.012 + rand() * 0.016);
      g.beginPath();
      g.ellipse(x, y, r, r * (0.6 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  }
  // 소 — 고리마다(베이글 단면은 두 동그라미) 가장 깊은 자리에
  if (fills.length) {
    for (const { outer, holes } of nest(loops)) {
      const pole = deepest(outer, holes);
      if (!pole || pole.r <= 0) continue;
      const [px, py] = toPx(pole.y, pole.z);
      const R = (pole.r / bb.s) * S;
      // 겉껍질에서 넉넉히 물러난 반지름 — 빵 밖으로 나가지 않는다
      fills.forEach((col, i) => {
        const rr = R * (fills.length > 1 ? (i === 0 ? 0.62 : 0.36) : 0.55);
        blob(g, px, py, rr, rr * 0.78, rand, toonColor(col, 1.05, 1.02));
      });
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 단면의 세로 크기 */
function boundsHeight(loops: [number, number][][]): number {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const l of loops) for (const [y] of l) {
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return y1 - y0;
}

/** 단면의 가로 크기 */
function boundsWidth(loops: [number, number][][]): number {
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const l of loops) for (const [, z] of l) {
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  return z1 - z0;
}

/** 몽글한 앙금 덩이 — 가장자리가 살짝 울퉁불퉁, 윗쪽에 은은한 윤기 */
function blob(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rand: () => number, col: THREE.Color): void {
  const n = 28;
  const wob = Array.from({ length: 5 }, () => rand() * Math.PI * 2);
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.06 * Math.sin(a * 3 + wob[0]) + 0.04 * Math.sin(a * 5 + wob[1]);
    const px = x + Math.cos(a) * rx * k;
    const py = y + Math.sin(a) * ry * k;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fillStyle = `#${col.getHexString()}`;
  g.fill();
  g.strokeStyle = `#${col.clone().multiplyScalar(0.8).getHexString()}`;
  g.lineWidth = Math.max(1.5, rx * 0.05);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.14)';
  g.beginPath();
  g.ellipse(x - rx * 0.2, y - ry * 0.35, rx * 0.4, ry * 0.18, -0.2, 0, Math.PI * 2);
  g.fill();
}

/** 다각형 안에서 가장자리로부터 가장 먼 자리(와 그 거리) — 격자로 훑는다 */
function deepest(outer: [number, number][], holes: [number, number][][]): { y: number; z: number; r: number } | null {
  const bb = boundsOf([outer]);
  const edges = [outer, ...holes];
  const distTo = (y: number, z: number) => {
    let d = Infinity;
    for (const l of edges)
      for (let i = 0; i < l.length; i++) {
        const [y1, z1] = l[i];
        const [y2, z2] = l[(i + 1) % l.length];
        const dy = y2 - y1;
        const dz = z2 - z1;
        const t = Math.max(0, Math.min(1, ((y - y1) * dy + (z - z1) * dz) / (dy * dy + dz * dz || 1)));
        d = Math.min(d, Math.hypot(y - (y1 + dy * t), z - (z1 + dz * t)));
      }
    return d;
  };
  let best: { y: number; z: number; r: number } | null = null;
  const N = 28;
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N; j++) {
      const y = bb.y0 + (bb.s * i) / N;
      const z = bb.z0 + (bb.s * j) / N;
      if (!inside([y, z], outer) || holes.some((h) => inside([y, z], h))) continue;
      const r = distTo(y, z);
      if (!best || r > best.r) best = { y, z, r };
    }
  return best;
}
