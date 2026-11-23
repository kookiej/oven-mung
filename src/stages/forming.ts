// 모양 빚기 — 반죽(dough)을 쓰는 빵만 거치는 단계. 반죽 단계 다음, 틀·트레이에 올리기 전.
// 빵마다 빚는 법(content/forming.ts)이 달라서 몸짓도 다르다: 굴리기, 밀대로 밀기, 누르기, 떼어 내기, 칼질.
// 반죽 판은 Blender로 렌더한 그림, 반죽은 실시간 3D(render/live/formShapes) — 진행도가 바뀌는 대로 모양이
// 그 자리에서 다시 만들어져 움직임이 끊기지 않는다. 손은 그리지 않는다 — 밀대·빵칼만 손가락을 따라다닌다.
//   떼어 내기(쿠키) — 볼 속 큰 반죽을 잡아 당기면 조각이 손가락을 따라 늘어나다 목이 끊어져 같은 크기로 뜯겨,
//                     앞쪽 반죽 판에 줄 맞춰 놓인다 (무대 form_cookie: 뒤에 볼, 앞에 판)
//   하나씩 누르기(쿠키) — 누르고 있는 조각만 납작해진다
//   칼질 — 칼선(cutLines)을 따라 그은 만큼만 금이 난다. 끝까지 그으면 그 줄이 잘린다(파이 띠)
//   토핑 올리기 — 말거나 접어 빚는 빵은 밀어 편 반죽에 칩을 끌어다 토핑을 올린다. 그 뒤 말거나 접으면 지나간 자리부터 속으로 들어간다
//   나누기(플랫브레드) — 스크레이퍼(3D)로 점선을 따라 그어 넷으로 나누고, 조각을 하나씩 문질러 둥글린다
//   안내선 — 칼선·접는 선은 점선으로 보여 준다(사용자 요청). 지나간 자리·접힌 자리는 사라진다
//   파이는 두 번 온다 — 처음엔 크러스트로 깔 큰 판을 밀고(→ 틀에 깔고 자르기), 필링을 올린 뒤 잘라 낸 반죽(한 덩이)을
//   (phase: 'lattice') 다시 밀어 띠로 자른다(→ 틀로 돌아가 격자로 엮기).
// 전략 없음: 몸짓은 진행도만 채우고, 결과(구워지는 빵)에는 영향을 주지 않는다.
import * as THREE from 'three';
import type { StageCtx } from '../main';
import { bindPutChip, confirmSheet, el } from '../ui';
import { BREADS, getBread } from '../content/breads';
import { PIE_LATTICE_STEPS, formStepsOf, rollsIn } from '../content/forming';
import { placedToppings, tintedBread } from '../content/toppings';
import { needsPutting } from './shaping';
import { FormBits } from '../render/live/formBits';
import { formedPieces } from '../render/live/placed';
import { moldTitle, usesVessel } from '../content/vessels';
import { META, loadSprites, ready, sprite } from '../render/sprites';
import { StageView } from '../render/live/stageView';
import {
  COOKIE_PIECES,
  COOKIE_R,
  COOKIE_SPOTS,
  FLAT_BALL_R,
  FLAT_SPOTS,
  R0,
  cutLines,
  foldGuides,
  formShape,
  sheetCover,
  toppingSheets,
  type FormOpts,
  type Torn,
} from '../render/live/formShapes';
import { doughMaterial, toonColor } from '../render/live/materials';
import { hapticThud, hapticTick } from '../native';
import { clamp } from '../util';
import { dev } from '../dev/devState';
import type { BreadId, ToppingId } from '../types';

/** 누르기 단계를 다 채우는 시간(초) */
const PRESS_SEC = 1.4;
/** 쿠키 조각 하나를 다 눌러 펴는 시간(초) */
const PRESS_ONE_SEC = 0.55;
/** 굴리기·밀기: 반죽 판 그림 크기의 이 배수만큼 움직이면 한 단계 끝 */
const ROLL_DIST = 2.4;
/** 문지르기: 이만큼 돌리면 한 단계 끝 (2바퀴 반) */
const RUB_ANGLE = Math.PI * 5;
/** 한 단계를 마치고 다음 단계로 넘어가기 전 잠깐 */
const STEP_PAUSE = 0.55;
/** 화면의 반죽 모양이 실제 진행도를 따라가는 빠르기 */
const FOLLOW = 9;
/** 떼어 낸 조각·나눈 반죽이 자리까지 날아가는 시간(초) */
const FLIGHT_SEC = 0.45;
/** 당긴 조각이 큰 반죽 가장자리에서 이만큼(미터) 멀어지면 목이 끊어진다 */
const TEAR_DIST = COOKIE_R * 1.9;
/** 칼선의 이만큼을 그으면 끝까지 자른 것으로 */
const CUT_DONE = 0.9;
/** 하나씩 둥글리기: 조각 위에서 반죽 판 그림 크기의 이 배수만큼 문지르면 그 조각 끝 */
const RUB_ONE_DIST = 1.1;
/** 단계가 이보다 많으면 지금 단계 앞뒤만 보여 준다 */
const STEP_WINDOW = 5;

