import * as THREE from 'three';
import { MAX_TOPPINGS, bakedToppingIds, tintedBread, toppingSlots } from '../content/toppings';
import { toonColor } from './live/materials';
import type { BreadDef, ToppingId } from '../types';

// Ashima 3D simplex noise (MIT) — 셰이더 공용 청크
const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p){
  float f = 0.0;
  f += 0.5   * snoise(p);
  f += 0.25  * snoise(p * 2.1);
  f += 0.125 * snoise(p * 4.3);
  return f;
}
`;

const VERTEX = /* glsl */ `
uniform float uProgress;   // 0~1+ (1 초과 = 계속 굽는 중)
uniform float uSpring;     // 오븐 스프링 최대 팽창 비율
uniform float uSeed;
uniform float uTime;
uniform float uMolded;     // 틀·팬에 담긴 빵이면 1
uniform float uBaseY;      // 빵 바닥 높이 (오브젝트 좌표) — 세로로 부풀 때의 기준
uniform float uTopY;       // 빵 꼭대기 높이 (오브젝트 좌표)
uniform float uFillStart;  // 틀 빵이 굽기 시작할 때의 높이 비율 — 틀 벽보다 낮게
uniform float uFlatStart;  // 부은 반죽이면 1 — 시작 때 윗면이 평평하다
uniform float uHalfW;      // 빵의 가로 반폭 (오브젝트 좌표) — 가운데부터 부푸는 정도를 재는 기준
uniform vec2 uCenter;      // 빵의 가운데 (오브젝트 좌표 xz) — 한 틀에 여러 개 구울 때 저마다의 가운데에서 부푼다
uniform float uMorph;      // 1이면 aDough(토핑 올린 그 반죽의 겉면) → position(Blender 다 구운 모양)으로 부푼다
uniform float uStatic;     // 1이면 메시 그대로 (꺼내기 — 자른 면이 껍질과 꼭 맞아야 한다)
uniform float uMidScore;   // 굽는 중간에 칼집을 내는 빵이면 1 (팬케이크)
uniform float uScored;     // 칼집을 냈으면 1
uniform float uScoreOpen;  // 칼집이 벌어진 정도 0~1 — 낸 뒤 구워지며 서서히 벌어진다

// 정점마다의 굽기 분포 (Blender 카툰 에셋의 toast — 1이면 고르게). 갈변 정도에 곱해져
// 크루아상 결 사이·바게트 칼집 속·팬케이크 칼집 속처럼 덜 구워지는 자리가 오븐에서도 옅게 남는다
attribute float toast;
varying float vToast;
// 칼집(바게트) 깊이 — 가장 깊은 홈 = -1. 반죽 겉면에서 시작하니 처음엔 금만 있고 부풀며 벌어진다
attribute float score;
varying float vScoreLine;
// 칼집이 파 놓은 높이 변위 (팬케이크 — 오브젝트 좌표). 칼집을 내기 전엔 되돌려 매끈한 윗면을 보여 준다
attribute float scoreY;
// 같은 반죽 오브젝트 — 이 정점이 굽기 시작할 때 놓인 반죽 겉면의 자리·노멀 (breadModel.ts가 정점마다 찾아 둔다)
attribute vec3 aDough;
attribute vec3 aDoughN;

varying vec3 vViewNormal;
varying vec3 vObjNormal;
varying vec3 vObjPos;

