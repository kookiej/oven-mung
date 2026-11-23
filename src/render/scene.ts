import * as THREE from 'three';
import type { BreadDef, BreadId, GeometryKind, Quality, ToppingId } from '../types';
import { makeBreadGeometry, makeCupLiner } from './breadMesh';
import type { BitAnchor, BreadModel } from './breadModel';
import { makeVessel } from './vessel';
import { makeBitMaterial, makeBreadMaterial, type BreadUniforms } from './breadShader';
import { pieFillingColor, pieHollow } from './live/placed';
import { toonColor } from './live/materials';
import { SCORE_AT } from '../content/breads';

const PIXEL_RATIO_CAP: Record<Quality, number> = { low: 1, mid: 1.5, high: 2 };
export const FPS_CAP: Record<Quality, number> = { low: 30, mid: 60, high: 60 };

/** 트레이 윗면의 월드 높이 — floor 그룹의 원점 */
const TRAY_TOP = -0.585;

/**
 * 빵 바닥을 트레이에 이만큼 파묻는다 — 딱 맞닿게 두면 둥근 바닥이 한 점으로만 닿아
 * 떠 보이고, 부풀 때의 미세한 떨림에 틈이 비친다
 */
const TRAY_SINK = 0.015;

/**
 * 카메라가 거의 수평이라 납작한 빵은 옆면만 보인다 — 앞으로 기울여 윗면(도넛 구멍, 와플 격자,
 * 토핑, 틀의 입구)이 보이게 한다. 빵만 돌리면 평평한 트레이 위에서 틀이 비스듬히 기대 선 꼴이
 * 되므로 **트레이·그릇·빵을 묶은 floor 그룹째** 기울인다. 지오메트리는 돌리지 않으므로 셰이더의
 * 오브젝트 좌표(와플 격자, 토핑이 붙는 '윗면' 판정)는 그대로다.
 */
const GEOMETRY_TILT: Record<GeometryKind, number> = {
  loaf: 0,
  panLoaf: 0.2,
  disc: 0,
  crescent: 0,
  ring: 0.6,
  cylinder: 0.3,
  cup: 0,
  square: 0.6,
};
/** 팬케이크·플랫브레드처럼 얇게 편 빵에 더하는 기울기 */
const THIN_TILT = 0.5;

/**
 * Blender 카툰 에셋(GLB)으로 구울 때의 기울기 — 그 빵을 렌더한 카메라 고도(render_cartoon.py의 JOBS el)에서
 * 오븐 카메라의 고도(약 9°)를 뺀 만큼. 렌더 그림과 같은 각도로 빵이 보인다
 */
const MODEL_TILT: Record<BreadId, number> = {
  shokupan: 0.4,
  cookie: 0.64,
  croissant: 0.65,
  pancake: 0.47,
  bagel: 0.57,
  flatbread: 0.65,
  baguette: 0.5,
  cupcake: 0.65,
  pretzel: 0.65,
  doughnut: 0.65,
  waffle: 0.65,
  pie: 0.65,
  cake: 0.5,
};
/** 트레이(시트팬)째 GLB에 들어 있는 빵 — 오븐 바닥의 둥근 트레이를 따로 깔지 않는다 */
const OWN_TRAY: ReadonlySet<BreadId> = new Set(['cookie', 'croissant', 'bagel', 'flatbread', 'baguette', 'pretzel', 'pancake']);

/** 토핑 알갱이들을 인스턴싱 지오메트리로 — 알갱이마다 시작·끝 자리, 크기, 자세, 색 */
function bitGeometry(bits: readonly BitAnchor[]): THREE.InstancedBufferGeometry {
  const base = new THREE.SphereGeometry(1, 8, 6);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.getAttribute('position'));
  g.setAttribute('normal', base.getAttribute('normal'));
  const attr = (name: string, size: number, fn: (b: BitAnchor) => ArrayLike<number>) => {
    const a = new Float32Array(bits.length * size);
    bits.forEach((b, i) => a.set(fn(b), i * size));
    g.setAttribute(name, new THREE.InstancedBufferAttribute(a, size));
  };
  attr('iFrom', 3, (b) => b.from);
  attr('iTo', 3, (b) => b.to);
  attr('iScale', 3, (b) => b.scale);
  attr('iQuat', 4, (b) => b.quat);
  attr('iColor', 3, (b) => b.color);
  attr('iBread', 4, (b) => b.bread);
  g.instanceCount = bits.length;
  return g;
}

function maxY(a: THREE.BufferAttribute): number {
  let m = -Infinity;
  for (let i = 0; i < a.count; i++) m = Math.max(m, a.getY(i));
  return m;
}

