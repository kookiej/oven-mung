// 꺼내기 단계 — 오븐에서 구운 그 빵(같은 3D 오브젝트)을 반죽 판에 올려 자르고, 도감에 저장한다.
// 같은 판·같은 시점(무대 stage/cut — 깨끗한 판). render/cutScene.ts.
//   컵케이크는 먼저 종이컵을 벗긴다 — 쓸어서. 슈가파우더는 구운 뒤에 뿌린다 — 손가락을 흔들면 솔솔 내려앉는다.
//   와플은 격자가 있는 면이 위로 오게 보여 준다.
//   긴 빵은 가로로, 빵칼은 세로로 놓인다. 손가락으로 위에서 아래로 쓸면 빵칼이 따라 내려가며 빵을 가른다(손가락을 움직인 만큼 앞뒤로 썬다).
//   다 잘라도 저절로 벌어지지 않는다 — 빵을 톡 누르면 두 쪽이 돌아누워 자른 면(속살·속에 넣은 소)이 보인다.
// 3D 빵을 불러오지 못하면 예전 2D 그림으로 자른다.
import type { StageCtx } from '../main';
import { confirmSheet, el } from '../ui';
import { getBread } from '../content/breads';
import { bakeTitle, hasDusting } from '../content/toppings';
import { upsertRecord } from '../state/album';
import { breadSpan, breadSpriteKeys, crumbFaceHeight, drawCrumbFace, paintBread } from '../render/bread2d';
import { loadSprites } from '../render/sprites';
import { loadBreadModel } from '../render/breadModel';
import { CutScene } from '../render/cutScene';
import { StageView } from '../render/live/stageView';
import { hapticThud, hapticTick } from '../native';
import { clamp } from '../util';
import type { BreadId, DoughLayout, ToppingId } from '../types';

interface FinishData {
  breadId: BreadId;
  toppingIds: ToppingId[];
  browning: number;
  seed: number;
  roughness: number;
  layout?: DoughLayout;
  /** 꺼낸 시점의 굽기 진행도 — 없으면 다 구운 빵 */
  progress?: number;
  /** 굽는 중간에 낸 칼집이 벌어진 정도 — 없으면 Blender 메시 그대로 */
  scoreOpen?: number;
}

/** 슈가파우더: 화면 크기의 이 배수만큼 손가락을 움직이면 다 뿌린 것 */
const DUST_DIST = 2.2;
/** 자른 면을 보이는 시간(초) */
const OPEN_SEC = 0.9;
/** 칼이 빠져나가는 시간(초) */
const KNIFE_AWAY_SEC = 0.45;
/** 다 벗긴 종이컵이 치워지는 시간(초) */
const LINER_AWAY_SEC = 0.45;

const HINT = {
  peel: '종이컵을 손가락으로 쓸어 벗겨주세요',
  dust: '손가락을 흔들어 슈가파우더를 솔솔 뿌려주세요',
  cut: '빵 위에서 아래로 쓸어내려 잘라보세요 🔪',
  tap: '잘렸어요! 빵을 톡 누르면 자른 면이 보여요',
};

