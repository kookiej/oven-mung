// 반죽 단계 — 고른 빵의 재료를 볼에 드래그해 넣고, 섞어서 반죽을 만든다.
// 볼은 Blender로 렌더한 그림, 볼 속은 실시간 3D(render/live) — 볼 그림의 카메라 그대로라 내용물이 볼 '안에' 보인다.
// 넣기: 재료는 모두 볼 가운데로 들어간다. 가루는 계량컵에서 솔솔 쏟아져 가운데에 소복이 쌓이고, 액체는 줄기로 흘러
//       볼 바닥 전체로 번진다(처음엔 빠르고 점점 느리게). 고인 면은 빠르게 일정한 속도로 차오르고 아주 살짝 출렁인다.
//       액체는 들어오자마자 내용물과 섞인다 — 제 색의 얼룩이 소용돌이치며 번지다 옅어져 하나의 색이 된다. 줄기는 3D 관.
//       쌓이는 재료(가루·달걀·버터)는 먼저 들어온 재료의 생김새를 따라 층층이 얹힌다(render/live/drape.ts) —
//       가루는 재료마다 제 결로 쌓여(render/live/powder.ts) 액체에 서서히 녹아들고, 날달걀은 맑은 흰자가 그 면을 따라
//       흘러내리고 노른자도 그 면을 따라 모양이 변한 채 앉아 있다가 섞으면 풀어진다. 버터는 툭 떨어져 쌓인 재료에 반쯤
//       묻힐 뿐 내용물 색을 바꾸지 않는다. 꿀은 끈적하다 — 가는 줄기로 천천히 흘러 똬리를 틀며 봉긋이 쌓이고, 아주 천천히
//       퍼지며, 물에 닿아도 바로 섞이지 않고 가라앉는다. 저어야 풀린다.
// 섞기: 묽은 반죽(틀에 붓는 빵)은 거품기로 빙글빙글 — 멍울이 거품기를 따라 돌며 녹고 면의 결이 같이 돈다.
//       덩어리 반죽은 재료가 한 덩이로 뭉친 뒤 손가락을 따라 볼 안을 자유롭게 굴러다닌다(가운데에 묶이지 않는다) —
//       움직이는 쪽으로 늘어나고, 놓으면 볼의 비탈을 따라 흔들리며 미끄러진다. 굴린 만큼 매끈해진다.
// 전략 없음: 얼마나 섞었는지가 반죽 거칠기(질감)에만 살짝 반영된다.
import * as THREE from 'three';
import type { StageCtx } from '../main';
import { confirmSheet, el } from '../ui';
import { BREADS, getBread } from '../content/breads';
import { ingredientsOf, toppingIngredient, type Ingredient } from '../content/ingredients';
import { bowlToppings, tintedBread } from '../content/toppings';
import { isBatter, moldTitle } from '../content/vessels';
import { formStepsOf } from '../content/forming';
import { META, loadSprites, ready, sprite } from '../render/sprites';
import { StageView } from '../render/live/stageView';
import { Blob, PourStream, levelFor, pooledGeometry, volumeTo, wallAt, type WallTable } from '../render/live/geo';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { batterMaterial, doughMaterial, glossy, honeyMaterial, liquidMaterial, rawEggWhiteMaterial } from '../render/live/materials';
import { DrapedLayer, type HeightFn } from '../render/live/drape';
import { PowderPile } from '../render/live/powder';
import { BALL_H, BALL_SEED, R0 } from '../render/live/formShapes';
import { dev } from '../dev/devState';
import { hapticThud, hapticTick } from '../native';
import { clamp, lerp, mixHex, smoothstep } from '../util';
import type { BreadId, ToppingId } from '../types';

/** 거품기로 이만큼 돌리면 완전히 매끈한 반죽 (약 6바퀴) */
const TARGET_ANGLE = Math.PI * 12;
/** 덩어리 반죽을 이만큼(미터) 굴리면 완전히 매끈한 반죽 */
const TARGET_ROLL = 1.1;
/** 볼 바닥에서 쌓인 재료를 띄우는 높이(미터) — 볼 메시의 각진 면을 뚫지 않게 */
const STACK_LIFT = 0.0012;
/** 재료 하나가 들어가는 모션 길이(초) */
const ADD_SEC = 1.2;
/** 끈적한 재료(꿀)가 들어가는 모션 길이(초) — 천천히 흐른다 */
const ADD_VISCOUS_SEC = 3.6;
/** 꿀이 퍼지는 시간 상수(초) — 다 부은 뒤에도 한참 천천히 퍼진다 */
const HONEY_TAU = 9;
/** 꿀이 다 퍼졌을 때의 두께(미터) */
const HONEY_H = 0.0085;
/** 쌓인 재료에 버터가 묻히는 비율 (버터 높이 기준) */
const BUTTER_BURY = 0.6;
/** 노른자가 그 자리의 평균 비탈을 따르는 비율과 최대 기울기 */
const YOLK_TILT = 0.7;
const YOLK_MAX_SLOPE = 0.8;
/** 노른자가 세부 굴곡을 따르는 비율 — 1이면 능선을 따라 가늘게 찌그러진다 */
const YOLK_CONFORM = 0.4;
/** 재료 양 1(밀가루 한 번)이 볼 부피에서 차지하는 비율 */
const VOL_PER_AMOUNT = 0.12;
/** 가루가 액체에 녹아드는 빠르기 (초당) */
const DISSOLVE = 0.12;
/** 액체가 바닥으로 번지는 빠르기 — 남은 거리의 이 비율씩(초당, 지수적으로 다가감) */
const SPREAD_K = 2.4;
/** 고인 면이 차오르는 속도(미터/초) — 빠르게, 일정하게 */
const RISE_SPEED = 0.05;
/** 붓는 동안 고인 면의 출렁임 (미터) — 아주 살짝 */
const SLOSH_AMP = 0.0007;
/** 막 들어온 액체의 얼룩이 내용물에 녹아드는 빠르기 (초당) */
const BLEND_K = 1.4;
const SOURCE = { powder: 'scoop', liquid: 'jug', viscous: 'jug', egg: 'egg', solid: 'butter' } as const;
/** 다 뭉친 반죽 덩어리의 반지름 [가로, 높이, 깊이] — 모양 빚기 판 위의 그 공과 같은 크기 */
const DOUGH_R: [number, number, number] = [R0, BALL_H, R0];
/** 깨 넣은 달걀 — 노른자와 흰자가 바로 풀린 색 */
const EGG_MIX = '#f4cf6e';

/** 볼에 쌓인 층 하나 — 나중 층은 앞선 층들의 생김새를 따라 앉는다 */
interface Stacked {
  /** 무대 좌표 (x, z)에서 이 층의 두께 */
  thickness: HeightFn;
  /** 이 층이 앉는 면의 하한 — 액체 면 */
  sit: () => number;
}

interface Pile extends Stacked {
  pile: PowderPile;
  ing: Ingredient;
  /** 아직 녹지 않은 부피 */
  vol: number;
  /** 놓인 방향 — 앞선 더미의 비탈에 조금 비켜 앉는다 */
  ang: number;
  sat: number;
  last: [number, number, number, number];
}

/** 볼에 얹힌 날달걀 — 맑은 흰자 + 노른자. 섞으면 풀어져 내용물이 된다 */
interface EggInBowl extends Stacked {
  white: DrapedLayer;
  whiteMesh: THREE.Mesh;
  yolk: THREE.Mesh;
  /** 노른자 메시의 단위 구 좌표 — 아래 재료의 생김새대로 정점을 다시 앉힌다 */
  yolkUnit: Float32Array;
  y: number;
  vy: number;
  landed: number;
  vol: number;
  /** 아직 풀어지지 않은 비율 */
  left: number;
  off: number;
  reach: number;
  last: [number, number, number, number];
}

interface ButterInBowl extends Stacked {
  mesh: THREE.Mesh;
  y: number;
  vy: number;
  landed: boolean;
  cx: number;
  cz: number;
  /** 놓인 방향과 가운데에서의 거리 */
  spot: number;
  reach: number;
  ang: number;
  k: number;
  /** 쌓인 재료에 묻힌 깊이(미터) */
  sink: number;
  /** 묻히며 밀려 올라온 가루 — 버터 둘레의 둔덕 */
  collar: DrapedLayer;
  collarMesh: THREE.Mesh | null;
  last: [number, number, number, number];
}