/** 스크레이퍼(도우 커터) — 넓적한 쇠 날과 나무 손잡이. 원점은 날 아래 가운데, 날은 x 방향 */
function makeScraper(): THREE.Group {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.07, 0.0014),
    new THREE.MeshStandardMaterial({ color: '#dfe5e7', metalness: 0.35, roughness: 0.3 }),
  );
  blade.position.y = 0.035;
  const handle = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.011, 0.105, 6, 14),
    new THREE.MeshStandardMaterial({ color: toonColor('#b9834f', 1.05, 1.02), roughness: 0.6 }),
  );
  handle.rotation.z = Math.PI / 2;
  handle.position.y = 0.078;
  blade.castShadow = handle.castShadow = true;
  g.add(blade, handle);
  g.visible = false;
  return g;
}

export function mountForming(root: HTMLElement, ctx: StageCtx, data?: unknown): () => void {
  const d = data as { breadId?: BreadId; roughness?: number; phase?: 'lattice'; toppingIds?: ToppingId[]; seed?: number } | undefined;
  if (!d?.breadId || !BREADS.some((b) => b.id === d.breadId)) {
    ctx.go('choose');
    return () => {};
  }
  const def = getBread(d.breadId);
  const toppingIds = d.toppingIds ?? [];
  const seed = d.seed ?? Math.random() * 100;
  const next = { breadId: def.id, roughness: d.roughness ?? 0.3, toppingIds, seed };
  const lattice = d.phase === 'lattice' && def.id === 'pie';
  const allSteps = lattice ? PIE_LATTICE_STEPS : formStepsOf(def);
  if (!allSteps) {
    ctx.go('mold', next);
    return () => {};
  }
  const putList = placedToppings(toppingIds);
  // 올릴 토핑이 없으면 토핑 단계(와 토핑 때문에 거치는 단계)만 건너뛴다 — formShape의 단계 번호는 그대로
  const steps = allSteps.filter((s) => (s.gesture !== 'toppings' && !s.withToppings) || putList.length > 0);
  /** 파이의 격자 단계는 formShape의 1번 단계부터 */
  const shapeOf = (i: number) => allSteps.indexOf(steps[i]) + (lattice ? 1 : 0);
  // 쿠키·플랫브레드는 판 위에서 토핑을 올리고 트레이로 옮긴다. 말거나 접어 빚는 빵은 여기서 토핑까지 올렸다
  const toTopping = !usesVessel(def) && needsPutting(def, toppingIds);
  const rolled = rollsIn(def);
  void loadSprites(['tool/pin', 'tool/knife']);
  /** 하나씩 빚는 조각의 자리 (판 가운데 기준) */
  const spots = def.id === 'flatbread' ? FLAT_SPOTS : COOKIE_SPOTS;
  const spotR = def.id === 'flatbread' ? FLAT_BALL_R * 1.9 : COOKIE_R * 2.4;

  const view = el(`
    <div class="form-view">
      <div class="stage-header">
        <button class="btn btn-ghost" data-back>←</button>
        <span class="stage-title">${def.emoji} ${lattice ? '격자 띠 만들기' : `${def.name} 모양 빚기`}</span>
        <span></span>
      </div>
      <div class="form-steps" data-steps>
        ${steps.map((s, i) => `<span class="form-step" data-step="${i}">${i + 1}. ${s.label}</span>`).join('')}
        ${steps.length > STEP_WINDOW ? '<span class="form-step form-step-count" data-more></span>' : ''}
      </div>
      <div data-stage class="stage-slot"></div>
      <p class="hint" data-hint></p>
      <div class="ingredient-tray" data-chips hidden>
        ${putList.map((t) => `<button class="chip" data-chip="${t.id}"><span class="chip-emoji">${t.emoji}</span>${t.name}</button>`).join('')}
      </div>
      <button class="btn btn-primary btn-big form-next" data-next hidden>${lattice ? '격자 얹기' : toTopping ? '토핑 올리기' : moldTitle(def)} →</button>
    </div>
  `);
  root.appendChild(view);
  const isCookie = def.id === 'cookie';
  // 큰 반죽 판은 화면보다 조금 크게 — 판 가운데를 화면 가운데에 두고 손잡이 쪽은 화면 밖으로 나간다(반죽이 작아 보이지 않게)
  const sv = isCookie ? new StageView('form_cookie', 0.5) : new StageView('form', 0.5, 1.22, META.tool.pin?.center?.[0] ?? 0.44);
  view.querySelector('[data-stage]')!.replaceWith(sv.el);
  const hint = view.querySelector<HTMLElement>('[data-hint]')!;
  const nextBtn = view.querySelector<HTMLButtonElement>('[data-next]')!;
  const chipTray = view.querySelector<HTMLElement>('[data-chips]')!;
  const topY = META.stage.form?.topY ?? 0.022;
  // 쿠키: 반죽 지오메트리는 판 가운데 기준 — 큰 반죽은 뒤쪽 볼 속에 있다
  const cm = META.stage.form_cookie ?? {};
  const boardC = isCookie ? (cm.boardCenter ?? [0, 0.128]) : [0, 0];
  const bowlC = cm.center ?? [0, -0.138];
  const bowl = { x: bowlC[0] - boardC[0], y: (cm.floorY ?? 0.013) + 0.003, z: bowlC[1] - boardC[1] };
  const pullY = (cm.rimY ?? 0.085) + 0.012;

  let step = 0;
  let t = 0;
  /** 화면에 보이는 진행도(단계 + 진행도) — 실제 값을 부드럽게 따라간다 */
  let shown = 0;
  let done = false;
  let pause = 0;
  let clock = 0;

  // ---- 쿠키: 떼어 내기 · 하나씩 누르기 ----
  const torn: { spot: number; from: [number, number, number]; at: number }[] = [];
  let pull: [number, number, number] | null = null;
  /** 하나씩 하는 몸짓(누르기·둥글리기·감싸기) — 단계마다 조각별 진행 */
  const pressBy: number[][] = steps.map(() => Array<number>(spots.length).fill(0));
  let pressing = -1;
  // ---- 칼질: 단계마다 칼선별로 칼날이 지나간 구간 ----
  const cutState: ([number, number] | null)[][] = steps.map((_, i) => cutLines(def.id, shapeOf(i), topY).map(() => null));
  let activeLine = -1;

  let down = false;
  let pointer = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };
  let downAt = 0;
  let lastAngle = 0;
  let lastTickT = 0;
  let finalBits = false;
  /** formShape 단계마다 마친 시각 — 다 민 판을 돌려 놓는 것처럼 단계 사이에 저절로 일어나는 모습 */
  const doneAt = new Map<number, number>();
  let lastDone = -99;
  // ---- 하나씩 둥글리기(플랫브레드): 조각마다 굴러간 자세와 손가락을 따라 비킨 자리 ----
  const rollQ = spots.map(() => new THREE.Quaternion());
  const rollOff = spots.map(() => [0, 0] as [number, number]);
  let rubbing = -1;
  let lastBoard: [number, number] | null = null;

  // ---- 3D 반죽 ----
  const group = new THREE.Group();
  group.position.set(boardC[0], 0, boardC[1]);
  const mat = doughMaterial(tintedBread(def, toppingIds).doughColor, true);
  let shapeKey = '';
  /** 이 단계에 들어온 시각 */
  let stepAt = 0;
  // 밀어 편 반죽 위의 토핑 — 자리를 미리 정해 두고 칩을 올릴 때마다 떨어진다
  const bits = rolled && !lattice ? new FormBits(def) : null;
  if (bits && putList.length) bits.layout(toppingSheets(def.id, topY), toppingIds, seed);
  const scraper = makeScraper();
  void sv.load().then((st) => {
    if (disposed) return;
    st.scene.add(group);
    st.scene.add(scraper);
    if (bits) st.scene.add(bits.group);
  });

  const bigR = () => R0 * Math.cbrt(Math.max(1 / COOKIE_PIECES, 1 - torn.length / COOKIE_PIECES));

  function optsFor(stepShown: number): FormOpts {
    const tornNow: Torn[] = torn.map((p) => ({ spot: p.spot, from: p.from, f: clamp((clock - p.at) / FLIGHT_SEC, 0, 1) }));
    return {
      rough: d!.roughness ?? 0.3,
      bowl,
      torn: tornNow,
      pull,
      press: pressBy[stepShown] ?? [],
      cuts: cutState[stepShown] ?? [],
      stepAge: stepShown === step ? clock - stepAt : 1,
      sinceDone: (k) => (doneAt.has(k) ? clock - doneAt.get(k)! : 0),
      roll: rollQ.map((q, i) => ({ q: [q.x, q.y, q.z, q.w] as [number, number, number, number], off: rollOff[i] })),
    };
  }

  function rebuild(): void {
    const stepShown = Math.min(steps.length - 1, Math.floor(shown + 1e-4));
    const tShown = clamp(shown - stepShown, 0, 1);
    const opts = optsFor(stepShown);
    const r3 = (v: number) => v.toFixed(3);
    const key = [
      stepShown,
      r3(tShown),
      opts.torn!.map((p) => `${p.spot}:${r3(p.f)}`).join(','),
      pull ? pull.map(r3).join(',') : '-',
      opts.press!.map((v) => v.toFixed(2)).join(','),
      opts.cuts!.map((c) => (c ? c.map(r3).join('~') : '-')).join(','),
      Math.min(1, opts.stepAge ?? 1).toFixed(2),
      Math.min(1, clock - lastDone).toFixed(2),
      steps[stepShown].gesture === 'rubEach' ? opts.roll!.map((r) => [...r.q, ...r.off].map((v) => v.toFixed(3)).join(',')).join(';') : '',
    ].join('|');
    if (key === shapeKey) return;
    shapeKey = key;
    for (const c of [...group.children]) {
      (c as THREE.Mesh).geometry.dispose();
      group.remove(c);
    }
    for (const geo of formShape(def.id, shapeOf(stepShown), tShown, topY, opts)) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
  }

  const center = () => sv.stage?.project(new THREE.Vector3(0, topY, 0)) ?? { x: sv.w / 2, y: sv.h / 2 };
  const angleOf = (p: { x: number; y: number }) => {
    const c = center();
    return Math.atan2(p.y - c.y, p.x - c.x);
  };
  /** 손가락 자리 → 높이 y 평면 위의 판 좌표 (x, z) — 판 가운데 기준 */
  const boardAt = (p: { x: number; y: number }, y = topY): [number, number] | null => {
    const hit = sv.stage?.onPlane(p.x, p.y, y);
    return hit ? [hit.x - boardC[0], hit.z - boardC[1]] : null;
  };

  function showStep(): void {
    for (const s of view.querySelectorAll<HTMLElement>('[data-step]')) {
      const i = Number(s.dataset.step);
      s.classList.toggle('current', i === step && !done);
      s.classList.toggle('done', i < step || done);
      // 단계가 많은 빵(크루아상)은 지금 단계 앞뒤만 — 줄이 화면을 덮지 않게
      if (steps.length > STEP_WINDOW) {
        const lo = Math.max(0, Math.min(step - 1, steps.length - 3));
        s.hidden = i < lo || i > lo + 2;
      }
    }
    const more = view.querySelector<HTMLElement>('[data-more]');
    if (more) more.textContent = `${Math.min(step + 1, steps.length)} / ${steps.length}`;
    hint.textContent = done ? '예쁘게 빚었어요!' : steps[step].hint;
    chipTray.hidden = done || steps[step].gesture !== 'toppings';
  }

  function complete(): void {
    void hapticThud();
    doneAt.set(shapeOf(step), clock);
    lastDone = clock;
    if (step >= steps.length - 1) {
      done = true;
      nextBtn.hidden = false;
      showStep();
      // 다 빚으면 말린 반죽 겉에 드러난 몇 알만 남는다 — 오븐이 그대로 이어받는 자리
      if (bits && toppingIds.length) {
        bits.showFinal(
          formedPieces(def).map((p) => ({ geo: p.geo, at: new THREE.Vector3(p.offset[0], topY, p.offset[1]), surface: true, kind: 'dough' as const })),
          toppingIds,
          seed,
          clock,
        );
        finalBits = true;
      }
    } else pause = STEP_PAUSE;
  }

  /** 연속 몸짓(굴리기·문지르기·누르기)의 진행 */
  function advance(amount: number): void {
    if (done || pause > 0) return;
    setProgress(t + amount);
  }

  function setProgress(v: number): void {
    if (done || pause > 0) return;
    t = clamp(v, 0, 1);
    if (t - lastTickT > 0.1) {
      lastTickT = t;
      void hapticTick();
    }
    if (t >= 1) complete();
  }

  // ---- 떼어 내기 ----
  function tearOff(from: [number, number, number]): void {
    // 판 위 줄 맞춘 자리 중 가장 가까운 빈 자리로
    const used = new Set(torn.map((p) => p.spot));
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < COOKIE_PIECES; i++) {
      if (used.has(i)) continue;
      const dd = Math.hypot(COOKIE_SPOTS[i][0] - from[0], COOKIE_SPOTS[i][1] - from[2]);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    }
    if (best < 0) return;
    torn.push({ spot: best, from, at: clock });
    pull = null;
    void hapticThud();
    setProgress(torn.length / (steps[step].count ?? COOKIE_PIECES));
  }

  /** 당기는 조각의 자리 — 손가락 쪽으로, 볼 속에서 볼 위로 들려 나온다 */
  function pullAt(p: { x: number; y: number }): [number, number, number] | null {
    const q = boardAt(p, pullY);
    if (!q) return null;
    const dist = Math.hypot(q[0] - bowl.x, q[1] - bowl.z);
    const h = bowl.y + bigR() * 1.2 + (pullY - bowl.y - bigR() * 1.2) * clamp(dist / (bigR() + TEAR_DIST), 0, 1);
    return [q[0], h, q[1]];
  }

  // ---- 칼질 ----
  function cutAt(p: { x: number; y: number }): void {
    const lines = cutLines(def.id, shapeOf(step), topY);
    const state = cutState[step];
    if (!lines.length) return;
    const midY = lines[0].y((lines[0].a[0] + lines[0].b[0]) / 2, (lines[0].a[1] + lines[0].b[1]) / 2);
    const q = boardAt(p, midY);
    if (!q) return;
    // 칼날 가까이의 아직 다 자르지 않은 칼선 — 칼선 사이 간격의 절반 안쪽
    const spacing = lines.length > 1 ? Math.hypot(lines[1].a[0] - lines[0].a[0], lines[1].a[1] - lines[0].a[1]) : 1;
    const tol = Math.min(0.02, spacing * 0.45);
    let best = -1;
    let bd = Infinity;
    let bt = 0;
    lines.forEach((l, i) => {
      const c = state[i];
      if (c && c[1] - c[0] >= 1) return;
      const dx = l.b[0] - l.a[0];
      const dz = l.b[1] - l.a[1];
      const len2 = dx * dx + dz * dz;
      const tt = ((q[0] - l.a[0]) * dx + (q[1] - l.a[1]) * dz) / len2;
      if (tt < -0.15 || tt > 1.15) return;
      const px = l.a[0] + dx * clamp(tt, 0, 1);
      const pz = l.a[1] + dz * clamp(tt, 0, 1);
      const dd = Math.hypot(q[0] - px, q[1] - pz) * (i === activeLine ? 0.6 : 1);
      if (dd < tol && dd < bd) {
        bd = dd;
        best = i;
        bt = clamp(tt, 0, 1);
      }
    });
    if (best < 0) {
      activeLine = -1;
      return;
    }
    const c = state[best];
    state[best] = c && best === activeLine ? [Math.min(c[0], bt), Math.max(c[1], bt)] : c ? [Math.min(c[0], bt), Math.max(c[1], bt)] : [bt, bt];
    activeLine = best;
    const cur = state[best]!;
    if (cur[1] - cur[0] >= CUT_DONE) {
      state[best] = [0, 1];
      activeLine = -1;
      void hapticThud();
    } else if (Math.random() < 0.15) void hapticTick();
    const full = state.filter((s) => s && s[1] - s[0] >= 1).length;
    const part = state.reduce((a, s) => a + (s && s[1] - s[0] < 1 ? s[1] - s[0] : 0), 0);
    const prog = (full + part * 0.5) / state.length;
    if (full === state.length) setProgress(1);
    else if (prog > t) t = prog;
  }

  // ---- 하나씩 누르기 ----
  function pieceAt(p: { x: number; y: number }): number {
    const q = boardAt(p);
    if (!q) return -1;
    const press = pressBy[step];
    let best = -1;
    let bd = spotR;
    spots.forEach(([x, z], i) => {
      const dd = Math.hypot(q[0] - x, q[1] - z);
      if (dd < bd && press[i] < 1) {
        bd = dd;
        best = i;
      }
    });
    return best;
  }

  const fg = sv.fg;
  fg.addEventListener('pointerdown', (e) => {
    fg.setPointerCapture(e.pointerId);
    down = true;
    pointer = sv.local(e);
    start = pointer;
    downAt = clock;
    lastAngle = angleOf(pointer);
    if (done || pause > 0) return;
    const g = steps[step];
    if (g.gesture === 'tear' && torn.length < COOKIE_PIECES) {
      // 볼 속 큰 반죽을 잡았을 때
      const q = boardAt(pointer, bowl.y + bigR());
      if (q && Math.hypot(q[0] - bowl.x, q[1] - bowl.z) < bigR() * 2) pull = pullAt(pointer);
    } else if (g.gesture === 'pressEach') pressing = pieceAt(pointer);
    else if (g.gesture === 'cut') {
      activeLine = -1;
      cutAt(pointer);
    }
  });
  fg.addEventListener('pointermove', (e) => {
    const p = sv.local(e);
    const dx = p.x - pointer.x;
    const dy = p.y - pointer.y;
    pointer = p;
    if (!down || done || pause > 0) return;
    const g = steps[step];
    const s = sv.box.size;
    if (g.gesture === 'rub') {
      const a = angleOf(p);
      let da = a - lastAngle;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      lastAngle = a;
      advance(Math.abs(clamp(da, -0.3, 0.3)) / RUB_ANGLE);
    } else if (g.gesture === 'roll') {
      let m = g.axis === 'x' ? dx : dy;
      m = g.dir ? Math.max(0, m * g.dir) : Math.abs(m);
      advance(Math.min(m, s * 0.1) / (s * ROLL_DIST));
    } else if (g.gesture === 'tear' && pull) {
      // 당기는 만큼 늘어나다 끊어진다
      const q = pullAt(p);
      if (!q) return;
      pull = q;
      if (Math.hypot(q[0] - bowl.x, q[2] - bowl.z) > bigR() + TEAR_DIST) tearOff(q);
    } else if (g.gesture === 'pressEach') {
      const i = pieceAt(p);
      if (i >= 0) pressing = i;
    } else if (g.gesture === 'rubEach') {
      // 문지른 만큼 그 조각이 둥글어진다 — 손바닥 밑의 공처럼 문지르는 쪽으로 굴러간다
      const i = pieceAt(p);
      const q = boardAt(p);
      if (i >= 0 && q && lastBoard && rubbing === i) {
        const vx = q[0] - lastBoard[0];
        const vz = q[1] - lastBoard[1];
        const dist = Math.hypot(vx, vz);
        if (dist > 1e-6) rollQ[i].premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(vz / dist, 0, -vx / dist), Math.min(dist, 0.03) / (FLAT_BALL_R * 0.9)));
        const [sx, sz] = spots[i];
        const ox = q[0] - sx;
        const oz = q[1] - sz;
        const ol = Math.hypot(ox, oz);
        const k = ol > 0.007 ? 0.007 / ol : 1;
        rollOff[i] = [ox * k * 0.7, oz * k * 0.7];
      }
      rubbing = i;
      lastBoard = q;
      if (i < 0) return;
      const press = pressBy[step];
      press[i] = Math.min(1, press[i] + Math.min(Math.hypot(dx, dy), s * 0.1) / (s * RUB_ONE_DIST));
      if (press[i] >= 1) void hapticThud();
      setProgress(press.reduce((a, v) => a + v, 0) / press.length);
    } else if (g.gesture === 'cut') cutAt(p);
  });
  const release = (e: PointerEvent) => {
    if (!down) return;
    down = false;
    pressing = -1;
    rubbing = -1;
    lastBoard = null;
    activeLine = -1;
    const g = steps[step];
    if (done || pause > 0) return;
    if (g.gesture === 'tear' && pull) {
      const p = sv.local(e);
      // 톡 누르기만 했으면 그 쪽으로 한 조각 뜯어 준다 — 덜 당기고 놓으면 제자리로 돌아간다
      if (Math.hypot(p.x - start.x, p.y - start.y) < 14 && clock - downAt < 0.4) tearOff([bowl.x, pullY, bowl.z + bigR()]);
      else pull = null;
    }
  };
  fg.addEventListener('pointerup', release);
  fg.addEventListener('pointercancel', () => {
    down = false;
    pressing = -1;
    pull = null;
  });

  // ---- 도구 (2D 그림) ----
  function drawTool(g: CanvasRenderingContext2D, key: 'pin' | 'knife', x: number, y: number, angle = 0): void {
    const img = sprite(`tool/${key}`);
    const tm = META.tool[key];
    const anchor = key === 'pin' ? tm?.center : tm?.tip;
    if (!ready(img) || !anchor) return;
    const b = sv.box;
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.drawImage(img, -anchor[0] * b.size, -anchor[1] * b.size, b.size, b.size);
    g.restore();
  }

  /** 빵칼이 칼선을 따라 눕도록 — 가까운 칼선의 화면 방향(손잡이는 오른쪽) */
  function knifeAngle(): number {
    const st = sv.stage;
    const lines = cutLines(def.id, shapeOf(step), topY);
    if (!st || !lines.length) return 0;
    const i = activeLine >= 0 ? activeLine : 0;
    const l = lines[i];
    const a = st.project(new THREE.Vector3(l.a[0], l.y(l.a[0], l.a[1]), l.a[1]));
    const b = st.project(new THREE.Vector3(l.b[0], l.y(l.b[0], l.b[1]), l.b[1]));
    let ang = Math.atan2(b.y - a.y, b.x - a.x);
    // 칼끝이 왼쪽(그림의 -x)이라 손잡이가 오른쪽·위로 오게 접는다
    if (ang > Math.PI / 2) ang -= Math.PI;
    if (ang < -Math.PI / 2) ang += Math.PI;
    return ang;
  }

  /** 스크레이퍼 — 가까운 칼선을 따라 서서 손가락 자리의 반죽을 누른다 */
  function placeScraper(): void {
    const lines = cutLines(def.id, shapeOf(step), topY);
    const q = boardAt(pointer, topY + 0.03);
    if (!lines.length || !q) return;
    const l = lines[activeLine >= 0 ? activeLine : 0];
    // 날은 칼선 위에 — 손가락 자리를 칼선에 내린 점
    const dx = l.b[0] - l.a[0];
    const dz = l.b[1] - l.a[1];
    const tt = clamp(((q[0] - l.a[0]) * dx + (q[1] - l.a[1]) * dz) / (dx * dx + dz * dz), 0, 1);
    const x = activeLine >= 0 ? l.a[0] + dx * tt : q[0];
    const z = activeLine >= 0 ? l.a[1] + dz * tt : q[1];
    scraper.visible = true;
    scraper.position.set(boardC[0] + x, activeLine >= 0 ? topY + 0.004 : l.y(x, z) + 0.01, boardC[1] + z);
    scraper.rotation.y = -Math.atan2(dz, dx);
  }

  /** 안내선 — 아직 긋지 않은 칼선과 접을 자리를 점선으로 */
  function drawGuides(g: CanvasRenderingContext2D): void {
    const st = sv.stage;
    if (!st) return;
    const stepIdx = shapeOf(step);
    const P = (x: number, y: number, z: number) => st.project(new THREE.Vector3(boardC[0] + x, y, boardC[1] + z));
    const lines: { x: number; y: number }[][] = [];
    cutLines(def.id, stepIdx, topY).forEach((l, i) => {
      const c = cutState[step][i];
      if (c && c[1] - c[0] >= 1) return;
      // 겉면을 따라 — 봉긋한 반죽 위에서는 휘어 보인다
      lines.push(
        Array.from({ length: 13 }, (_, k) => {
          const x = l.a[0] + ((l.b[0] - l.a[0]) * k) / 12;
          const z = l.a[1] + ((l.b[1] - l.a[1]) * k) / 12;
          return P(x, l.y(x, z), z);
        }),
      );
    });
    for (const f of foldGuides(def.id, stepIdx, t, topY)) lines.push(f.map(([x, y, z]) => P(x, y, z)));
    if (!lines.length) return;
    g.save();
    g.setLineDash([6, 6]);
    g.lineWidth = 2;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(120, 78, 40, 0.75)';
    for (const l of lines) {
      g.beginPath();
      l.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y)));
      g.stroke();
    }
    g.restore();
  }

  // ---- 그리기 ----
  let raf = 0;
  let disposed = false;
  let last = performance.now();

  function frame(now: number): void {
    if (disposed) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    clock += dt;

    const g = steps[step];
    if (down && !done && pause <= 0) {
      if (g.gesture === 'press') advance(dt / PRESS_SEC);
      if (g.gesture === 'pressEach' && pressing >= 0) {
        const press = pressBy[step];
        press[pressing] = Math.min(1, press[pressing] + dt / PRESS_ONE_SEC);
        if (press[pressing] >= 1) {
          void hapticThud();
          pressing = -1;
        }
        setProgress(press.reduce((a, v) => a + v, 0) / press.length);
      }
    }
    if (pause > 0) {
      pause -= dt;
      if (pause <= 0) {
        pause = 0;
        step++;
        t = 0;
        lastTickT = 0;
        stepAt = clock;
        showStep();
      }
    }
    shown += (step + t - shown) * Math.min(1, dt * FOLLOW);
    // 손을 뗀 조각은 제자리로 돌아온다
    rollOff.forEach((o, i) => {
      if (i === rubbing) return;
      const k = Math.exp(-dt * 7);
      rollOff[i] = Math.abs(o[0]) + Math.abs(o[1]) < 1e-5 ? [0, 0] : [o[0] * k, o[1] * k];
    });

    const fgc = sv.layout();
    if (sv.stage) {
      rebuild();
      if (bits) {
        const stepShown = Math.min(steps.length - 1, Math.floor(shown + 1e-4));
        const logic = shapeOf(stepShown);
        const tShown = clamp(shown - stepShown, 0, 1);
        bits.update(clock, finalBits ? () => 1 : (x, z) => sheetCover(def.id, logic, tShown, x, z, pressBy[stepShown]));
      }
      sv.render();
    }
    if (!done && pause <= 0) drawGuides(fgc);
    // 손가락을 따라다니는 도구 — 밀대와 빵칼(그림), 스크레이퍼(3D)
    const using = down && !done && pause <= 0;
    scraper.visible = false;
    if (using) {
      const c = center();
      // 밀대는 미는 방향에 직각으로 — 가로로 밀 땐 세워서
      if (g.tool === 'pin') drawTool(fgc, 'pin', g.axis === 'x' ? pointer.x : c.x, g.axis === 'x' ? c.y : pointer.y, g.axis === 'x' ? Math.PI / 2 : 0);
      else if (g.tool === 'knife') drawTool(fgc, 'knife', pointer.x, pointer.y, knifeAngle());
      else if (g.tool === 'scraper') placeScraper();
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  showStep();

  // ---- 토핑 올리기 ----
  let putCount = 0;
  for (const chip of view.querySelectorAll<HTMLButtonElement>('[data-chip]')) {
    bindPutChip(chip, () => {
      chip.disabled = true;
      chip.classList.add('used');
      bits?.put(chip.dataset.chip as ToppingId, clock);
      void hapticTick();
      putCount++;
      if (putCount >= putList.length) setProgress(1);
    });
  }

  // 개발자 모드: 지금 단계를 바로 끝낸다 (브라우저 확인용 — window.__formSkip())
  if (dev().enabled) {
    (window as unknown as { __formSkip?: () => void }).__formSkip = () => {
      if (done || pause > 0) return;
      cutState[step] = cutState[step].map(() => [0, 1] as [number, number]);
      pressBy[step].fill(1);
      for (const chip of steps[step].gesture === 'toppings' ? view.querySelectorAll<HTMLButtonElement>('[data-chip]:not(.used)') : []) {
        chip.classList.add('used');
        chip.disabled = true;
        bits?.put(chip.dataset.chip as ToppingId, clock);
      }
      setProgress(1);
    };
    // 지금 단계·진행도를 바로 정한다 (브라우저 확인용 — window.__formSet(단계, 0~1))
    (window as unknown as { __formSet?: (i: number, v: number) => void }).__formSet = (i, v) => {
      for (let k = 0; k < i; k++) if (!doneAt.has(shapeOf(k))) doneAt.set(shapeOf(k), clock - 5);
      step = Math.min(steps.length - 1, i);
      t = v;
      shown = step + v;
      done = false;
      pause = 0;
      showStep();
    };
  }

  // ---- 내비게이션 ----
  view.querySelector('[data-back]')!.addEventListener('click', () => {
    confirmSheet('처음 화면으로 갈까요? 반죽한 건 사라져요', () => ctx.go('title'));
  });
  nextBtn.addEventListener('click', () => {
    if (lattice) ctx.go('mold', { ...next, phase: 'lattice' });
    else ctx.go(toTopping ? 'shaping' : 'mold', next);
  });

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    bits?.dispose();
    sv.dispose();
  };
}
