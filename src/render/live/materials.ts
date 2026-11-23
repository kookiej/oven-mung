// 실시간 무대의 재질 — Blender 카툰 렌더(render_cartoon.py)와 같은 색 보정·느낌을 three.js로.
//   반죽: 무광에 가까운 말랑한 면(sheen), 색은 toon()과 같은 채도·명도 보정
//   묽은 반죽: 틀에 부어 둔 케이크 반죽 사진처럼 — 광택 없는 크림 같은 면, 고운 입자, 군데군데 작은 기포 구멍
//   퍼짐 마스크(withSpread): 붓는 자리에서 둥글게 번져 나가는 액체·반죽 — 반지름 밖은 그리지 않는다
import * as THREE from 'three';
import { noise3 } from './noise';

/** Blender render_cartoon.toon과 같은 보정 — 화면 색(sRGB)의 HSV에서 채도·명도를 올리고 색상을 조금 민다 */
export function toonColor(hex: string, sat = 1.1, val = 1.04, hue = 0): THREE.Color {
  const rgb = new THREE.Color(hex).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  const min = Math.min(rgb.r, rgb.g, rgb.b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rgb.r) h = ((rgb.g - rgb.b) / d + 6) % 6;
    else if (max === rgb.g) h = (rgb.b - rgb.r) / d + 2;
    else h = (rgb.r - rgb.g) / d + 4;
    h /= 6;
  }
  h = (h + hue + 1) % 1;
  const sNew = Math.min(1, (max > 0 ? d / max : 0) * sat);
  const vNew = Math.min(1, max * val);
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return vNew - vNew * sNew * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return new THREE.Color().setRGB(f(5), f(3), f(1), THREE.SRGBColorSpace);
}

/** 말랑한 반죽 — vertexColors면 정점 색(밀가루 얼룩)을 곱한다 */
export function doughMaterial(hex: string, vertexColors = false): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: toonColor(hex, 1.1, 1.05),
    roughness: 0.62,
    sheen: 0.45,
    sheenColor: new THREE.Color('#fff6e6'),
    sheenRoughness: 0.7,
    vertexColors,
  });
}

let batterNormal: THREE.CanvasTexture | null = null;

