// 실시간 3D 무대 — 반죽·모양 빚기·틀에 넣기·토핑 단계의 모션을 three.js로 그린다.
// 배경(볼·반죽 판·틀·트레이)은 Blender로 렌더한 그림(stage/<이름>.webp)을 2D 캔버스에 깔고,
// 이 무대는 그 위에 투명 WebGL 캔버스로 겹친다. GLB(stage/<이름>.glb)에 같은 장면의 카메라와 그릇 메시가 있어
//   - 카메라: 배경 그림을 렌더한 Blender 카메라 그대로 — 3D 반죽이 그림 속 그릇에 정확히 놓인다
//   - 그릇 메시: 깊이만 쓰는 가림막(색은 안 그림) + 그림자만 받는 면 — 반죽이 그릇 '안에' 보이고(앞 벽에 가려짐),
//     반죽 그림자가 그림 속 그릇에 진다
// 좌표는 Blender 미터 단위 그대로(glTF가 Y 위로 바꿈). 그릇 안쪽 모양은 sprites.json의 stage.<이름>에 있다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Box } from '../sprites';

const loader = new GLTFLoader();

export class LiveStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** 그릇 메시들 — 반죽을 가리고 그림자를 받는다 */
  readonly vessel = new THREE.Group();
  /** 그릇의 가운데 (조명·그림자 범위 기준) */
  readonly center = new THREE.Vector3();
  readonly size: number;
  box: Box = { x: 0, y: 0, size: 1 };
  private w = 1;
  private h = 1;
  private key: THREE.DirectionalLight;

  /** stage/<name>.glb를 불러와 무대를 만든다 */
  static async load(canvas: HTMLCanvasElement, name: string): Promise<LiveStage> {
    const gltf = await loader.loadAsync(`./assets/stage/${name}.glb`);
    return new LiveStage(canvas, gltf.scene, gltf.cameras[0] as THREE.PerspectiveCamera | undefined);
  }

  private constructor(canvas: HTMLCanvasElement, root: THREE.Object3D, glCam?: THREE.PerspectiveCamera) {
    // preserveDrawingBuffer — 2D 캔버스로 화면을 겹쳐 찍을 수 있게(개발자 확인용, 비용은 작다)
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    root.updateMatrixWorld(true);
    // 카메라 — Blender 카메라의 세계 변환 그대로. 그림이 정사각형이라 화면비 1
    this.camera = new THREE.PerspectiveCamera(glCam?.fov ?? 30, 1, 0.005, 10);
    if (glCam) {
      glCam.updateMatrixWorld(true);
      glCam.matrixWorld.decompose(this.camera.position, this.camera.quaternion, new THREE.Vector3());
    }

    // 그릇 — 깊이만 쓰는 가림막(먼저 그린다) + 그림자만 받는 면(나중에 같은 깊이로 덮는다)
    const depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
    const shadow = new THREE.ShadowMaterial({ opacity: 0.22 });
    const box = new THREE.Box3();
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const geo = (o.geometry as THREE.BufferGeometry).clone();
      geo.applyMatrix4(o.matrixWorld);
      const d = new THREE.Mesh(geo, depthOnly);
      d.renderOrder = -10;
      const s = new THREE.Mesh(geo, shadow);
      s.receiveShadow = true;
      s.renderOrder = 10;
      this.vessel.add(d, s);
      geo.computeBoundingBox();
      box.union(geo.boundingBox!);
    });
    this.scene.add(this.vessel);
    box.getCenter(this.center);
    this.size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 0.1);

    // 조명 — Blender 카툰 장면처럼: 왼쪽 뒤 위의 따뜻한 큰 빛(키) + 오른쪽 앞의 약한 채움 + 민트빛 주변광
    // 바닥 쪽 빛도 밝게 — 반죽의 아래로 기운 옆면이 어두워져 굵은 외곽선처럼 보이지 않게(사용자 요청)
    this.scene.add(new THREE.HemisphereLight('#f4fbf6', '#ecdfcc', 2.3));
    const low = new THREE.DirectionalLight('#fff4e4', 0.7);
    low.position.copy(this.center).add(new THREE.Vector3(0, 0.05, 1).multiplyScalar(this.size * 2));
    this.scene.add(low);
    this.key = new THREE.DirectionalLight('#fff0dc', 2.8);
    this.key.position.copy(this.center).add(new THREE.Vector3(-0.8, 1.0, -0.45).multiplyScalar(this.size * 2));
    this.key.target.position.copy(this.center);
    this.key.castShadow = true;
    const sc = this.key.shadow.camera;
    const half = this.size * 0.9;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.near = 0.01;
    sc.far = this.size * 6;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.radius = 6;
    this.key.shadow.bias = -0.0005;
    this.scene.add(this.key, this.key.target);
    const fill = new THREE.DirectionalLight('#eef5ff', 0.8);
    fill.position.copy(this.center).add(new THREE.Vector3(0.9, 0.5, 0.8).multiplyScalar(this.size * 2));
    this.scene.add(fill);
  }

  /** 캔버스 크기와 배경 그림 상자에 맞춘다 */
  setBox(w: number, h: number, box: Box): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (this.w !== w || this.h !== h || this.renderer.getPixelRatio() !== dpr) {
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
      this.w = w;
      this.h = h;
    }
    this.box = box;
  }

  render(): void {
    const b = this.box;
    this.renderer.setScissorTest(false);
    this.renderer.clear();
    this.renderer.setViewport(b.x, this.h - b.y - b.size, b.size, b.size);
    this.renderer.setScissor(b.x, this.h - b.y - b.size, b.size, b.size);
    this.renderer.setScissorTest(true);
    this.renderer.render(this.scene, this.camera);
  }

  /** 화면 좌표(캔버스 CSS 픽셀) → 광선 */
  ray(px: number, py: number): THREE.Ray {
    const b = this.box;
    const ndc = new THREE.Vector2(((px - b.x) / b.size) * 2 - 1, -(((py - b.y) / b.size) * 2 - 1));
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return rc.ray;
  }

  /** 화면 좌표가 가리키는 높이 y 평면 위의 점 */
  onPlane(px: number, py: number, y: number): THREE.Vector3 | null {
    const p = new THREE.Vector3();
    return this.ray(px, py).intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), p);
  }

  /** 3D 점 → 화면 좌표(캔버스 CSS 픽셀) */
  project(v: THREE.Vector3): { x: number; y: number } {
    const p = v.clone().project(this.camera);
    const b = this.box;
    return { x: b.x + ((p.x + 1) / 2) * b.size, y: b.y + ((1 - p.y) / 2) * b.size };
  }

  /** 화면에서 이 길이(미터)가 몇 픽셀인지 — p 근처에서 */
  pixelsPerMeter(p: THREE.Vector3): number {
    const a = this.project(p);
    const b = this.project(p.clone().add(new THREE.Vector3(0.01, 0, 0)));
    return Math.hypot(b.x - a.x, b.y - a.y) / 0.01;
  }

  dispose(): void {
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m.dispose();
      }
    });
    this.renderer.dispose();
  }
}