/**
 * 빵이 트레이에 닿는 자리의 그림자 — 빵의 발자국(정점을 바닥에 내린 모양)을 흐리게 번진 어두운 판.
 * 이게 없으면 둥근 빵의 밑동이 트레이 색에 묻혀 빵이 트레이에 반쯤 박힌 것처럼 보인다(사용자 요청)
 */
function contactShadow(geo: THREE.BufferGeometry): THREE.Mesh {
  const box = geo.boundingBox!;
  const pad = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.14;
  const x0 = box.min.x - pad;
  const z0 = box.min.z - pad;
  const w = box.max.x - box.min.x + pad * 2;
  const d = box.max.z - box.min.z + pad * 2;
  const S = 192;
  const raw = document.createElement('canvas');
  raw.width = raw.height = S;
  const g = raw.getContext('2d')!;
  g.fillStyle = '#000';
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const step = Math.max(1, Math.floor(pos.count / 5000));
  for (let i = 0; i < pos.count; i += step) {
    g.beginPath();
    g.arc(((pos.getX(i) - x0) / w) * S, ((pos.getZ(i) - z0) / d) * S, 3.2, 0, Math.PI * 2);
    g.fill();
  }
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const cg = c.getContext('2d')!;
  cg.filter = `blur(${Math.round((pad / w) * S * 0.55)}px)`;
  cg.drawImage(raw, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  const plane = new THREE.PlaneGeometry(w, d);
  plane.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(
    plane,
    new THREE.MeshBasicMaterial({ map: tex, color: '#1c0e06', transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  m.position.set(x0 + w / 2, box.min.y + 0.004, z0 + d / 2);
  m.renderOrder = -1;
  return m;
}

/** 오븐 내부 뷰 — 빵, 트레이, 발열체, 조명 */
export class BakingScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  /** 빵 껍질 재질들 — GLB 빵은 메시마다(컵케이크 6개, 파이 격자·테두리) 저마다의 가운데·높이를 가진다 */
  private breadMats: (THREE.ShaderMaterial & { uniforms: BreadUniforms })[] = [];
  /** 토핑 알갱이 — 토핑 화면의 그 알갱이가 반죽과 함께 부푼다 */
  private bitMat: THREE.ShaderMaterial | null = null;
  private lamp: THREE.PointLight;
  private ambient!: THREE.AmbientLight;
  private coilMats: THREE.MeshBasicMaterial[] = [];
  private lightOn = true;
  private camDist = 3.1;
  private floor!: THREE.Group;
  /** 칼집을 낼 빵의 가운데·윗면 높이·칼집 반길이 (floor 좌표) */
  private scoreInfo: { cx: number; cz: number; top: number; dough: number; len: number } | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    def: BreadDef,
    toppingIds: readonly ToppingId[],
    seed: number,
    tier: Quality,
    /** Blender 카툰 에셋 — null이면 절차적 메시(breadMesh.ts·vessel.ts)로 */
    model: BreadModel | null = null,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: tier !== 'low' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO_CAP[tier]));

    this.scene.background = new THREE.Color('#160d08');
    this.scene.fog = new THREE.Fog('#160d08', 3.2, 6.5);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20);
    this.camera.position.set(0, 0.5, 3.1);
    this.camera.lookAt(0, 0.05, 0);

    // 트레이(또는 프라이팬)·그릇·빵을 한 묶음으로 — 기울일 때 함께 기운다. 원점 = 트레이 윗면
    const floor = new THREE.Group();
    floor.position.y = TRAY_TOP;
    this.scene.add(floor);
    this.floor = floor;

    if (model) {
      // Blender 카툰 에셋 — 빵 껍질은 메시마다 재질을 따로 두어 저마다의 바닥·높이·가운데에서 부푼다.
      // 그릇·소품은 GLB 재질 그대로. 크기와 자리는 breadModel.ts가 이미 맞춰 두었다(바닥 = y 0)
      for (const mesh of model.breads) {
        const mat = makeBreadMaterial(def, toppingIds, seed);
        mat.uniforms.uGrid.value = 0; // 와플 윗면은 매끈하다 (격자는 몰드에 닿는 아랫면)
        mat.uniforms.uMorph.value = 1; // 토핑 올린 그 반죽(aDough) → 다 구운 모양(그릇·트레이 안에 꼭 맞게 렌더해 두었다)
        mat.uniforms.uTopDen.value = mat.uniforms.uTopDen.value.map(() => 0); // 알갱이는 3D로 따로
        const box = (mesh.geometry as THREE.BufferGeometry).boundingBox!;
        mat.uniforms.uBaseY.value = box.min.y;
        mat.uniforms.uTopY.value = box.max.y;
        mat.uniforms.uHalfW.value = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
        if (def.midScore) {
          this.scoreInfo = {
            cx: (box.min.x + box.max.x) / 2,
            cz: (box.min.z + box.max.z) / 2,
            top: box.max.y,
            dough: (mesh.geometry as THREE.BufferGeometry).getAttribute('aDough') ? maxY(mesh.geometry.getAttribute('aDough') as THREE.BufferAttribute) : box.max.y,
            // Blender 칼집 반길이 0.086 / 팬케이크 반지름 0.1049
            len: (Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2) * 0.82,
          };
        }
        mat.uniforms.uCenter.value.set((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2);
        mesh.material = mat;
        this.breadMats.push(mat);
        floor.add(mesh);
        // 트레이에 놓인 빵 밑의 그림자 (틀 속 빵은 틀 벽에 가려 필요 없다)
        if (def.vessel === 'tray') floor.add(contactShadow(mesh.geometry as THREE.BufferGeometry));
      }
      for (const mesh of model.others) {
        // 파이 필링 — 고른 토핑이 곧 필링. 토핑이 없으면 필링 없이 속이 빈 채로 굽는다(사용자 요청)
        if (mesh.name.includes('필링') && pieHollow(def, toppingIds)) continue;
        if (mesh.name.includes('필링')) {
          const m = mesh.material as THREE.MeshStandardMaterial;
          m.color.copy(toonColor(pieFillingColor(toppingIds), 1.1, 1.03));
        }
        floor.add(mesh);
      }
      if (model.bits.length) {
        this.bitMat = makeBitMaterial(seed);
        const bits = bitGeometry(model.bits);
        const im = new THREE.Mesh(bits, this.bitMat);
        im.frustumCulled = false;
        floor.add(im);
      }
      if (!OWN_TRAY.has(def.id)) {
        const tray = new THREE.Mesh(
          new THREE.CylinderGeometry(1.7, 1.75, 0.07, 48),
          new THREE.MeshStandardMaterial({ color: '#2b241f', roughness: 0.85, metalness: 0.35 }),
        );
        tray.position.y = -0.035;
        floor.add(tray);
      }
      floor.rotation.x = MODEL_TILT[def.id];
    } else {
      // 빵
      const geo = makeBreadGeometry(def.geometry, tier);
      // 절차적 메시는 굽기 분포가 고르다
      const n = geo.getAttribute('position').count;
      geo.setAttribute('toast', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
      const mat = makeBreadMaterial(def, toppingIds, seed);
      this.breadMats.push(mat);
      const bread = new THREE.Mesh(geo, mat);
      const thickness = def.thickness ?? 1;
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      // 바닥·꼭대기 높이 — 세로로 부풀 때의 기준, 틀 빵이 시작할 반죽 높이 계산에 쓴다
      mat.uniforms.uBaseY.value = box.min.y;
      mat.uniforms.uTopY.value = box.max.y;
      mat.uniforms.uHalfW.value = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z);
      bread.scale.y = thickness;
      if (def.geometry === 'cup') bread.add(makeCupLiner());
      floor.add(bread);

      const vessel = makeVessel(def.vessel, {
        halfW: Math.max(-box.min.x, box.max.x),
        halfD: Math.max(-box.min.z, box.max.z),
        height: (box.max.y - box.min.y) * thickness,
      });
      // 빵 바닥(바운딩 박스 아래면)을 그릇 바닥·트레이 윗면에 맞춘다. 셰이더가 바닥을 기준으로
      // 부풀리고(uBaseY) 바닥 면엔 요철·크랙을 주지 않으므로, 굽는 내내 바닥이 이 자리에 붙어 있다
      if (vessel) floor.add(vessel.object);
      const floorY = vessel ? vessel.floorY : -TRAY_SINK;
      bread.position.y = floorY - box.min.y * thickness;

      // 트레이 — 프라이팬이 자리를 대신하면 생략
      if (!vessel?.replacesTray) {
        const tray = new THREE.Mesh(
          new THREE.CylinderGeometry(1.35, 1.4, 0.07, 40),
          new THREE.MeshStandardMaterial({ color: '#2b241f', roughness: 0.85, metalness: 0.35 }),
        );
        tray.position.y = -0.035;
        floor.add(tray);
      }

      floor.rotation.x = GEOMETRY_TILT[def.geometry] + (thickness < 1 ? THIN_TILT : 0);
    }

    // 오븐 안쪽 벽 (은은하게 보이는 배경면)
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 10),
      new THREE.MeshStandardMaterial({ color: '#1b100a', roughness: 1 }),
    );
    wall.position.set(0, 0.4, -2.2);
    this.scene.add(wall);

    // 상단 발열체 — 은은하게 맥동하는 주황 빛
    for (const x of [-0.7, 0.7]) {
      const mat = new THREE.MeshBasicMaterial({ color: '#ff5a1f' });
      this.coilMats.push(mat);
      const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 8), mat);
      coil.rotation.z = Math.PI / 2;
      coil.position.set(0, 1.35, -1.1 + x);
      this.scene.add(coil);
    }

    // 조명: 따뜻한 오븐 램프 + 약한 앰비언트
    this.lamp = new THREE.PointLight('#ffc080', 10, 9, 1.8);
    this.lamp.position.set(0.6, 1.6, 1.4);
    this.scene.add(this.lamp);
    this.ambient = new THREE.AmbientLight('#7a4f33', 0.35);
    this.scene.add(this.ambient);

    this.resize();
  }

  /** 굽는 중간에 낸 칼집 — scored면 금이 보이고, open만큼 벌어진다 */
  setScore(scored: boolean, open: number): void {
    for (const m of this.breadMats) {
      m.uniforms.uScored.value = scored ? 1 : 0;
      m.uniforms.uScoreOpen.value = open;
    }
  }

  /** 칼집을 낼 두 줄 — 캔버스 CSS 픽셀의 양 끝. Blender build_pancake의 십자 칼집과 같은 자리·각도 */
  scoreLines(): { a: { x: number; y: number }; b: { x: number; y: number } }[] {
    const info = this.scoreInfo;
    if (!info) return [];
    const rot = (28 * Math.PI) / 180;
    const dirs: [number, number][] = [
      [Math.cos(rot), -Math.sin(rot)],
      [-Math.sin(rot), -Math.cos(rot)],
    ];
    const canvas = this.renderer.domElement;
    // 칼집을 내는 때의 윗면 — 반죽 윗면과 다 부푼 윗면 사이 (셰이더의 부풀기와 같은 식)
    const t = Math.min(1, Math.max(0, (SCORE_AT - 0.02) / 0.78));
    const y = info.dough + (info.top - info.dough) * t * t * (3 - 2 * t);
    const at = (dx: number, dz: number, s: number) => {
      const v = new THREE.Vector3(info.cx + dx * s * info.len, y, info.cz + dz * s * info.len);
      this.floor.localToWorld(v).project(this.camera);
      return { x: ((v.x + 1) / 2) * canvas.clientWidth, y: ((1 - v.y) / 2) * canvas.clientHeight };
    };
    return dirs.map(([dx, dz]) => ({ a: at(dx, dz, -1), b: at(dx, dz, 1) }));
  }

  setProgress(progress: number, browning: number): void {
    for (const m of this.breadMats) {
      m.uniforms.uProgress.value = progress;
      m.uniforms.uBrowning.value = browning;
    }
    if (this.bitMat) {
      this.bitMat.uniforms.uProgress.value = progress;
      this.bitMat.uniforms.uBrowning.value = browning;
    }
  }

  setLight(on: boolean): void {
    this.lightOn = on;
    for (const m of this.breadMats) m.uniforms.uLightOn.value = on ? 1 : 0;
    if (this.bitMat) this.bitMat.uniforms.uLightOn.value = on ? 1 : 0;
    this.lamp.intensity = on ? 10 : 0.7;
    this.ambient.intensity = on ? 0.35 : 0.06;
  }

  get isLightOn(): boolean {
    return this.lightOn;
  }

  render(timeSec: number): void {
    for (const m of this.breadMats) m.uniforms.uTime.value = timeSec;
    if (this.bitMat) this.bitMat.uniforms.uTime.value = timeSec;
    // 발열체 맥동
    const glow = 0.75 + 0.25 * Math.sin(timeSec * 1.7);
    for (const m of this.coilMats) {
      m.color.setRGB(1.0 * glow, 0.35 * glow, 0.12 * glow);
    }
    // 아주 미세한 카메라 흔들림 (열기 느낌)
    this.camera.position.x = Math.sin(timeSec * 0.23) * 0.02;
    this.camera.position.y = 0.5 + Math.sin(timeSec * 0.31) * 0.012;
    this.camera.lookAt(0, 0.05, 0);
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // 세로로 좁은 오븐 창에서도 빵 전체(폭 ~2.6 + 여유)가 들어오도록 거리 자동 계산
    // 그릇·트레이째 FIT_WIDTH(2.3)로 맞춘 GLB — 트레이 전체가 창 안에 들어온다(확대해 넘치지 않게)
    const halfWidthNeeded = 1.45;
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    this.camDist = Math.max(3.2, halfWidthNeeded / (Math.tan(halfFov) * aspect));
    this.camera.position.z = this.camDist;
    this.camera.lookAt(0, 0.05, 0);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = this.camDist + 0.6;
      this.scene.fog.far = this.camDist + 5;
    }
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    for (const m of this.breadMats) m.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (obj.material instanceof THREE.Material) obj.material.dispose();
      }
    });
    this.renderer.dispose();
  }
}