export function mountFinish(root: HTMLElement, ctx: StageCtx, data?: unknown): () => void {
  const d = data as FinishData | undefined;
  if (!d) {
    ctx.go('title');
    return () => {};
  }
  const def = getBread(d.breadId);
  const title = bakeTitle(def, d.toppingIds, d.browning);

  const view = el(`
    <div class="finish-view">
      <div class="stage-header">
        <button class="btn btn-ghost" data-back>←</button>
        <span class="stage-title">갓 구운 ${def.name}</span>
        <span></span>
      </div>
      <div data-stage class="stage-slot"></div>
      <div class="finish-stage" data-fallback hidden><canvas class="finish-canvas" data-canvas></canvas></div>
      <p class="hint" data-hint>${HINT.cut}</p>
      <div class="finish-panel" data-panel hidden>
        <p class="finish-caption">${title}${def.emoji}</p>
        <div class="finish-buttons">
          <button class="btn btn-primary btn-big" data-save>도감에 저장</button>
          <button class="btn" data-again>바로 한 번 더 굽기</button>
        </div>
      </div>
    </div>
  `);
  root.appendChild(view);
  const sv = new StageView('cut', 0.5);
  view.querySelector('[data-stage]')!.replaceWith(sv.el);

  const fallback = view.querySelector<HTMLElement>('[data-fallback]')!;
  const canvas = view.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const cctx = canvas.getContext('2d')!;
  const hint = view.querySelector<HTMLElement>('[data-hint]')!;
  const panel = view.querySelector<HTMLElement>('[data-panel]')!;

  let scene: CutScene | null = null;
  let use2d = false;
  type Phase = 'loading' | 'peel' | 'dust' | 'cut' | 'tap' | 'open' | 'done';
  const dusting = hasDusting(d.toppingIds);
  let dust = 0;
  /** 체에서 떨어지는 슈가파우더 (2D) */
  let snow: { x: number; y: number; vy: number; end: number }[] = [];
  let phase: Phase = 'loading';
  let peel = 0;
  let linerAway = 0;
  /** 칼이 내려간 깊이 0~1 (가장 깊이 간 만큼) */
  let depth = 0;
  let knifeAway = 0;
  let open = 0;
  let saw = 0;
  let down = false;
  let lastX = 0;
  let lastY = 0;
  let startX = 0;
  let startY = 0;
  let lastTick = 0;
  let raf = 0;
  let disposed = false;
  let last = performance.now();

  function setPhase(p: Phase): void {
    phase = p;
    if (p === 'peel') hint.textContent = HINT.peel;
    else if (p === 'dust') hint.textContent = HINT.dust;
    else if (p === 'cut') hint.textContent = HINT.cut;
    else if (p === 'tap') hint.textContent = HINT.tap;
  }

  // ---- 3D ----
  // 와플은 틀에 닿았던 격자 면이 보이게 — 격자가 있는 메시로
  const variant = def.pattern === 'grid' ? 'waffle_grid' : undefined;
  void Promise.all([loadBreadModel(def, d.toppingIds, d.seed, d.layout, variant), sv.load().catch(() => null)]).then(([model, st]) => {
    if (disposed) return;
    if (!model || !st) {
      use2d = true;
      sv.el.hidden = true;
      fallback.hidden = false;
      void loadSprites(breadSpriteKeys(def.id));
      setPhase('cut');
      return;
    }
    scene = new CutScene(st, def, d.toppingIds, d.seed, d.browning, model, d.progress ?? 1, d.scoreOpen ?? 1);
    setPhase(scene.hasLiner ? 'peel' : dusting ? 'dust' : 'cut');
  });

  function frame(now: number): void {
    if (disposed) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (phase === 'open' && open < 1) {
      open = Math.min(1, open + dt / OPEN_SEC);
      if (open >= 1) {
        phase = 'done';
        hint.hidden = true;
        panel.hidden = false;
      }
    }
    // 칼은 다 자르면 위로 빠져나간다
    if (phase === 'tap' || phase === 'open' || phase === 'done') knifeAway = Math.min(1, knifeAway + dt / KNIFE_AWAY_SEC);
    saw *= Math.exp(-dt * 6);
    const fgc = sv.layout();
    if (scene) {
      if (peel >= 1 && linerAway < 1) linerAway = Math.min(1, linerAway + dt / LINER_AWAY_SEC);
      scene.setPeel(peel, linerAway);
      scene.setSugar(dust);
      scene.setKnife(phase !== 'peel' && phase !== 'loading', depth, saw, knifeAway);
      scene.setSeam(phase === 'tap');
      if (open > 0) scene.setOpen(open);
      sv.render();
      // 슈가파우더가 떨어지는 모습
      for (const p of snow) {
        p.vy += dt * 420;
        p.y += p.vy * dt;
      }
      snow = snow.filter((p) => p.y < p.end);
      fgc.fillStyle = 'rgba(255,252,246,0.9)';
      for (const p of snow) fgc.fillRect(p.x, p.y, 1.8, 1.8);
    } else if (use2d) draw2d();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // ---- 입력 ----
  function cutTo(k: number): void {
    if (k > depth) {
      depth = k;
      if (depth - lastTick > 0.15) {
        lastTick = depth;
        void hapticTick();
      }
    }
    if (depth >= 0.98) {
      depth = 1;
      down = false;
      void hapticThud();
      setPhase('tap');
    }
  }

  function bindInput(c: HTMLElement, localY: (e: PointerEvent) => number, height: () => number): void {
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      down = true;
      lastX = startX = e.clientX;
      lastY = startY = e.clientY;
      if (phase === 'cut' && scene) cutTo(scene.depthAt(localY(e)) * 0.25);
    });
    c.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (phase === 'peel') {
        peel = clamp(peel + Math.hypot(dx, dy) / (sv.box.size * 0.9), 0, 1);
        if (peel >= 1) {
          down = false;
          void hapticThud();
          setPhase(dusting ? 'dust' : 'cut');
        }
      } else if (phase === 'dust') {
        const moved = Math.hypot(dx, dy);
        dust = clamp(dust + moved / (sv.box.size * DUST_DIST), 0, 1);
        const r = c.getBoundingClientRect();
        for (let i = 0; i < Math.min(6, moved / 3); i++) {
          snow.push({
            x: e.clientX - r.left + (Math.random() - 0.5) * 44,
            y: e.clientY - r.top + Math.random() * 10,
            vy: 40 + Math.random() * 60,
            end: sv.box.y + sv.box.size * (0.52 + Math.random() * 0.1),
          });
        }
        if (dust >= 1) {
          down = false;
          void hapticThud();
          setPhase('cut');
        }
      } else if (phase === 'cut') {
        // 움직인 만큼 칼날 방향(앞뒤)으로 썬다
        saw = clamp(saw + (dx + dy) / 90, -1, 1);
        cutTo(scene ? scene.depthAt(localY(e)) : clamp(localY(e) / (height() || 1), 0, 1));
      }
    });
    const up = (e: PointerEvent) => {
      if (phase === 'tap' && Math.hypot(e.clientX - startX, e.clientY - startY) < 18) {
        const r = c.getBoundingClientRect();
        if (!scene || scene.hit(e.clientX - r.left, e.clientY - r.top)) {
          phase = 'open';
          void hapticTick();
        }
      }
      down = false;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', () => (down = false));
  }
  bindInput(sv.fg, (e) => sv.local(e).y, () => sv.h);
  bindInput(canvas, (e) => e.clientY - canvas.getBoundingClientRect().top, () => canvas.clientHeight);

  // ---- 3D를 못 쓸 때의 2D (예전 그림) ----
  function draw2d(): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.clearRect(0, 0, w, h);
    const cut = 1 - (1 - open) ** 3;
    const gap = cut * Math.min(w, h) * 0.16;
    const s = Math.min(w, h);
    if (cut <= 0.01) {
      paintBread(cctx, def, d!.toppingIds, d!.browning, d!.seed, w, h);
      return;
    }
    for (const side of [-1, 1]) {
      cctx.save();
      cctx.translate(side * gap, 0);
      cctx.beginPath();
      if (side < 0) cctx.rect(0, 0, w / 2 + gap, h);
      else cctx.rect(w / 2 - gap, 0, w / 2 + gap, h);
      cctx.clip();
      paintBread(cctx, def, d!.toppingIds, d!.browning, d!.seed, w, h);
      cctx.restore();
    }
    const span = breadSpan(def, w, h);
    const faceH = span ? (span.bottom - span.top) * 0.36 : crumbFaceHeight(def, s);
    const faceY = span ? span.top + (span.bottom - span.top) * 0.55 : h / 2 + s * 0.07;
    drawCrumbFace(cctx, def, d!.toppingIds, d!.browning, d!.seed, w / 2 - gap, faceY, gap * 0.55 + 2, faceH * clamp(cut * 1.4, 0, 1));
  }

  // ---- 나가기 / 저장 / 다시 굽기 ----
  view.querySelector('[data-back]')!.addEventListener('click', () => {
    confirmSheet('도감에 저장하지 않고 나갈까요? 이 빵은 사라져요', () => ctx.go('title'));
  });

  view.querySelector('[data-save]')!.addEventListener('click', async () => {
    await upsertRecord({
      breadId: d.breadId,
      toppingIds: d.toppingIds,
      browning: d.browning,
      seed: d.seed,
      roughness: d.roughness,
      finishedAt: Date.now(),
    });
    ctx.go('album');
  });
  view.querySelector('[data-again]')!.addEventListener('click', () => ctx.go('choose'));

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    sv.dispose();
  };
}