/** 볼에 쌓인 꿀 — 저어야 풀린다 */
interface HoneyInBowl extends Stacked {
  layer: DrapedLayer;
  mesh: THREE.Mesh;
  ing: Ingredient;
  /** 지금까지 부은 양 */
  vol: number;
  r: number;
  /** 풀어지지 않은 비율 */
  left: number;
  /** 앉은 면 — 액체에 떨어지면 천천히 가라앉는다 */
  sat: number;
  last: [number, number, number, number];
  /** 줄기가 떨어지는 자리에 틀어지는 똬리들 */
  coils: THREE.Mesh[];
  flowing: boolean;
}

interface Adding {
  ing: Ingredient;
  stream?: PourStream;
  t: number;
  particles: { x: number; y: number; vx: number; vy: number }[];
  /** 이 재료가 볼에 보탠 양 (0~1 진행) */
  given: number;
  pile?: Pile;
  honey?: HoneyInBowl;
}

export function mountKneading(root: HTMLElement, ctx: StageCtx, data?: unknown): () => void {
  const d = data as { breadId?: BreadId; toppingIds?: ToppingId[]; seed?: number } | undefined;
  const breadId = d?.breadId;
  if (!breadId || !BREADS.some((b) => b.id === breadId)) {
    ctx.go('choose');
    return () => {};
  }
  const def = getBread(breadId);
  const toppingIds = d?.toppingIds ?? [];
  const seed = d?.seed ?? Math.random() * 100;
  // 차·향신료 같은 가루 토핑은 여기서 볼에 함께 넣는다 — 반죽이 처음부터 그 색으로 물든다
  const INGREDIENTS = [...ingredientsOf(def), ...bowlToppings(toppingIds).map(toppingIngredient)];
  const doughColor = tintedBread(def, toppingIds).doughColor;
  const batter = isBatter(def);
  const nextStage = formStepsOf(def) ? 'forming' : 'mold';
  const nextLabel = formStepsOf(def) ? '모양 빚기' : moldTitle(def);
  const showSkip = dev().enabled && dev().skipKnead;

  void loadSprites(Object.values(SOURCE).map((s) => `tool/${s}`).concat('tool/whisk'));

  const view = el(`
    <div class="knead-view">
      <div class="stage-header">
        <button class="btn btn-ghost" data-back>←</button>
        <span class="stage-title">${def.emoji} ${def.name} ${batter ? '반죽 섞기' : '반죽하기'}</span>
        ${showSkip ? '<button class="btn btn-ghost dev-skip" data-skip title="개발자: 반죽 건너뛰기">⏭</button>' : '<span></span>'}
      </div>
      <div data-stage class="stage-slot"></div>
      <p class="hint" data-hint>재료를 볼에 담아주세요</p>
      <div class="ingredient-tray" data-tray>
        ${INGREDIENTS.map(
          (ing, i) =>
            `<button class="chip" data-chip="${i}"><span class="chip-emoji">${ing.emoji}</span>${ing.name}</button>`,
        ).join('')}
      </div>
      <button class="btn btn-primary btn-big knead-continue" data-continue hidden>
        이대로 ${nextLabel}
      </button>
    </div>
  `);
  root.appendChild(view);
  const sv = new StageView('knead', 0.56);
  view.querySelector('[data-stage]')!.replaceWith(sv.el);
  const hint = view.querySelector<HTMLElement>('[data-hint]')!;
  const tray = view.querySelector<HTMLElement>('[data-tray]')!;
  const continueBtn = view.querySelector<HTMLButtonElement>('[data-continue]')!;

  // ---- 볼 모양 (sprites.json의 stage.knead, three.js 미터) ----
  const sm = META.stage.knead ?? {};
  const W: WallTable = (sm.wall ?? [
    [0.012, 0.05],
    [0.08, 0.11],
  ]) as WallTable;
  const floorY = sm.floorY ?? W[0][0];
  const rimY = sm.rimY ?? W[W.length - 1][0];
  const bowlVol = volumeTo(W, rimY);
  const rAt = (y: number) => wallAt(W, y);
  /** 반지름 r 자리의 볼 안쪽 바닥 높이 */
  function floorAt(r: number): number {
    if (r <= W[0][1]) return floorY;
    let lo = floorY;
    let hi = rimY;
    for (let k = 0; k < 24; k++) {
      const m = (lo + hi) / 2;
      if (rAt(m) < r) lo = m;
      else hi = m;
    }
    return (lo + hi) / 2;
  }
  // 쌓인 재료의 정점마다 바닥을 묻는다 — 표로 미리 계산해 둔다
  const FLOOR_N = 96;
  const floorRim = rAt(rimY);
  const floorTable = Float32Array.from({ length: FLOOR_N + 1 }, (_, i) => floorAt((i / FLOOR_N) * floorRim));
  function floorFast(r: number): number {
    const f = Math.min(FLOOR_N - 1e-3, (r / floorRim) * FLOOR_N);
    const i = Math.floor(f);
    return floorTable[i] + (floorTable[i + 1] - floorTable[i]) * (f - i);
  }

  // ---- 상태 ----
  let ingredientsIn = 0;
  let mixAccum = 0;
  let lastHapticAt = 0;
  let disposed = false;
  let raf = 0;
  let clock = 0;
  const adding: Adding[] = [];
  const piles: Pile[] = [];
  const eggs: EggInBowl[] = [];
  const honeys: HoneyInBowl[] = [];
  /** 볼에 쌓인 층들 — 들어온 순서 (가루·달걀·버터) */
  const stack: Stacked[] = [];
  /** 볼에 고인 액체·녹아든 재료의 부피와 그 색 (부피 가중 평균) */
  let poolVol = 0;
  let poolColor = '#ffffff';
  let poolClear = 1; // 맑은 액체 비율 (물·기름) — 높을수록 비친다
  let spreadR = 0;
  /** 보이는 고인 부피 — 실제 부피(poolVol)를 일정한 속도로 따라간다 */
  let levelVol = 0;
  /** 출렁임의 세기 0~1 */
  let slosh = 0;
  /** 막 들어온 액체의 얼룩 */
  const incoming = { color: new THREE.Color(), r: 0, a: 0, pouring: false };
  let butter: ButterInBowl | null = null;

  // 섞기
  let mixing = false;
  let pointer = { x: 0, y: 0 };
  let swirl = 0;
  let lastAngle = 0;
  const kneadProgress = () => clamp(mixAccum / (batter ? TARGET_ANGLE : TARGET_ROLL), 0, 1);

  // ---- 3D 내용물 ----
  let poolMesh: THREE.Mesh | null = null;
  let poolMat: ReturnType<typeof liquidMaterial> | null = null;
  let batterMesh: THREE.Mesh | null = null;
  const batterMat = batterMaterial(doughColor);
  batterMat.transparent = true;
  const lumps: { mesh: THREE.Mesh; a: number; r: number; speed: number }[] = [];
  // 덩어리 반죽
  const blob = new Blob(BALL_SEED);
  const doughMat = doughMaterial(doughColor, true);
  const doughMesh = new THREE.Mesh(blob.geometry, doughMat);
  doughMesh.castShadow = true;
  doughMesh.visible = false;
  const doughPos = new THREE.Vector2();
  const doughVel = new THREE.Vector2();
  const roll = new THREE.Quaternion();
  let dragging = false;
  let dragTarget = new THREE.Vector2();

  function stage() {
    return sv.stage;
  }

  sv.load().then((st) => {
    if (disposed) return;
    st.scene.add(doughMesh);
  });

  /** 내용물 윗면 높이 — 보이는 부피 기준 */
  let surfaceVol = -1;
  let surfaceAt = floorY;
  // 쌓인 재료의 정점마다 물어보는 값이라 부피가 바뀔 때만 다시 계산한다
  const surfaceY = () => {
    if (levelVol !== surfaceVol) {
      surfaceVol = levelVol;
      surfaceAt = levelVol > 1e-9 ? levelFor(W, levelVol) : floorY;
    }
    return surfaceAt;
  };
  const center = () => new THREE.Vector3(0, surfaceY(), 0);
  /** (x, z)에서 stack의 앞쪽 n개 층까지 쌓은 윗면 — 볼 바닥에서 시작해, 층이 덮는 자리마다 그 두께만큼 올라간다 */
  function topOf(n: number, x: number, z: number): number {
    let t = floorFast(Math.hypot(x, z)) + STACK_LIFT;
    for (let i = 0; i < n; i++) {
      const th = stack[i].thickness(x, z);
      if (th > 0) t = Math.max(t, stack[i].sit()) + th;
    }
    return t;
  }
  /** 재료가 떨어지는 자리 — 쌓인 재료 꼭대기 또는 액체 면 */
  const landing = () => new THREE.Vector3(0, Math.max(topOf(stack.length, 0, 0), surfaceY()), 0);

  let lastLevel = -1;
  function rebuildPool(): void {
    const st = stage();
    if (!st) return;
    const level = surfaceY();
    if (Math.abs(level - lastLevel) < 0.00015 && poolMesh) return;
    lastLevel = level;
    if (levelVol <= 1e-9 || level - floorY < 0.0005) {
      if (poolMesh) poolMesh.visible = false;
      if (batterMesh) batterMesh.visible = false;
      return;
    }
    const geo = pooledGeometry(W, floorY + 0.0004, level, { meniscus: 0.0012 });
    if (!poolMesh) {
      poolMat = liquidMaterial(poolColor, false);
      poolMesh = new THREE.Mesh(geo, poolMat);
      poolMesh.receiveShadow = true;
      st.scene.add(poolMesh);
      batterMesh = new THREE.Mesh(geo, batterMat);
      batterMesh.receiveShadow = true;
      batterMesh.renderOrder = 2;
      st.scene.add(batterMesh);
    } else {
      poolMesh.geometry.dispose();
      poolMesh.geometry = geo;
      batterMesh!.geometry = geo;
    }
    poolMat!.spread.slosh.level.value = level;
    batterMat.spread.slosh.level.value = level;
    poolMesh.visible = true;
  }

  /** 볼에 부피를 보탠다 — 색은 부피 가중 평균으로 섞인다 */
  function pour(vol: number, color: string, clear: boolean): void {
    if (vol <= 0) return;
    const total = poolVol + vol;
    poolColor = mixHex(poolColor === '#ffffff' && poolVol === 0 ? color : poolColor, color, vol / total);
    poolClear = (poolClear * poolVol + (clear ? 1 : 0) * vol) / total;
    poolVol = total;
  }

  function makePile(ing: Ingredient): Pile {
    const pile = new PowderPile(ing.color, ing.grain ?? 'flour', piles.length * 1.7 + 0.9, stack.length > 0);
    stage()?.scene.add(pile.mesh);
    // 앉는 면은 들어올 때의 액체 면 — 나중에 액체가 차오르면 그 속에 잠긴다
    const sat = surfaceY() - 0.0012;
    const p: Pile = {
      pile,
      ing,
      vol: 0,
      ang: piles.length * 2.4,
      sat,
      last: [0, 0, 0, 0],
      thickness: (x, z) => pile.thickness(x, z),
      sit: () => sat,
    };
    piles.push(p);
    stack.push(p);
    return p;
  }

  /** 층 하나를 다시 앉힌다 — 크기·자리가 그대로이고 아래층도 그대로면 건너뛴다. 다시 앉혔으면 참 */
  const CHANGED = 0.00008;
  function moved(last: [number, number, number, number], r: number, h: number, cx: number, cz: number): boolean {
    if (Math.abs(last[0] - r) < CHANGED && Math.abs(last[1] - h) < CHANGED && Math.abs(last[2] - cx) < CHANGED && Math.abs(last[3] - cz) < CHANGED) return false;
    last[0] = r;
    last[1] = h;
    last[2] = cx;
    last[3] = cz;
    return true;
  }

  /** 쌓인 층들을 차례로 앉힌다 — 아래층이 움직이면 그 위의 층들도 따라 움직인다 */
  function layStack(fade: number, dt: number): void {
    const s = 1 - fade;
    let dirty = false;
    for (let i = 0; i < stack.length; i++) {
      const below = (x: number, z: number) => Math.max(topOf(i, x, z), stack[i].sit());
      const l = stack[i];
      const pile = piles.find((p) => p === l);
      if (pile) {
        if (pile.vol <= 1e-9 || s <= 0.02) {
          pile.pile.mesh.visible = false;
          if (pile.pile.thickness(0, 0) !== 0 || pile.last[0] !== 0) {
            pile.pile.shape(0, 0, 0, 0, below);
            pile.last = [0, 0, 0, 0];
            dirty = true;
          }
          continue;
        }
        // 소복한 더미 — 가루는 보슬보슬해 액체로 녹아든 부피보다 작게 보인다
        const v = pile.vol * 0.45;
        const r = Math.cbrt((5 * v) / Math.PI) * s;
        const h = r * pile.pile.heightRatio;
        // 나중 더미는 앞선 더미의 비탈로 조금 비켜 앉아 먼저 쌓인 가루의 결이 보인다
        const off = i ? r * 0.65 : 0;
        const cx = Math.cos(pile.ang) * off;
        const cz = Math.sin(pile.ang) * off;
        pile.pile.mesh.visible = true;
        if (moved(pile.last, r, h, cx, cz) || dirty) {
          pile.pile.shape(r, h, cx, cz, below);
          dirty = true;
        }
        continue;
      }
      const egg = eggs.find((e) => e === l);
      if (egg) {
        if (shapeEgg(egg, i, dt, dirty)) dirty = true;
        continue;
      }
      const honey = honeys.find((h) => h === l);
      if (honey) {
        if (shapeHoney(honey, i, dt, dirty)) dirty = true;
        continue;
      }
      if (butter && butter === l && shapeButter(butter, i, dt, dirty)) dirty = true;
    }
  }

  // ---- 재료 칩 드래그 — 볼 어디에 놓아도 가운데로 들어간다 ----
  for (const chip of view.querySelectorAll<HTMLButtonElement>('[data-chip]')) {
    let startX = 0;
    let startY = 0;
    chip.addEventListener('pointerdown', (e) => {
      chip.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;
      chip.classList.add('dragging');
    });
    chip.addEventListener('pointermove', (e) => {
      if (!chip.classList.contains('dragging')) return;
      chip.style.transform = `translate(${e.clientX - startX}px, ${e.clientY - startY}px) scale(1.15)`;
    });
    chip.addEventListener('pointerup', (e) => {
      chip.classList.remove('dragging');
      chip.style.transform = '';
      const st = stage();
      if (!st) return;
      const r = sv.fg.getBoundingClientRect();
      const c = st.project(new THREE.Vector3(0, floorY, 0));
      const R = st.pixelsPerMeter(new THREE.Vector3(0, rimY, 0)) * rAt(rimY);
      if (Math.hypot(e.clientX - r.left - c.x, e.clientY - r.top - c.y) > R * 1.3) return;
      chip.disabled = true;
      chip.classList.add('used');
      const ing = INGREDIENTS[Number(chip.dataset.chip)];
      const a: Adding = { ing, t: 0, particles: [], given: 0 };
      if (ing.kind === 'powder') a.pile = makePile(ing);
      adding.push(a);
      ingredientsIn++;
      void hapticTick();
      if (ingredientsIn >= INGREDIENTS.length) {
        hint.textContent = batter ? '거품기로 빙글빙글 저어주세요' : '반죽을 잡고 볼 안에서 이리저리 굴려주세요';
        tray.classList.add('done');
      }
    });
    chip.addEventListener('pointercancel', () => {
      chip.classList.remove('dragging');
      chip.style.transform = '';
    });
  }

  // ---- 섞기 입력 ----
  const fg = sv.fg;
  const angleAt = (p: { x: number; y: number }) => {
    const st = stage();
    if (!st) return 0;
    const c = st.project(center());
    return Math.atan2(p.y - c.y, p.x - c.x);
  };
  fg.addEventListener('pointerdown', (e) => {
    if (ingredientsIn < INGREDIENTS.length) return;
    fg.setPointerCapture(e.pointerId);
    pointer = sv.local(e);
    mixing = true;
    lastAngle = angleAt(pointer);
    dragging = !batter;
    updateDragTarget();
  });
  function updateDragTarget(): void {
    const st = stage();
    if (!st) return;
    const hit = st.onPlane(pointer.x, pointer.y, floorAt(doughPos.length()) + 0.02);
    if (hit) dragTarget = new THREE.Vector2(hit.x, hit.z);
  }
  fg.addEventListener('pointermove', (e) => {
    pointer = sv.local(e);
    if (!mixing) return;
    if (batter) {
      const a = angleAt(pointer);
      let d = a - lastAngle;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      lastAngle = a;
      const dd = clamp(d, -0.3, 0.3); // 순간이동 방지
      swirl += dd;
      advance(Math.abs(dd));
    } else updateDragTarget();
  });
  const stopMixing = () => {
    if (mixing && dragging) void hapticThud();
    mixing = false;
    dragging = false;
  };
  fg.addEventListener('pointerup', stopMixing);
  fg.addEventListener('pointercancel', stopMixing);

  function advance(gain: number): void {
    mixAccum += gain;
    const step = batter ? Math.PI * 2 : 0.12;
    if (mixAccum - lastHapticAt > step) {
      lastHapticAt = mixAccum;
      void hapticTick();
    }
    const prog = kneadProgress();
    if (prog >= 1) {
      hint.textContent = batter ? '멍울 없이 매끈해졌어요!' : '매끈해졌어요! 이 정도면 충분해요';
      continueBtn.textContent = `${nextLabel} →`;
      continueBtn.hidden = false;
    } else if (prog > 0.25) {
      hint.textContent = '점점 매끈해지고 있어요…';
      continueBtn.hidden = false;
    }
  }

  // ---- 재료 넣는 모션 ----
  /** 쏟는 도구의 기울기 — 들어와서 기울었다가 돌아간다 */
  const tiltOf = (t: number) => -1.0 * smoothstep(0.05, 0.22, t) * (1 - smoothstep(0.72, 0.9, t));

  /** 도구 그림의 기준점을 화면의 p에 맞춰 그린다. 기울기는 기준점을 축으로 */
  function drawTool(g: CanvasRenderingContext2D, key: string, p: { x: number; y: number }, angle: number, alpha: number, half = 0, split = 0): void {
    const img = sprite(`tool/${key}`);
    const tm = META.tool[key];
    if (!ready(img) || alpha <= 0 || !tm?.center) return;
    const b = sv.box;
    g.save();
    g.globalAlpha = alpha;
    g.translate(p.x + half * split * b.size * 0.05, p.y - split * b.size * 0.012);
    g.rotate(angle + half * split * 0.7);
    if (half) {
      g.beginPath();
      g.rect(half < 0 ? -b.size : 0, -b.size, b.size, b.size * 2);
      g.clip();
    }
    g.drawImage(img, -tm.center[0] * b.size, -tm.center[1] * b.size, b.size, b.size);
    g.restore();
  }
  /** 도구가 angle만큼 기울었을 때 입구(lip)의 화면 자리 */
  function lipOf(key: string, p: { x: number; y: number }, angle: number): { x: number; y: number } {
    const tm = META.tool[key];
    const lip = tm?.lip ?? tm?.center ?? [0.5, 0.5];
    const c = tm?.center ?? [0.5, 0.5];
    const dx = (lip[0] - c[0]) * sv.box.size;
    const dy = (lip[1] - c[1]) * sv.box.size;
    return { x: p.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: p.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
  }

  /** 도구가 놓이는 자리 — 기울였을 때 입구가 볼 가운데 바로 위에 오도록 */
  function sourceAt(key: string): { x: number; y: number } {
    const st = stage()!;
    const above = st.project(new THREE.Vector3(...((sm.above ?? [0, rimY + 0.07, 0]) as [number, number, number])));
    const tilt = tiltOf(0.5);
    const lip = lipOf(key, above, tilt);
    return { x: above.x + (above.x - lip.x), y: above.y };
  }

  function updateAdding(dt: number): void {
    const st = stage();
    if (!st) return;
    const land = st.project(landing());
    for (const a of adding) {
      a.t = Math.min(1, a.t + dt / (a.ing.kind === 'viscous' ? ADD_VISCOUS_SEC : ADD_SEC));
      const { ing } = a;
      const vol = ing.amount * VOL_PER_AMOUNT * bowlVol;
      // 이번 프레임에 볼에 닿은 양
      let give = 0;
      if (ing.kind === 'powder') {
        if (a.t > 0.15 && a.t < 0.7) {
          const key = SOURCE.powder;
          const lip = lipOf(key, sourceAt(key), tiltOf(a.t));
          for (let i = 0; i < 4; i++) {
            a.particles.push({ x: lip.x + (Math.random() - 0.5) * 6, y: lip.y, vx: (Math.random() - 0.5) * 30, vy: Math.random() * 40 });
          }
        }
        give = smoothstep(0.22, 0.8, a.t) - a.given;
        if (a.pile) a.pile.vol += give * vol;
      } else if (ing.kind === 'liquid') {
        // 붓는 양은 일정하게 — 고인 면이 일정한 속도로 오른다
        give = clamp((a.t - 0.2) / 0.5, 0, 1) - a.given;
        pour(give * vol, ing.color, !!ing.clear);
        if (give > 0) {
          spreadR = Math.max(spreadR, 0.002);
          // 떨어지는 자리(가운데)에서 제 색으로 소용돌이치며 번지다 섞인다
          if (!incoming.pouring) incoming.r = Math.min(incoming.r, 0.004);
          incoming.color.set(ing.color);
          incoming.a = Math.max(incoming.a, poolVol > give * vol * 1.5 ? 0.8 : 0);
          incoming.pouring = true;
        }
        // 줄기 — 입구에서 볼 가운데로 떨어지는 3D 관
        if (a.t > 0.15 && !a.stream) {
          a.stream = new PourStream(
            new THREE.MeshPhysicalMaterial({
              color: ing.color,
              roughness: 0.2,
              transparent: !!ing.clear,
              opacity: ing.clear ? 0.65 : 1,
            }),
          );
          st.scene.add(a.stream.mesh);
        }
        if (a.stream) {
          const cut = smoothstep(0.64, 0.78, a.t);
          if (cut >= 1) a.stream.mesh.visible = false;
          else {
            const key = SOURCE.liquid;
            const lip = lipOf(key, sourceAt(key), tiltOf(a.t));
            const top = st.onPlane(lip.x, lip.y, rimY + 0.07);
            if (top) {
              a.stream.update(top, landing(), 0.0042 * (1 - smoothstep(0.56, 0.76, a.t) * 0.5), clock, cut);
              a.stream.mesh.visible = true;
            }
          }
        }
      } else if (ing.kind === 'viscous') {
        // 일정한 양이 천천히 — 내용물로 바로 섞이지 않고 제 덩이로 쌓인다
        give = clamp((a.t - 0.15) / 0.62, 0, 1) - a.given;
        if (give > 0 && !a.honey) a.honey = addHoney(st, ing);
        if (a.honey) {
          a.honey.vol += Math.max(0, give) * vol;
          a.honey.flowing = a.t < 0.86;
        }
        // 줄기 — 끊기지 않고 가늘게 늘어지다 마지막에야 끊어진다
        if (a.t > 0.15 && !a.stream) {
          a.stream = new PourStream(honeyMaterial(ing.color));
          st.scene.add(a.stream.mesh);
        }
        if (a.stream) {
          const cut = smoothstep(0.8, 0.98, a.t);
          if (cut >= 1) a.stream.mesh.visible = false;
          else {
            const key = SOURCE.viscous;
            const lip = lipOf(key, sourceAt(key), tiltOf(a.t));
            const from = st.onPlane(lip.x, lip.y, rimY + 0.07);
            if (from) {
              // 끝은 쌓인 꿀 위에서 작은 원을 그린다 — 끈적한 줄기가 똬리를 틀 때의 모습
              const to = landing();
              const orbit = a.honey?.flowing ? 0.0042 : 0;
              to.x += Math.cos(clock * 8) * orbit;
              to.z += Math.sin(clock * 8) * orbit;
              to.y += a.honey?.flowing ? 0.004 : 0;
              a.stream.update(from, to, 0.0034 * (1 - smoothstep(0.66, 0.9, a.t) * 0.72), clock, cut, true);
              a.stream.mesh.visible = true;
            }
          }
        }
      } else if (ing.kind === 'egg') {
        // 껍데기가 갈라지면 날달걀이 떨어져 앞서 쌓인 재료 위로 흘러내린다 — 액체처럼 볼 전체로 번지지는 않는다
        if (a.t >= 0.46 && !a.given) {
          a.given = 1;
          addEgg(st, vol);
        }
      } else {
        if (a.t >= 0.45 && !butter) addButter(st);
      }
      a.given += Math.max(0, give);
      if (ing.kind === 'liquid' && a.t > 0.8) incoming.pouring = false;
      for (const p of a.particles) {
        p.vy += 900 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      a.particles = a.particles.filter((p) => p.y < land.y);
    }
    for (let i = adding.length - 1; i >= 0; i--) {
      if (adding[i].t >= 1 && adding[i].particles.length === 0) {
        const m = adding[i].stream?.mesh;
        if (m) {
          st.scene.remove(m);
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
        adding.splice(i, 1);
      }
    }
  }

  // ---- 달걀·버터 — 쌓인 재료 위에 앉는 층 ----
  /**
   * 작고 단단한 재료(노른자·버터)가 위층에 주는 높이 — 제 크기 그대로 넘기면 덮는 재료가 첨탑처럼 뾰족해진다.
   * 넓고 완만한 언덕으로 넘겨 위층이 그 위로 부드럽게 덮이게 한다
   */
  const softHill = (d: number, radius: number, height: number) => (d < radius ? height * (1 - (d / radius) ** 2) ** 2 : 0);
  const BUTTER_HH = 0.0085;
  const EGG_R = 0.03;
  const EGG_H = 0.0042;
  const YOLK_R = 0.0118;
  function addEgg(st: NonNullable<ReturnType<typeof stage>>, vol: number): void {
    const n = eggs.length;
    // 흰자 — 납작한 웅덩이, 가장자리는 불규칙하고 노른자 둘레는 도톰하다
    const white = new DrapedLayer(
      (rho, a) => {
        const edge = 1 + 0.13 * Math.sin(a * 2 + n * 1.7) + 0.08 * Math.sin(a * 5 + n * 2.9);
        const q = rho / edge;
        if (q >= 1) return 0;
        return Math.sqrt(1 - q ** 6) * (0.72 + 0.55 * Math.max(0, 1 - (rho / 0.5) ** 2));
      },
      64,
      18,
      1.3,
      0.0005,
    );
    const whiteMesh = new THREE.Mesh(white.geometry, rawEggWhiteMaterial());
    whiteMesh.renderOrder = 3;
    whiteMesh.frustumCulled = false;
    // 구의 이음매·극의 겹친 정점을 합친다 — 정점을 옮긴 뒤 노멀을 다시 계산해도 줄이 생기지 않게
    const yolkSrc = new THREE.SphereGeometry(1, 32, 22);
    yolkSrc.deleteAttribute('uv');
    yolkSrc.deleteAttribute('normal');
    const yolkGeo = mergeVertices(yolkSrc, 1e-4);
    const yolkUnit = Float32Array.from(yolkGeo.getAttribute('position').array as ArrayLike<number>);
    const yolk = new THREE.Mesh(yolkGeo, glossy('#f49c10', 0.1));
    yolk.castShadow = true;
    yolk.frustumCulled = false;
    st.scene.add(whiteMesh, yolk);
    const egg: EggInBowl = {
      white,
      whiteMesh,
      yolk,
      yolkUnit,
      y: rimY + 0.05,
      vy: -0.3,
      landed: 0,
      vol: vol * 0.8,
      left: 1,
      // 카메라를 향한 앞쪽 비탈에 — 더미 뒤로 가려지지 않고 모양이 잘 보인다. 버터(앞 왼쪽)와 겹치지 않는다
      off: n * 2.1 + 1.05,
      reach: butter ? 0.028 : 0.024,
      last: [0, 0, 0, 0],
      // 뒤에 얹히는 재료는 흰자 + 노른자의 언덕을 따른다
      thickness: (x, z) =>
        white.thickness(x, z) + softHill(Math.hypot(x - white.cx, z - white.cz), YOLK_R * 2.6 * egg.left, YOLK_R * 1.45 * egg.left),
      // 달걀은 액체 위에 뜬다
      sit: () => surfaceY() - 0.001,
    };
    eggs.push(egg);
    stack.push(egg);
  }

  function addButter(st: NonNullable<ReturnType<typeof stage>>): void {
    const hw = 0.015;
    const hd = 0.011;
    const hh = BUTTER_HH;
    const g = new THREE.BoxGeometry(hw * 2, hh * 2, hd * 2, 4, 4, 4);
    const mesh = new THREE.Mesh(g, glossy('#f6dc78', 0.35));
    mesh.castShadow = true;
    st.scene.add(mesh);
    const b: ButterInBowl = {
      mesh,
      y: rimY,
      vy: -0.4,
      landed: false,
      cx: 0.016,
      cz: 0,
      // 앞 왼쪽 비탈에 — 더미 뒤로 가려지지 않고, 달걀(앞 오른쪽)을 덮지 않는다
      spot: 2.54,
      reach: eggs.length ? 0.026 : 0.016,
      ang: 0.4,
      k: 1,
      sink: 0,
      collar: new DrapedLayer(
        // 버터에 바짝 붙어 밀려 올라온 낮은 테두리 — 안쪽(rho < 0.6)은 버터 밑이라 두께가 없다
        (rho, a) => (rho >= 1 || rho <= 0.6 ? 0 : Math.sin(Math.PI * (rho - 0.6) * 2.5) * (0.8 + 0.2 * Math.sin(a * 3 + 1.1) + 0.12 * Math.sin(a * 7))),
        48,
        18,
        1.1,
        0.0006,
      ),
      collarMesh: null,
      last: [0, 0, 0, 0],
      thickness: (x, z) => (b.landed ? softHill(Math.hypot(x - b.cx, z - b.cz), hw * 2.6 * b.k, Math.max(0, hh * 2 * b.k - b.sink)) : 0),
      sit: () => surfaceY() - 0.001,
    };
    butter = b;
    stack.push(b);
  }

  /** 달걀을 앉힌다 — 떨어지는 동안은 납작한 채로, 닿으면 아래 재료의 생김새대로 퍼져 흘러내린다. 다시 앉혔으면 참 */
  function shapeEgg(e: EggInBowl, i: number, dt: number, dirty: boolean): boolean {
    const ang = e.off + (batter ? swirl * 0.6 : 0);
    const cx = Math.cos(ang) * 0.012;
    const cz = Math.sin(ang) * 0.012;
    const below = (x: number, z: number) => Math.max(topOf(i, x, z), e.sit());
    const top = below(cx, cz);
    if (e.landed <= 0) {
      e.vy -= 9.8 * dt * 0.5;
      e.y += e.vy * dt;
      if (e.y <= top) {
        e.y = top;
        e.landed = 0.0001;
        slosh = Math.max(slosh, 0.5);
        void hapticTick();
      }
    } else {
      e.y = top;
      e.landed = Math.min(1, e.landed + dt / 0.5);
    }
    const flow = e.landed > 0 ? 1 - (1 - e.landed) ** 2 : 0;
    const vis = e.left > 0.02;
    e.whiteMesh.visible = vis;
    e.yolk.visible = vis;
    if (!vis) {
      if (e.last[0] === 0) return false;
      e.white.shape(0, 0, cx, cz, below);
      e.last = [0, 0, 0, 0];
      return true;
    }
    // 처음엔 작고 도톰하다가 퍼진다
    const r = EGG_R * lerp(0.55, 1, flow) * e.left;
    const h = EGG_H * lerp(2.2, 1, flow) * e.left;
    const settling = e.landed < 1;
    let again = false;
    if (moved(e.last, r, h, cx, cz) || dirty || settling) {
      const lay: HeightFn = flow >= 1 ? below : (x, z) => e.y + (below(x, z) - e.y) * flow;
      e.white.shape(r, h, cx, cz, lay);
      shapeYolk(e, cx, cz, flow, lay);
      again = true;
    }
    return again;
  }

  /**
   * 노른자 — 떨어질 땐 동그랗고, 닿으면 아래 재료(와 흰자)의 생김새대로 모양이 변한다. 표면장력이 있어 굴곡을 다 따르지는 않는다 —
   * 그 자리의 평균 비탈로 눕고(YOLK_TILT), 세부 굴곡은 일부만 따른다(YOLK_CONFORM). 평평한 액체 위에선 봉긋한 돔. 닿을 때 납작해졌다 돌아온다
   */
  function shapeYolk(e: EggInBowl, cx: number, cz: number, flow: number, lay: HeightFn): void {
    const q = e.landed > 0 ? Math.exp(-e.landed * 5) * Math.sin(e.landed * 14) * 0.16 : 0;
    const R = YOLK_R * e.left * (1 + q);
    const up = YOLK_R * e.left * 0.9 * (1 - q);
    const down = YOLK_R * e.left * 0.82 * (1 - flow);
    const pos = e.yolk.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const u = e.yolkUnit;
    const under = (x: number, z: number) => lay(x, z) + e.white.thickness(x, z);
    const y0 = under(cx, cz);
    // 그 자리의 평균 비탈 — 노른자보다 조금 넓은 폭으로 잰다
    const d = R * 1.2;
    const slope = (g: number) => clamp(g * YOLK_TILT, -YOLK_MAX_SLOPE, YOLK_MAX_SLOPE);
    const gx = slope((under(cx + d, cz) - under(cx - d, cz)) / (2 * d));
    const gz = slope((under(cx, cz + d) - under(cx, cz - d)) / (2 * d));
    for (let i = 0; i < pos.count; i++) {
      const x = cx + u[i * 3] * R;
      const z = cz + u[i * 3 + 2] * R;
      const uy = u[i * 3 + 1];
      const floor = under(x, z);
      const seat = lerp(y0 + gx * (x - cx) + gz * (z - cz), floor, YOLK_CONFORM);
      a[i * 3] = x;
      // 아랫면은 재료 면까지 내려가 뜬 자리가 없게 한다
      a[i * 3 + 1] = uy >= 0 ? seat + uy * up : Math.min(seat, floor) + uy * down - 0.0006;
      a[i * 3 + 2] = z;
    }
    pos.needsUpdate = true;
    e.yolk.geometry.computeVertexNormals();
  }

  // ---- 꿀 ----
  function addHoney(st: NonNullable<ReturnType<typeof stage>>, ing: Ingredient): HoneyInBowl {
    const layer = new DrapedLayer(
      (rho, a) => {
        const edge = 1 + 0.07 * Math.sin(a * 2 + 0.8) + 0.05 * Math.sin(a * 3 + 2.1);
        const q = rho / edge;
        // 가장자리가 둥글게 뭉툭하다 — 끈적해서 얇게 번지지 않는다
        return q >= 1 ? 0 : (1 - q ** 3) ** 0.7;
      },
      72,
      20,
      1.25,
      0.001,
    );
    const mesh = new THREE.Mesh(layer.geometry, honeyMaterial(ing.color));
    // 맑은 액체 다음에 그린다 — 물 층이 덮이면 꿀 색이 허옇게 씻겨 섞인 것처럼 보인다
    (mesh.material as THREE.Material).transparent = true;
    mesh.renderOrder = 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    st.scene.add(mesh);
    const coilMat = honeyMaterial(ing.color);
    const coils = [0, 1, 2].map(() => {
      const c = new THREE.Mesh(new THREE.TorusGeometry(0.0046, 0.0015, 10, 28), coilMat);
      c.rotation.x = Math.PI / 2;
      c.visible = false;
      st.scene.add(c);
      return c;
    });
    const sat = surfaceY() - 0.0012;
    const h: HoneyInBowl = {
      layer,
      mesh,
      ing,
      vol: 0,
      r: 0.007,
      left: 1,
      sat,
      last: [0, 0, 0, 0],
      coils,
      flowing: true,
      thickness: (x, z) => layer.thickness(x, z),
      sit: () => h.sat,
    };
    honeys.push(h);
    stack.push(h);
    return h;
  }

  /** 꿀을 앉힌다 — 부은 부피를 지키며 아주 천천히 넓어진다. 액체 위에 떨어졌으면 그 속으로 가라앉는다. 다시 앉혔으면 참 */
  function shapeHoney(h: HoneyInBowl, i: number, dt: number, dirty: boolean): boolean {
    // 보이는 부피 — 가루처럼 볼에 비해 작게
    const v = h.vol * 0.45 * h.left;
    // 다 퍼졌을 때의 반지름 (부피 ≈ 0.62 π r² h)
    const goal = Math.sqrt(v / (0.62 * Math.PI * HONEY_H));
    h.r += Math.max(0, goal - h.r) * (1 - Math.exp(-dt / HONEY_TAU));
    // 붓는 속도가 퍼지는 속도보다 빠르면 높이 쌓이다가, 봉긋한 정도를 넘으면 그만큼 넓어진다
    h.r = Math.max(h.r, Math.cbrt(v / (0.62 * Math.PI * 0.75)));
    const r = h.r * h.left;
    const th = r > 1e-5 ? v / (0.62 * Math.PI * r * r) : 0;
    const floorSit = floorFast(0) + STACK_LIFT;
    h.sat += (floorSit - h.sat) * (1 - Math.exp(-dt / 2.2));
    const below = (x: number, z: number) => Math.max(topOf(i, x, z), h.sat);
    const vis = h.left > 0.02 && v > 0;
    h.mesh.visible = vis;
    let again = false;
    // 가라앉는 동안에도 다시 앉힌다 — sat이 변하면 메시가 따라가야 한다
    if (moved(h.last, r, th, 0, h.sat) || dirty) {
      h.layer.shape(vis ? r : 0, vis ? th : 0, 0, 0, below);
      again = true;
    }
    // 똬리 — 줄기가 닿는 자리에 하나씩 틀어졌다가 꿀 속으로 잠긴다. 액체 속으로 떨어지면 생기지 않는다
    const top = below(0, 0) + h.layer.thickness(0, 0);
    const show = h.flowing && top >= surfaceY();
    h.coils.forEach((c, k) => {
      const phase = (clock * 1.5 + k / h.coils.length) % 1;
      c.visible = show;
      if (!show) return;
      const s = smoothstep(0, 0.12, phase) * (0.82 + 0.5 * phase);
      c.scale.set(s, s, s * (1 - 0.65 * phase));
      c.position.set(0, top + 0.0042 * (1 - phase) - 0.0006, 0);
    });
    return again;
  }

  /**
   * 버터 — 떨어져 얹히고, 아래에 쌓인 재료가 있으면 무게로 반쯤 묻히며 그 비탈을 따라 기운다. 묻힌 만큼 둘레에 가루가 밀려 올라온다.
   * 다시 앉혔으면 참
   */
  function shapeButter(b: ButterInBowl, i: number, dt: number, dirty: boolean): boolean {
    const a = batter ? swirl * 0.7 : 0;
    b.cx = b.reach * Math.cos(b.spot + a);
    b.cz = b.reach * Math.sin(b.spot + a);
    b.ang = 0.4 + a;
    const surface = (x: number, z: number) => Math.max(topOf(i, x, z), b.sit());
    const surf = surface(b.cx, b.cz);
    const H = BUTTER_HH * 2 * b.k;
    // 아래에 쌓인 재료의 두께 — 볼 바닥이나 액체 면에는 묻히지 않는다
    const under = surf - Math.max(floorFast(Math.hypot(b.cx, b.cz)) + STACK_LIFT, b.sit());
    const soft = under > 0.001;
    if (!b.landed) {
      b.vy -= 9.8 * dt * 0.5;
      b.y += b.vy * dt;
      const contact = surf + H / 2;
      if (b.y <= contact) {
        b.y = contact;
        slosh = Math.max(slosh, 0.6);
        void hapticTick();
        // 쌓인 재료 위에는 튀지 않고 푹 앉는다
        b.vy = soft ? 0 : -b.vy * 0.3;
        if (soft || Math.abs(b.vy) < 0.05) b.landed = true;
      }
    } else {
      b.sink += (Math.min(under, H * BUTTER_BURY) - b.sink) * (1 - Math.exp(-dt * 7));
      b.y = surf - b.sink + H / 2;
    }
    b.mesh.visible = b.k > 0.02;
    b.mesh.scale.setScalar(Math.max(0.02, b.k));
    b.mesh.position.set(b.cx, b.y, b.cz);
    // 묻히는 만큼 그 자리의 비탈을 따라 기운다
    const d = 0.012;
    const gx = (surface(b.cx + d, b.cz) - surface(b.cx - d, b.cz)) / (2 * d);
    const gz = (surface(b.cx, b.cz + d) - surface(b.cx, b.cz - d)) / (2 * d);
    const lean = H > 0 ? Math.min(1, b.sink / (H * BUTTER_BURY)) * 0.8 : 0;
    const normal = new THREE.Vector3(-gx * lean, 1, -gz * lean).normalize();
    b.mesh.quaternion
      .setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.ang));
    // 둘레의 둔덕 — 맨 위에 쌓인 가루의 재질로
    const pile = [...piles].reverse().find((p) => stack.indexOf(p) < i && p.pile.thickness(b.cx, b.cz) > 0);
    if (pile && !b.collarMesh) {
      b.collarMesh = new THREE.Mesh(b.collar.geometry, pile.pile.mesh.material);
      b.collarMesh.receiveShadow = true;
      b.collarMesh.frustumCulled = false;
      stage()?.scene.add(b.collarMesh);
    }
    if (b.collarMesh) {
      b.collarMesh.visible = b.sink > 0.0004 && b.k > 0.05 && !!pile;
      if (b.collarMesh.visible) b.collar.shape(0.021 * b.k, b.sink * 0.16, b.cx, b.cz, surface);
    }
    return moved(b.last, b.k, b.sink, b.cx, b.cz) || dirty;
  }

  /** 볼 위에서 재료가 나오는 모습 (2D) */
  function drawAdding(g: CanvasRenderingContext2D): void {
    const st = stage();
    if (!st) return;
    const land = st.project(landing());
    const ppm = st.pixelsPerMeter(landing());
    for (const a of adding) {
      const { ing } = a;
      const key = SOURCE[ing.kind];
      const src = sourceAt(key);
      const fadeIn = smoothstep(0, 0.12, a.t);
      const fadeOut = 1 - smoothstep(0.78, 1, a.t);
      if (ing.kind === 'powder' || ing.kind === 'liquid' || ing.kind === 'viscous') {
        const tilt = tiltOf(a.t);
        drawTool(g, key, src, tilt, fadeIn * fadeOut);
        if (a.particles.length) {
          g.save();
          g.fillStyle = ing.color;
          for (const p of a.particles) {
            g.beginPath();
            g.arc(p.x, p.y, Math.max(1, ppm * 0.0012), 0, Math.PI * 2);
            g.fill();
          }
          g.restore();
        }
      } else if (ing.kind === 'egg') {
        // 살짝 흔들리다 톡 — 반으로 갈라지며 노른자·흰자가 떨어진다
        const crack = smoothstep(0.32, 0.5, a.t);
        const shake = a.t < 0.32 ? Math.sin(a.t * 70) * 0.12 : 0;
        for (const side of [-1, 1]) drawTool(g, key, { x: land.x, y: src.y }, shake, fadeIn * fadeOut, side, crack);
      } else if (a.t < 0.45) {
        const f = a.t / 0.45;
        drawTool(g, key, { x: land.x, y: lerp(src.y, land.y - ppm * 0.012, f * f) }, 0.15, fadeIn);
      }
    }
  }

  // ---- 매 프레임: 3D 내용물 ----
  function update3D(dt: number, mix: number): void {
    const st = stage();
    if (!st) return;
    // 쌓인 가루는 액체가 있으면 서서히 녹아든다 — 섞기 시작하면 빨리
    for (const p of piles) {
      if (p.vol <= 0 || poolVol <= 0) continue;
      const k = Math.min(p.vol, p.vol * (mixing ? DISSOLVE * 6 : DISSOLVE) * dt + (mix > 0 ? p.vol * mix * dt * 2 : 0));
      p.vol -= k;
      pour(k, p.ing.color, false);
    }
    // 액체가 바닥 전체로 번지고(처음엔 빠르게, 벽에 다가갈수록 느리게) 붓는 양을 따라 차오른다 — 둘 다 지수적으로
    if (spreadR > 0) spreadR += (rAt(rimY) * 1.05 - spreadR) * (1 - Math.exp(-dt * SPREAD_K));
    // 고인 면은 일정한 속도로 오른다 — 붓는 중이면 이번 재료를 다 부은 높이를 향해
    let pending = 0;
    for (const a of adding) {
      if (a.ing.kind === 'liquid' && a.t >= 0.2) pending += (1 - a.given) * a.ing.amount * VOL_PER_AMOUNT * bowlVol;
    }
    const goalH = poolVol + pending > 0 ? levelFor(W, poolVol + pending) : floorY;
    const nowH = surfaceY();
    const nextH = goalH > nowH ? Math.min(goalH, nowH + RISE_SPEED * dt) : goalH;
    levelVol = nextH > floorY ? Math.min(volumeTo(W, nextH), poolVol + pending) : 0;
    // 붓는 동안 아주 살짝 출렁이고, 다 부으면 잦아든다
    if (incoming.pouring) slosh += (1 - slosh) * (1 - Math.exp(-dt * 8));
    else slosh *= Math.exp(-dt * 1.3);
    // 막 들어온 액체의 얼룩 — 붓는 동안 번지고, 다 부으면(또는 저으면 더 빨리) 옅어져 내용물 색이 된다
    if (incoming.a > 0) {
      incoming.r += (rAt(surfaceY()) * 0.9 - incoming.r) * (1 - Math.exp(-dt * 1.8));
      if (!incoming.pouring) incoming.a *= Math.exp(-dt * BLEND_K * (mixing ? 3 : 1));
      if (incoming.a < 0.01) incoming.a = 0;
    }
    // 덩어리 반죽은 뭉치면서 액체·가루를 빨아들인다 — 그만큼 고인 면이 낮아진다
    const s = batter ? 0 : smoothstep(0, 0.12, mix);
    const realVol = levelVol;
    levelVol = realVol * (1 - s);
    rebuildPool();
    levelVol = realVol;
    if (poolMat) {
      // 흰 액체가 조명에 하얗게 날아가 출렁임이 안 보이지 않게 조금 어둡게
      poolMat.color.set(poolColor).multiplyScalar(0.84);
      poolMat.transparent = poolClear > 0.5;
      // 맑은 액체는 깊이를 남기지 않는다 — 그 아래 가라앉은 꿀이 비쳐 보여야 한다
      poolMat.depthWrite = poolClear <= 0.5;
      poolMat.opacity = lerp(1, 0.32, poolClear);
      poolMat.spread.radius.value = spreadR;
      poolMat.spread.incoming.color.copy(incoming.color);
      poolMat.spread.incoming.r.value = incoming.r;
      poolMat.spread.incoming.a.value = incoming.a;
      poolMat.spread.turn.value = clock * 1.5;
      poolMat.spread.slosh.amp.value = slosh < 0.01 ? 0 : slosh * SLOSH_AMP;
      poolMat.spread.slosh.time.value = clock;
    }
    // 묽은 반죽: 섞을수록 반죽 면이 덮고, 결이 거품기를 따라 돈다
    if (batterMesh) {
      const show = batter ? smoothstep(0, 0.35, mix) : 0;
      batterMesh.visible = show > 0.01 && poolMesh!.visible;
      batterMat.opacity = show;
      batterMat.depthWrite = show > 0.95;
      batterMat.color.copy(new THREE.Color(mixHex(poolColor, doughColor, smoothstep(0, 0.7, mix))));
      batterMat.spread.turn.value = -swirl * 0.5;
      batterMat.spread.slosh.amp.value = slosh < 0.01 ? 0 : slosh * SLOSH_AMP;
      batterMat.spread.slosh.time.value = clock;
    }
    // 달걀 — 섞기 시작하면 풀어져 내용물이 된다
    const eggK = 1 - (batter ? smoothstep(0, 0.3, mix) : s);
    for (const e of eggs) {
      if (eggK < e.left) {
        pour((e.left - eggK) * e.vol, EGG_MIX, false);
        spreadR = Math.max(spreadR, 0.002);
        e.left = eggK;
      }
    }
    // 꿀 — 저어야 비로소 내용물로 풀린다
    const honeyK = 1 - (batter ? smoothstep(0, 0.3, mix) : s);
    for (const h of honeys) {
      if (honeyK < h.left) {
        pour((h.left - honeyK) * h.vol, h.ing.color, false);
        spreadR = Math.max(spreadR, 0.002);
        h.left = honeyK;
      }
    }
    // 버터 — 섞으면 녹는다. 내용물 색은 그대로
    if (butter) butter.k = 1 - (batter ? smoothstep(0, 0.35, mix) : s);
    // 쌓인 층들 — 들어온 순서대로 아래층의 생김새를 따라 앉는다
    layStack(batter ? smoothstep(0, 0.4, mix) : s, dt);
    // 덜 섞인 멍울 — 저은 만큼 돌며 작아진다
    if (batter && mix > 0 && lumps.length === 0) {
      const R = rAt(surfaceY()) * 0.75;
      for (let i = 0; i < 16; i++) {
        const b = new Blob(i * 1.7, 12, 8);
        const r = 0.004 + 0.004 * ((i * 0.37) % 1);
        b.update([r, r * 0.6, r], 0.6, 0.5);
        b.geometry.deleteAttribute('color');
        const m = new THREE.Mesh(b.geometry, doughMaterial('#fbf6ea'));
        st.scene.add(m);
        lumps.push({ mesh: m, a: i * 2.39, r: R * (0.25 + 0.75 * ((i * 0.61) % 1)), speed: 0.6 + ((i * 0.43) % 0.5) });
      }
    }
    for (const l of lumps) {
      const k = (1 - mix) ** 1.5;
      l.mesh.visible = k > 0.03;
      l.mesh.scale.setScalar(k);
      const a = l.a + swirl * l.speed;
      l.mesh.position.set(Math.cos(a) * l.r, surfaceY() - 0.001, Math.sin(a) * l.r);
    }
    // 덩어리 반죽 — 손가락을 따라 볼 안을 자유롭게
    if (!batter) updateDough(dt, mix, s);
  }

  function updateDough(dt: number, mix: number, s: number): void {
    // 덩어리가 아직 안 보여도(막 섞기 시작) 손가락을 따라 움직임을 계산한다 — 그 움직임이 재료를 뭉치게 한다
    doughMesh.visible = s > 0.01;
    const k3 = Math.cbrt(Math.max(s, 0.25));
    const R: [number, number, number] = [DOUGH_R[0] * k3, DOUGH_R[1] * k3, DOUGH_R[2] * k3];
    // 손가락 쪽으로 끌려가고(용수철), 놓으면 볼의 비탈을 따라 가운데로 미끄러지며 흔들린다
    const acc = new THREE.Vector2();
    if (dragging) acc.copy(dragTarget).sub(doughPos).multiplyScalar(70).addScaledVector(doughVel, -11);
    else acc.copy(doughPos).multiplyScalar(-22).addScaledVector(doughVel, -2.2);
    doughVel.addScaledVector(acc, dt);
    const before = doughPos.clone();
    doughPos.addScaledVector(doughVel, dt);
    const maxR = rAt(floorY + R[1] * 0.6) - R[0] * 0.75;
    if (doughPos.length() > maxR) {
      const n = doughPos.clone().normalize();
      doughPos.copy(n).multiplyScalar(maxR);
      const vr = doughVel.dot(n);
      if (vr > 0) doughVel.addScaledVector(n, -vr * 1.4);
    }
    const moved = doughPos.distanceTo(before);
    if (dragging) advance(moved);
    // 굴러간 만큼 결이 돈다 — 움직이는 방향에 수직인 축으로
    const speed = doughVel.length();
    if (moved > 1e-6) {
      const axis = new THREE.Vector3(doughVel.y, 0, -doughVel.x).normalize();
      roll.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, moved / Math.max(R[0], 0.01)));
    }
    if (!doughMesh.visible) return;
    const vis = Math.cbrt(s);
    R[0] *= vis / k3;
    R[1] *= vis / k3;
    R[2] *= vis / k3;
    const rough = 1 - kneadProgress();
    // 움직이는 쪽으로 늘어나고 높이는 줄어든다 — 결은 굴러간 그대로(메시를 돌리지 않는다)
    const k = smoothstep(0, 0.6, speed);
    const dir = speed > 1e-4 ? doughVel.clone().divideScalar(speed) : new THREE.Vector2(1, 0);
    blob.update(R, rough, 0.55, rough, roll, { dx: dir.x, dz: dir.y, s: 1 + k * 0.35, sy: 1 - k * 0.18 });
    const y0 = floorAt(doughPos.length());
    doughMesh.position.set(doughPos.x, y0, doughPos.y);
    conformToBowl(blob.geometry, doughPos.x, y0, doughPos.y);
    void mix;
  }

  /**
   * 반죽을 볼 안쪽에 맞춘다 — 볼 바닥은 오목하고 벽은 비스듬해서, 밑면이 평평한 덩어리를 그대로 두면 바닥·벽을
   * 뚫고 볼 밖으로 삐져나온다. 바닥 아래로 내려간 점은 바닥 위로 올려(오목한 바닥에 눌린 모양), 벽 밖으로 나간 점은
   * 벽 안쪽으로 끌어들인다(벽에 눌려 납작해진 모양). 좌표는 메시 원점(px, py, pz) 기준
   */
  function conformToBowl(geo: THREE.BufferGeometry, px: number, py: number, pz: number): void {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      let x = a[i * 3] + px;
      let y = a[i * 3 + 1] + py;
      let z = a[i * 3 + 2] + pz;
      let r = Math.hypot(x, z);
      const fl = floorAt(r) + 0.0006;
      if (y < fl) y = fl + (y - fl) * 0.05;
      const rw = rAt(y) - 0.0015;
      if (r > rw && r > 1e-6) {
        x *= rw / r;
        z *= rw / r;
        r = rw;
      }
      a[i * 3] = x - px;
      a[i * 3 + 1] = y - py;
      a[i * 3 + 2] = z - pz;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }

  // ---- 거품기 (2D 그림, 끝이 손가락 자리) ----
  function drawWhisk(g: CanvasRenderingContext2D, p: { x: number; y: number }, wobble: number): void {
    const img = sprite('tool/whisk');
    const tip = META.tool.whisk?.tip;
    if (!ready(img) || !tip) return;
    const b = sv.box;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(wobble * 0.12);
    g.drawImage(img, -tip[0] * b.size, -tip[1] * b.size, b.size, b.size);
    g.restore();
  }

  // ---- 그리기 ----
  let last = performance.now();
  function frame(now: number): void {
    if (disposed) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    clock += dt;
    const g = sv.layout();
    const mix = ingredientsIn >= INGREDIENTS.length ? kneadProgress() : 0;
    updateAdding(dt);
    update3D(dt, mix);
    sv.render();
    drawAdding(g);
    const st = stage();
    if (st && batter && ingredientsIn >= INGREDIENTS.length) {
      if (mixing) drawWhisk(g, pointer, Math.sin(clock * 12));
      else {
        const c = st.project(new THREE.Vector3(rAt(surfaceY()) * 0.55, surfaceY(), 0));
        drawWhisk(g, c, 0);
      }
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // ---- 내비게이션 ----
  view.querySelector('[data-back]')!.addEventListener('click', () => {
    if (ingredientsIn === 0) {
      ctx.go('title');
      return;
    }
    confirmSheet('반죽을 그만둘까요? 지금까지 반죽한 건 사라져요', () => ctx.go('title'));
  });
  view.querySelector('[data-skip]')?.addEventListener('click', () => {
    ctx.go(nextStage, { breadId, roughness: 0.3, toppingIds, seed });
  });
  continueBtn.addEventListener('click', () => {
    const roughness = 1 - kneadProgress();
    ctx.go(nextStage, { breadId, roughness, toppingIds, seed });
  });

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    sv.dispose();
  };
}