/** 묽은 반죽 면의 노멀 맵 — 고운 입자 + 완만한 기복 + 띄엄띄엄 콕 찍힌 기포 구멍 */
function batterNormalMap(): THREE.CanvasTexture {
  if (batterNormal) return batterNormal;
  const N = 256;
  const h = new Float32Array(N * N);
  // 기포 구멍 자리
  let s = 99;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pits = Array.from({ length: 70 }, () => ({ x: rand() * N, y: rand() * N, r: 1.2 + rand() * rand() * 3.5 }));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = noise3(x * 0.03, y * 0.03, 0.5) * 0.5 + noise3(x * 0.35, y * 0.35, 3.1) * 0.08;
      for (const p of pits) {
        const dx = Math.min(Math.abs(x - p.x), N - Math.abs(x - p.x));
        const dy = Math.min(Math.abs(y - p.y), N - Math.abs(y - p.y));
        const d = Math.hypot(dx, dy);
        if (d < p.r) v -= 0.9 * (1 - (d / p.r) ** 2);
      }
      h[y * N + x] = v;
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  const at = (x: number, y: number) => h[((y + N) % N) * N + ((x + N) % N)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 2.2;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 2.2;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      img.data[i] = (-dx / len) * 127 + 128;
      img.data[i + 1] = (dy / len) * 127 + 128;
      img.data[i + 2] = (1 / len) * 127 + 128;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  batterNormal = new THREE.CanvasTexture(c);
  batterNormal.wrapS = batterNormal.wrapT = THREE.RepeatWrapping;
  return batterNormal;
}

export interface Spread {
  /** 번지기 시작한 자리 (x, z) */
  origin: THREE.Vector2;
  /** 지금 번진 반지름 (미터) — 크게 두면 다 덮인 것 */
  radius: { value: number };
  /** 면의 결을 가운데(origin) 둘레로 돌리는 각도 — 거품기로 저으면 반죽 결이 같이 돈다 */
  turn: { value: number };
  /**
   * 막 들어온 액체 — origin에서 소용돌이치며 번지는 제 색의 얼룩(반지름 r, 진하기 a). a가 줄면서 내용물 색에
   * 녹아든다(섞인다). 넣은 재료가 제 모습 그대로 남지 않고 바로 하나의 반죽이 되어 가는 모습
   */
  incoming: { color: THREE.Color; r: { value: number }; a: { value: number } };
  /** 아주 가벼운 출렁임 — 윗면(level 위쪽)만 낮은 물결로 움직인다. amp는 높이(미터), 0이면 가만히 있다 */
  slosh: { amp: { value: number }; time: { value: number }; level: { value: number } };
}

/**
 * 퍼짐 마스크 — 붓는 자리(origin)에서 반지름(radius) 밖은 그리지 않는다. 가장자리는 살짝 물결친다.
 * 묽은 반죽의 노멀 맵은 월드 좌표로 투영해 메시를 다시 만들어도 결이 그대로다
 */
export function withSpread<T extends THREE.MeshStandardMaterial>(mat: T, worldTexScale = 0): T & { spread: Spread } {
  const spread: Spread = {
    origin: new THREE.Vector2(),
    radius: { value: 10 },
    turn: { value: 0 },
    incoming: { color: new THREE.Color(), r: { value: 0 }, a: { value: 0 } },
    slosh: { amp: { value: 0 }, time: { value: 0 }, level: { value: 0 } },
  };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSpreadO = { value: spread.origin };
    sh.uniforms.uSpreadR = spread.radius;
    sh.uniforms.uTurn = spread.turn;
    sh.uniforms.uInCol = { value: spread.incoming.color };
    sh.uniforms.uInR = spread.incoming.r;
    sh.uniforms.uInA = spread.incoming.a;
    sh.uniforms.uSloshA = spread.slosh.amp;
    sh.uniforms.uSloshT = spread.slosh.time;
    sh.uniforms.uSloshY = spread.slosh.level;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;\nuniform float uSloshA;\nuniform float uSloshT;\nuniform float uSloshY;')
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
  // 출렁임 — 볼 지름만 한 낮은 물결 둘. 윗면만 움직이고 노멀도 같이 기울어 반짝임이 흔들린다
  float sloshTop = uSloshA > 0.0 ? smoothstep(uSloshY - 0.002, uSloshY - 0.0002, position.y) : 0.0;
  float sloshH = 0.0;
  if (sloshTop > 0.0) {
    float s1 = position.x * 26.0 + uSloshT * 7.3;
    float s2 = position.z * 34.0 - uSloshT * 8.9 + 1.3;
    sloshH = uSloshA * sloshTop * (sin(s1) + 0.6 * sin(s2));
    // 높이는 아주 살짝이어도 빛은 보이게 — 기울기를 키워 준다
    objectNormal.x -= 3.0 * uSloshA * sloshTop * 26.0 * cos(s1);
    objectNormal.z -= 3.0 * uSloshA * sloshTop * 0.6 * 34.0 * cos(s2);
    objectNormal = normalize(objectNormal);
  }`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.y += sloshH;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWorldP;\nuniform vec2 uSpreadO;\nuniform float uSpreadR;\nuniform float uTurn;\nuniform vec3 uInCol;\nuniform float uInR;\nuniform float uInA;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  if (uInA > 0.001) {
    // 막 들어온 재료의 얼룩 — 소용돌이 팔이 돌며 번지고, 옅어지며 내용물에 섞인다
    vec2 rel = vWorldP.xz - uSpreadO;
    float d = length(rel);
    float arms = 1.0 + 0.35 * sin(atan(rel.y, rel.x) * 3.0 - d * 90.0 + uTurn * 2.0);
    float k = uInA * (1.0 - smoothstep(uInR * 0.45, uInR, d * arms));
    diffuseColor.rgb = mix(diffuseColor.rgb, uInCol, k);
  }`,
      )
      .replace(
        'void main() {',
        `void main() {
  float sd = length(vWorldP.xz - uSpreadO);
  float wob = 1.0 + 0.06 * sin(atan(vWorldP.z - uSpreadO.y, vWorldP.x - uSpreadO.x) * 7.0);
  if (sd > uSpreadR * wob) discard;`,
      );
    if (worldTexScale > 0) {
      // 노멀 맵을 월드 xz로 — 메시를 매 프레임 다시 만들어도 결이 미끄러지지 않는다
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP_TANGENTSPACE
  vec2 rel = vWorldP.xz - uSpreadO;
  float cs = cos(uTurn), sn = sin(uTurn);
  vec2 nUv = vec2(cs * rel.x - sn * rel.y, sn * rel.x + cs * rel.y) * ${worldTexScale.toFixed(1)};
  mat3 tbnW = getTangentFrame( - vViewPosition, normal, nUv );
  vec3 mapN = texture2D( normalMap, nUv ).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale;
  normal = normalize( tbnW * mapN );
#endif`,
      );
    }
  };
  return Object.assign(mat, { spread });
}

/** 묽은 반죽 — 무광 크림, 고운 입자와 기포 구멍. 퍼짐 마스크 포함 */
export function batterMaterial(hex: string): THREE.MeshStandardMaterial & { spread: Spread } {
  const m = new THREE.MeshStandardMaterial({
    color: toonColor(hex, 1.08, 1.03),
    roughness: 0.86,
    metalness: 0,
    normalMap: batterNormalMap(),
    normalScale: new THREE.Vector2(0.45, 0.45),
  });
  return withSpread(m, 14);
}

/** 액체(물·우유·꿀·기름) — 매끈하게 반짝이고, 맑은 액체는 비친다 */
export function liquidMaterial(hex: string, clear: boolean): THREE.MeshStandardMaterial & { spread: Spread } {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(hex),
    roughness: 0.12,
    clearcoat: 0.6,
    transparent: clear,
    opacity: clear ? 0.55 : 1,
    depthWrite: !clear,
  });
  return withSpread(m);
}

/**
 * 날달걀 흰자 — 흰색이 아니라 맑고 끈적한 액체. 아래가 비쳐 보이고 옅은 볏짚색이 돌며, 두께가 얇아 보는 각도가 낮은
 * 가장자리만 빛을 받아 윤곽이 드러난다
 */
export function rawEggWhiteMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#e9e2a4'),
    roughness: 0.06,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `diffuseColor.a = mix(diffuseColor.a, 0.6, pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0));
  #include <opaque_fragment>`,
    );
  };
  return m;
}

/** 꿀 — 진한 호박색에 윤이 나고, 두께가 얇아 보이는 가장자리는 밝은 금빛으로 빛이 비친다 */
export function honeyMaterial(hex: string): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: toonColor(hex, 1.05, 0.96),
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `outgoingLight = mix(outgoingLight, vec3(1.0, 0.72, 0.22), 0.6 * pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.0));
  #include <opaque_fragment>`,
    );
  };
  return m;
}

export function glossy(hex: string, rough = 0.2): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: toonColor(hex, 1.05, 1.02), roughness: rough, clearcoat: 0.3 });
}