void main() {
  vec3 p = position;
  vec3 nrm = normal;
  vScoreLine = 0.0;
  float scoreClosed = uMidScore * (1.0 - uScoreOpen) * clamp(abs(scoreY) * 150.0, 0.0, 1.0);
  if (uStatic < 0.5) {
    // 오븐 스프링: 처음엔 거의 그대로, 중반에 가장 빠르게, 끝에서 잦아드는 S자.
    // 넣자마자 다 부푼 모양이 되지 않도록 — 서서히 부푸는 걸 바라보는 게 이 게임이다.
    // 세로로는 가운데가 먼저 솟고 가장자리가 조금 늦게 따라온다 — 봉긋한 머리가 서서히 생긴다.
    float edge = clamp(length(position.xz - uCenter) / max(uHalfW, 0.01), 0.0, 1.0);
    float riseY = smoothstep(0.02 + 0.14 * edge * edge, 0.8 + 0.06 * edge, uProgress);
    // 부푸는 동안 숨 쉬듯 아주 느리게 들썩인다 — 한창 부풀 때 가장 크고 다 부풀면 멎는다
    float rising = 4.0 * riseY * (1.0 - riseY);
    float breathe = 1.0 + sin(uTime * 1.15 + uSeed) * 0.012 * rising;
    if (uMorph > 0.5) {
      // 토핑 올린 그 반죽에서 Blender 다 구운 모양으로 — 둘 다 그릇·트레이 안이라 밖으로 나가지 않는다.
      // 표면 요철을 더하지 않는다 — 부푸는 빵의 윤곽이 매끈하다(사용자 요청)
      vec3 baked = position;
      baked.y -= scoreY * uMidScore * (1.0 - uScoreOpen);
      p = mix(aDough, baked, riseY);
      p.y = uBaseY + (p.y - uBaseY) * breathe;
      nrm = normalize(mix(aDoughN, mix(normal, vec3(0.0, 1.0, 0.0), scoreClosed), riseY));
      // 막 그은 금 — 바게트는 반죽 겉면에서, 팬케이크는 칼집을 낸 순간부터
      vScoreLine = uMidScore > 0.5
        ? uScored * smoothstep(0.72, 0.93, -score) * (1.0 - uScoreOpen)
        : smoothstep(0.72, 0.93, -score) * (1.0 - smoothstep(0.0, 0.3, riseY));
    } else {
      // 절차적 메시(GLB를 못 불러왔을 때) — 메시를 줄였다가 키운다
      float rise = smoothstep(0.02, 0.8, uProgress);
      float scale = 1.0 + uSpring * rise;
      float scaleY = (1.0 + uSpring * riseY) * breathe;
      float h = p.y - uBaseY; // 바닥에서의 높이
      if (uMolded > 0.5) {
        // 틀 빵: 옆은 틀 벽에 막혀 그대로, 바닥을 기준으로 위로만 — 틀 벽보다 낮은 반죽에서 시작해 틀 위로 봉긋 솟는다
        float y = uBaseY + h * mix(uFillStart, scaleY, riseY);
        // 부은 반죽은 시작 때 윗면이 평평하다 — 부풀면서 둥글게 올라온다
        float level = uBaseY + (uTopY - uBaseY) * uFillStart * 0.9;
        p.y = mix(y, min(y, level), uFlatStart * (1.0 - smoothstep(0.0, 0.35, riseY)));
      } else {
        // 트레이 빵: 시작 땐 살짝 눌린 반죽, 부풀면서 옆으로도 커진다. 세로는 바닥을 기준으로 —
        // 원점을 중심으로 키우면 바닥이 트레이 아래로 꺼지거나 위로 떠 버린다
        p.xz = uCenter + (p.xz - uCenter) * scale;
        p.y = uBaseY + h * mix(0.82, 1.0, riseY) * scaleY;
      }
    }
  }
  vToast = mix(toast, 1.0, scoreClosed);
  vViewNormal = normalMatrix * nrm;
  vObjNormal = nrm;
  vObjPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uBrowning;  // 0~1.6
uniform float uSeed;
uniform float uLightOn;   // 오븐 조명 0/1
uniform vec3 uDough;
uniform vec3 uGold;
uniform vec3 uBrown;
uniform vec3 uCrumb;
uniform vec3 uTopCol[MAX_TOPPINGS];   // 토핑 슬롯별 알갱이 색
uniform float uTopDen[MAX_TOPPINGS];  // 토핑 슬롯별 밀도 (빈 슬롯은 0)
uniform float uTopSize[MAX_TOPPINGS]; // 토핑 슬롯별 알갱이 크기 배율
uniform float uGrid;                  // 와플 격자 0/1
uniform float uProgress;
uniform float uTime;
uniform float uFlatStart;             // 부은 반죽(batter)이면 1 — 날반죽 기포 자국과 굽는 동안의 기포
uniform float uSugar;                 // 구운 뒤 뿌린 슈가파우더 0~1 — 위를 향한 면에 하얗게 (꺼내기)
uniform float uDay;                   // 1이면 오븐 밖 밝은 조명 (꺼내기 — Blender 카툰 장면처럼 왼쪽 위의 하얀 빛)

varying vec3 vViewNormal;
varying vec3 vObjNormal;
varying vec3 vObjPos;
varying float vToast;
varying float vScoreLine;

${NOISE_GLSL}

void main() {
  vec3 N = normalize(vViewNormal);

  // 불균일 갈변 (마이야르): 노이즈로 얼룩덜룩하게
  float mottle = fbm(vObjPos * 1.8 + uSeed * 3.1) * 0.5 + 0.5;
  float b = uBrowning * vToast * (0.84 + 0.32 * mottle);
  // 위쪽이 먼저 노릇해진다
  b *= 0.85 + 0.3 * clamp(vObjPos.y + 0.5, 0.0, 1.0);

  // 와플 격자 — 윗면에서만. 칸 경계(볼록한 살)는 더 진하게 굽고 칸 안은 움푹해 그늘진다.
  // 판의 모서리가 격자선에 오도록 맞춘 값이라 breadMesh.ts의 와플 크기(1.45)와 짝이다.
  // 2D 짝: bread2d.ts의 drawGrid
  float ridge = 0.0;
  float gridTop = 0.0;
  if (uGrid > 0.5) {
    vec2 cell = abs(fract(vObjPos.xz * 3.45 + 0.5) - 0.5);
    ridge = smoothstep(0.36, 0.44, max(cell.x, cell.y));
    gridTop = smoothstep(0.5, 0.9, normalize(vObjNormal).y);
    b *= mix(1.0, mix(0.85, 1.2, ridge), gridTop);
  }

  vec3 col = mix(uDough, uGold, smoothstep(0.05, 0.6, b));

  // 날반죽 질감 — 아직 색이 나기 전의 크림 같은 무광 면: 고운 입자와 완만한 기복,
  // 부은 반죽이면 군데군데 작은 기포 자국. 구워지며 사라진다. 2D 짝: batter2d.ts
  float raw = 1.0 - smoothstep(0.05, 0.5, b);
  float upN = normalize(vObjNormal).y;
  if (raw > 0.0) {
    float grain = snoise(vObjPos * 42.0 + uSeed * 1.9);
    float swellTone = snoise(vObjPos * 3.2 + uSeed * 0.7);
    col *= 1.0 + raw * (grain * 0.035 + swellTone * 0.04);
    float pitN = snoise(vObjPos * 24.0 + uSeed * 2.3);
    float pit = smoothstep(0.72, 0.8, pitN) * uFlatStart * smoothstep(0.3, 0.8, upN);
    col *= 1.0 - pit * raw * 0.22;
  }

  // 부은 반죽은 부푸는 동안 윗면에 기포가 올라와 톡톡 터진다 (팬케이크의 보글보글)
  float bubbleOn = uFlatStart * smoothstep(0.06, 0.18, uProgress) * (1.0 - smoothstep(0.45, 0.65, uProgress));
  if (bubbleOn > 0.0) {
    float bn = snoise(vec3(vObjPos.xz * 10.0, uTime * 0.22 + uSeed));
    float rim = smoothstep(0.6, 0.66, bn) - smoothstep(0.7, 0.76, bn);
    float hole = smoothstep(0.78, 0.86, bn);
    float top = smoothstep(0.5, 0.85, upN) * bubbleOn;
    col = mix(col, col * 1.12, rim * top * 0.7);
    col = mix(col, col * 0.7, hole * top);
  }
  col = mix(col, uBrown, smoothstep(0.6, 1.25, b));
  col *= 1.0 - smoothstep(1.25, 1.7, b) * 0.4; // 아주 진하게
  col *= mix(1.0, mix(0.82, 1.0, ridge), gridTop); // 격자 칸 안의 그늘
  col *= 1.0 - 0.38 * vScoreLine; // 막 그은 칼집 — 날카로운 금

  // 토핑 알갱이 — 노이즈가 높은 곳에 얹히고, 위를 향한 면일수록 많이 붙는다.
  // 방향은 오브젝트 노멀로 판단해 빵 형태(납작한 쿠키 등)와 무관하게 동작한다.
  // 슬롯마다 노이즈를 다르게 밀어 두 토핑의 알갱이가 서로 겹치지 않게 흩어진다.
  // 2D 짝: bread2d.ts의 drawToppings (슬롯 i의 시드 = seed + 13 + i * 101)
  float up = smoothstep(-0.1, 0.55, normalize(vObjNormal).y);
  for (int i = 0; i < MAX_TOPPINGS; i++) {
    if (uTopDen[i] <= 0.0) continue;
    // 알갱이 크기는 2D(빵 폭의 5~11%)와 맞춘 값 — 주파수를 올리면 오븐 속 알갱이만 잘아진다
    float tn = snoise(vObjPos * (5.5 / uTopSize[i]) + uSeed * 5.3 + float(i) * 17.0);
    float edge = mix(0.62, 0.1, uTopDen[i]);
    float chip = smoothstep(edge, edge + 0.07, tn) * up;
    // 빵과 같이 구워지며 조금씩 진해진다
    vec3 chipCol = uTopCol[i] * (1.0 - smoothstep(0.5, 1.6, b) * 0.35);
    col = mix(col, chipCol, chip);
  }

  // 슈가파우더 — 체로 친 고운 가루라 위를 향한 면에 얼룩 없이 소복이
  if (uSugar > 0.0) {
    float sugarUp = smoothstep(0.15, 0.7, normalize(vObjNormal).y);
    float sugarN = snoise(vObjPos * 520.0 + uSeed) * 0.6 + snoise(vObjPos * 190.0 + uSeed * 1.7) * 0.4;
    // 다 뿌려도 빵 색이 비쳐 보이게 — 고운 가루가 군데군데 얇은 자리
    float sugarEdge = mix(1.05, 0.34, uSugar);
    col = mix(col, vec3(0.93, 0.91, 0.87), 0.88 * sugarUp * smoothstep(sugarEdge, sugarEdge + 0.22, sugarN * 0.5 + 0.5));
  }

  // 조명: 따뜻한 오븐 램프 + 꺼지면 발열체의 은은한 붉은 빛만. 오븐 밖(uDay)은 하얀 빛
  vec3 L = normalize(mix(vec3(0.3, 0.85, 0.55), vec3(-0.45, 0.8, 0.45), uDay));
  float diff = max(dot(N, L), 0.0);
  float lightAmt = mix(0.14, 1.0, uLightOn);
  vec3 warm = mix(vec3(1.0, 0.83, 0.62), vec3(1.0, 0.97, 0.92), uDay);
  vec3 emberTint = mix(vec3(1.0, 0.45, 0.25), vec3(1.0), uLightOn);
  vec3 lit = col * (0.32 + 0.78 * diff) * warm * lightAmt * emberTint + col * 0.10;

  // 림 라이트 — 창 너머 실루엣이 살아 보이게
  float rim = pow(1.0 - max(dot(N, vec3(0.0, 0.0, 1.0)), 0.0), 2.6) * mix(0.28, 0.08, uDay) * lightAmt;
  lit += warm * rim;

  gl_FragColor = vec4(lit, 1.0);
  // 색 uniform은 선형 값이다 — 화면 색으로 바꿔 내보내야 Blender 그림·실시간 반죽과 같은 색이 된다(빠지면 어둡고 진해진다)
  #include <colorspace_fragment>
}
`;

export interface BreadUniforms {
  uProgress: { value: number };
  uBrowning: { value: number };
  uSpring: { value: number };
  uSeed: { value: number };
  uLightOn: { value: number };
  uTime: { value: number };
  uDough: { value: THREE.Color };
  uGold: { value: THREE.Color };
  uBrown: { value: THREE.Color };
  uCrumb: { value: THREE.Color };
  uTopCol: { value: THREE.Color[] };
  uTopDen: { value: number[] };
  uTopSize: { value: number[] };
  uGrid: { value: number };
  uMolded: { value: number };
  uBaseY: { value: number };
  uTopY: { value: number };
  uFillStart: { value: number };
  uFlatStart: { value: number };
  uHalfW: { value: number };
  uCenter: { value: THREE.Vector2 };
  uMorph: { value: number };
  uStatic: { value: number };
  uMidScore: { value: number };
  uScored: { value: number };
  uScoreOpen: { value: number };
  uSugar: { value: number };
  uDay: { value: number };
}

export function makeBreadMaterial(
  plainDef: BreadDef,
  toppingIds: readonly ToppingId[],
  seed: number,
): THREE.ShaderMaterial & { uniforms: BreadUniforms } {
  // 녹차·커피 같은 가루 재료로 물든 색 — 2D 드로잉도 같은 함수를 쓴다
  const def = tintedBread(plainDef, toppingIds);
  const slots = toppingSlots(bakedToppingIds(toppingIds));
  const uniforms: BreadUniforms = {
    uProgress: { value: 0 },
    uBrowning: { value: 0 },
    uSpring: { value: def.spring },
    uSeed: { value: seed },
    uLightOn: { value: 1 },
    uTime: { value: 0 },
    // Blender 카툰 껍질(render_cartoon.crust_mat)과 같은 색 보정 — 반죽은 살짝, 노릇·진한 색은 채도를 올려 주황 쪽으로
    uDough: { value: toonColor(def.doughColor, 1.15, 1.04) },
    uGold: { value: toonColor(def.goldColor, 1.3, 1.1, 0.008) },
    uBrown: { value: toonColor(def.brownColor, 1.2, 1.45, 0.016) },
    uCrumb: { value: new THREE.Color(def.crumbColor) },
    uTopCol: { value: slots.map((s) => new THREE.Color(s.color)) },
    uTopDen: { value: slots.map((s) => s.density) },
    uTopSize: { value: slots.map((s) => s.size) },
    uGrid: { value: def.pattern === 'grid' ? 1 : 0 },
    uMolded: { value: def.vessel === 'tray' ? 0 : 1 },
    // uBaseY·uTopY·uHalfW·uCenter는 scene.ts가 지오메트리 바운딩 박스로 채운다
    uBaseY: { value: 0 },
    uTopY: { value: 1 },
    uFillStart: { value: def.fill === 'place' ? 0.6 : 0.5 },
    uFlatStart: { value: def.vessel !== 'tray' && def.fill !== 'place' ? 1 : 0 },
    uHalfW: { value: 1 },
    uCenter: { value: new THREE.Vector2(0, 0) },
    uMorph: { value: 0 },
    uStatic: { value: 0 },
    uMidScore: { value: def.midScore ? 1 : 0 },
    uScored: { value: 0 },
    uScoreOpen: { value: def.midScore ? 0 : 1 },
    uSugar: { value: 0 },
    uDay: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    defines: { MAX_TOPPINGS },
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  });
  return mat as THREE.ShaderMaterial & { uniforms: BreadUniforms };
}

// ---------------------------------------------------------------- 오븐 속 토핑 알갱이
// 토핑 화면에서 흩뿌린 그 알갱이가 반죽과 함께 부푼다 — 알갱이마다 시작 자리(반죽 겉면)와 끝 자리(다 구운 겉면)가 있고,
// 빵 정점과 같은 식으로 움직인다. 크기·자세는 그대로이고, 빵과 같이 구워지며 조금씩 진해진다.
const BIT_VERTEX = /* glsl */ `
uniform float uProgress;
uniform float uSeed;
uniform float uTime;
attribute vec3 iFrom;
attribute vec3 iTo;
attribute vec3 iScale;
attribute vec4 iQuat;
attribute vec3 iColor;
attribute vec4 iBread; // 이 알갱이가 얹힌 빵의 가운데 xz, 반폭, 바닥 높이
varying vec3 vN;
varying vec3 vCol;

vec3 rot(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

void main() {
  float edge = clamp(length(iTo.xz - iBread.xy) / max(iBread.z, 0.01), 0.0, 1.0);
  float riseY = smoothstep(0.02 + 0.14 * edge * edge, 0.8 + 0.06 * edge, uProgress);
  float rising = 4.0 * riseY * (1.0 - riseY);
  float breathe = 1.0 + sin(uTime * 1.15 + uSeed) * 0.012 * rising;
  vec3 at = mix(iFrom, iTo, riseY);
  at.y = iBread.w + (at.y - iBread.w) * breathe;
  vN = normalMatrix * rot(iQuat, normal / iScale);
  vCol = iColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(at + rot(iQuat, position * iScale), 1.0);
}
`;

const BIT_FRAGMENT = /* glsl */ `
uniform float uBrowning;
uniform float uLightOn;
varying vec3 vN;
varying vec3 vCol;

void main() {
  vec3 N = normalize(vN);
  vec3 col = vCol * (1.0 - smoothstep(0.5, 1.6, uBrowning) * 0.35);
  vec3 L = normalize(vec3(0.3, 0.85, 0.55));
  float diff = max(dot(N, L), 0.0);
  float lightAmt = mix(0.14, 1.0, uLightOn);
  vec3 warm = vec3(1.0, 0.83, 0.62);
  vec3 emberTint = mix(vec3(1.0, 0.45, 0.25), vec3(1.0), uLightOn);
  gl_FragColor = vec4(col * (0.32 + 0.78 * diff) * warm * lightAmt * emberTint + col * 0.1, 1.0);
  #include <colorspace_fragment>
}
`;

/** 오븐 속 토핑 알갱이 재질 — uProgress·uBrowning·uTime·uLightOn을 빵 재질과 함께 밀어 넣는다 */
export function makeBitMaterial(seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uBrowning: { value: 0 },
      uTime: { value: 0 },
      uLightOn: { value: 1 },
      uSeed: { value: seed },
    },
    vertexShader: BIT_VERTEX,
    fragmentShader: BIT_FRAGMENT,
  });
}
