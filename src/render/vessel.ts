// 오븐 속 굽는 그릇 — 식빵틀·케이크틀 같은 틀과 팬케이크용 프라이팬.
// 빵 셰이더가 아니라 일반 재질을 써서 그릇은 갈변하지 않는다.
// 좌표는 scene.ts의 floor 그룹 기준: y=0이 트레이 윗면이다.
import * as THREE from 'three';
import type { VesselKind } from '../types';

/** 두께·배율을 적용한 빵의 크기 (빵 로컬 좌표) */
export interface BreadSize {
  halfW: number;
  halfD: number;
  height: number;
}

export interface Vessel {
  object: THREE.Object3D;
  /** 빵 바닥이 놓일 높이 (트레이 윗면 기준) */
  floorY: number;
  /** 프라이팬처럼 트레이 자리를 대신하면 true — 트레이를 그리지 않는다 */
  replacesTray: boolean;
}

const tin = () =>
  new THREE.MeshStandardMaterial({
    color: '#56504a',
    metalness: 0.7,
    roughness: 0.42,
    side: THREE.DoubleSide,
  });
const castIron = () =>
  new THREE.MeshStandardMaterial({ color: '#2a2521', metalness: 0.35, roughness: 0.85 });
const ceramic = () =>
  new THREE.MeshStandardMaterial({ color: '#9db8c9', roughness: 0.45, side: THREE.DoubleSide });

/**
 * 부은 반죽은 그릇 모양 그대로 차므로 벽을 빵에 딱 붙인다 — 띄우면 둘레에 그릇 바닥이 보인다.
 * 틀 빵은 셰이더에서 옆으로 커지지 않으니(uMolded) 굽는 동안의 미세한 떨림만큼만 여유를 둔다.
 */
const WALL_GAP = 1.01;
const T = 0.03; // 틀 두께

function add(group: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, y: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  group.add(m);
  return m;
}

/** 사각 틀 — 바닥 + 벽 네 장 */
function boxTin(halfW: number, halfD: number, wallH: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  add(g, new THREE.BoxGeometry(halfW * 2 + T * 2, T, halfD * 2 + T * 2), mat, T / 2);
  for (const sx of [-1, 1]) {
    const w = add(g, new THREE.BoxGeometry(T, wallH, halfD * 2 + T * 2), mat, wallH / 2);
    w.position.x = sx * (halfW + T / 2);
  }
  for (const sz of [-1, 1]) {
    const w = add(g, new THREE.BoxGeometry(halfW * 2 + T * 2, wallH, T), mat, wallH / 2);
    w.position.z = sz * (halfD + T / 2);
  }
  return g;
}

/** 둥근 틀 — 바닥 + 옆벽(위가 조금 벌어질 수 있음) */
function roundTin(rBottom: number, rTop: number, wallH: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(rBottom + T, rBottom + T, T, 48), mat, T / 2);
  add(g, new THREE.CylinderGeometry(rTop, rBottom, wallH, 48, 1, true), mat, wallH / 2);
  return g;
}

export function makeVessel(kind: VesselKind, s: BreadSize): Vessel | null {
  switch (kind) {
    case 'tray':
      return null;

    case 'loafTin': {
      // 식빵틀 — 반죽이 틀 위로 봉긋 솟도록 벽은 빵 높이의 절반 남짓
      const obj = boxTin(s.halfW * WALL_GAP, s.halfD * WALL_GAP, s.height * 0.58, tin());
      return { object: obj, floorY: T, replacesTray: false };
    }

    case 'cakeTin': {
      const r = s.halfW * WALL_GAP;
      return { object: roundTin(r, r, s.height * 0.66, tin()), floorY: T, replacesTray: false };
    }

    case 'muffinTin': {
      // 종이 컵받침(빵 메시의 자식)을 감싸는, 위가 벌어진 금속 컵.
      // 컵받침보다 낮게 두어 분홍 줄무늬가 틀 위로 조금 보이게 한다
      return { object: roundTin(0.5, 0.6, 0.3, tin()), floorY: T, replacesTray: false };
    }

    case 'doughnutPan': {
      // 고리 모양 홈 — 낮은 바깥 벽 + 도넛 구멍 자리의 기둥
      const g = roundTin(s.halfW * WALL_GAP, s.halfW * WALL_GAP, s.height * 0.5, tin());
      // 기둥 = 도넛 구멍 크기 (breadMesh의 고리: 중심 0.56 · 굵기 0.3 → 구멍 0.26 / 바깥 0.86)
      const postR = s.halfW * (0.26 / 0.86);
      add(g, new THREE.CylinderGeometry(postR, postR, s.height * 0.5, 32), tin(), s.height * 0.25);
      return { object: g, floorY: T, replacesTray: false };
    }

    case 'waffleIron': {
      // 무쇠 바닥판 + 테두리 + 뒤쪽 경첩 + 앞으로 뻗은 손잡이
      const g = new THREE.Group();
      const iron = castIron();
      // 테두리 안쪽이 와플 가장자리에 붙는다
      const hw = s.halfW * WALL_GAP;
      const hd = s.halfD * WALL_GAP;
      const plateH = 0.08;
      add(g, new THREE.BoxGeometry(hw * 2 + 0.16, plateH, hd * 2 + 0.16), iron, plateH / 2);
      const rimH = 0.07;
      for (const sx of [-1, 1]) {
        const w = add(g, new THREE.BoxGeometry(0.08, rimH, hd * 2 + 0.16), iron, plateH + rimH / 2);
        w.position.x = sx * (hw + 0.04);
      }
      for (const sz of [-1, 1]) {
        const w = add(g, new THREE.BoxGeometry(hw * 2 + 0.16, rimH, 0.08), iron, plateH + rimH / 2);
        w.position.z = sz * (hd + 0.04);
      }
      const hinge = add(g, new THREE.CylinderGeometry(0.06, 0.06, hw * 1.2, 16), iron, plateH + 0.04);
      hinge.rotation.z = Math.PI / 2;
      hinge.position.z = -(hd + 0.14);
      const handle = add(g, new THREE.BoxGeometry(0.12, 0.06, 0.55), castIron(), plateH / 2);
      handle.position.z = hd + 0.35;
      return { object: g, floorY: plateH, replacesTray: false };
    }

    case 'pieDish': {
      // 가장자리가 물결진 도자기 접시 — 안쪽은 반죽에 딱 붙고, 테두리만 바깥으로 벌어진다
      const rB = s.halfW * WALL_GAP;
      const rT = s.halfW * WALL_GAP;
      const h = s.height * 0.55;
      const profile = [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(rB, 0),
        new THREE.Vector2(rT, h),
        new THREE.Vector2(rT + 0.09, h + 0.02),
        new THREE.Vector2(rT + 0.11, h - 0.02),
      ];
      const geo = new THREE.LatheGeometry(profile, 96);
      // 테두리만 물결치게
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < h * 0.9) continue;
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const k = 1 + 0.035 * Math.sin(Math.atan2(z, x) * 18);
        pos.setXYZ(i, x * k, y, z * k);
      }
      geo.computeVertexNormals();
      const g = new THREE.Group();
      add(g, geo, ceramic(), 0);
      return { object: g, floorY: 0.02, replacesTray: false };
    }

    case 'fryingPan': {
      // 트레이 대신 놓이는 프라이팬 — 얕은 팬 + 오른쪽 앞으로 뻗은 나무 손잡이
      const g = new THREE.Group();
      const r = Math.max(s.halfW, s.halfD) * 1.22;
      const profile = [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(r, 0),
        new THREE.Vector2(r + 0.14, 0.16),
        new THREE.Vector2(r + 0.17, 0.16),
      ];
      const pan = new THREE.MeshStandardMaterial({
        color: '#2c2c31',
        metalness: 0.45,
        roughness: 0.55,
        side: THREE.DoubleSide,
      });
      add(g, new THREE.LatheGeometry(profile, 64), pan, 0);
      const arm = new THREE.Group();
      arm.rotation.y = -0.55; // 카메라 쪽으로 살짝 돌려 손잡이가 화면에 보이게
      const neck = add(arm, new THREE.CylinderGeometry(0.045, 0.05, 0.3, 12), pan, 0.13);
      neck.rotation.z = Math.PI / 2 - 0.25;
      neck.position.x = r + 0.28;
      const grip = add(
        arm,
        new THREE.CylinderGeometry(0.07, 0.08, 0.75, 16),
        new THREE.MeshStandardMaterial({ color: '#4a3020', roughness: 0.8 }),
        0.2,
      );
      grip.rotation.z = Math.PI / 2 - 0.2;
      grip.position.x = r + 0.78;
      g.add(arm);
      return { object: g, floorY: 0.015, replacesTray: true };
    }
  }
}
