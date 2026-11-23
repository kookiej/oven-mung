// 굽기 단계 — 이 게임의 심장. 오븐 창 너머로 빵이 구워지는 걸 바라본다.
// 진행은 wall-clock 기준이라 앱을 껐다 켜도 정확히 이어진다.
// 팬케이크처럼 굽는 중간에 칼집을 내는 빵은 덜 익은 때(SCORE_AT)에서 기다리고, 칼집을 내면 startedAt을 다시 맞춰 나머지를 굽는다.
import type { StageCtx } from '../main';
import { confirmSheet, el, openSettingsSheet } from '../ui';
import { SCORE_AT, getBread } from '../content/breads';
import { comboName } from '../content/toppings';
import { getSave, persist } from '../state/save';
import { audio } from '../audio/engine';
import { BakingScene, FPS_CAP } from '../render/scene';
import { loadBreadModel } from '../render/breadModel';
import { FogLayer } from '../render/fog';
import { META, loadSprites, ready, sprite } from '../render/sprites';
import {
  cancelBakeNotification,
  hapticThud,
  hapticTick,
  keepScreenAwake,
  scheduleBakeDoneNotification,
} from '../native';
import { clamp, smoothstep } from '../util';
import type { ActiveBake, Quality } from '../types';
import { dev } from '../dev/devState';

/** 굽기 진행도 → 갈변 정도. 초반엔 천천히, 중반부터 가속. 1 초과는 계속 진해짐 */
export function browningOf(progress: number): number {
  if (progress <= 0.15) return 0;
  const t = Math.min((progress - 0.15) / 0.85, 1);
  const base = Math.pow(t, 1.35);
  if (progress <= 1) return base;
  return Math.min(1 + (progress - 1) * 0.5, 1.6);
}

function statusText(progress: number): string {
  if (progress < 0.08) return '반죽이 오븐의 온기에 몸을 녹이는 중…';
  if (progress < 0.45) return '천천히 부풀어 오르고 있어요';
  if (progress < 0.7) return '색이 나기 시작했어요';
  if (progress < 1) return '노릇노릇해지는 중…';
  if (progress < 1.25) return '다 구워졌어요! 천천히 꺼내도 돼요';
  return '점점 더 진해지고 있어요 (괜찮아요, 실패는 없어요)';
}

function resolveTier(): Quality {
  const save = getSave();
  if (save.settings.quality !== 'auto') return save.settings.quality;
  return save.benchTier ?? 'mid';
}

export function mountBaking(root: HTMLElement, ctx: StageCtx): () => void {
  const save = getSave();
  const active = save.activeBake;
  if (!active) {
    ctx.go('title');
    return () => {};
  }
  const bake: ActiveBake = active;
  const def = getBread(bake.breadId);

  const view = el(`
    <div class="baking-view">
      <div class="stage-header">
        <button class="btn btn-ghost" data-back>←</button>
        <span class="stage-title">${def.emoji} ${comboName(def, bake.toppingIds)} 굽는 중</span>
        <span></span>
      </div>
      <div class="oven-frame">
        <div class="oven-window">
          <canvas class="gl-canvas" data-gl></canvas>
          <canvas class="fog-canvas" data-fog></canvas>
          ${def.midScore ? '<canvas class="fog-canvas score-canvas" data-score hidden></canvas>' : ''}
          ${dev().enabled && dev().showFps ? '<span class="dev-fps" data-fps>– fps</span>' : ''}
        </div>
        <div class="oven-handle"></div>
      </div>
      <p class="bake-status" data-status>…</p>
      <div class="bake-controls">
        <button class="btn btn-round" data-light title="오븐 조명">💡</button>
        <button class="btn btn-round" data-sound title="소리">🎚️</button>
        <button class="btn btn-primary" data-out disabled>꺼내기 🧤</button>
      </div>
    </div>
  `);
  root.appendChild(view);

  const glCanvas = view.querySelector<HTMLCanvasElement>('[data-gl]')!;
  const fogCanvas = view.querySelector<HTMLCanvasElement>('[data-fog]')!;
  const statusEl = view.querySelector<HTMLElement>('[data-status]')!;
  const outBtn = view.querySelector<HTMLButtonElement>('[data-out]')!;
  const lightBtn = view.querySelector<HTMLButtonElement>('[data-light]')!;

  const tier = resolveTier();
  // 오븐 속 빵·그릇은 Blender 카툰 에셋(GLB) — 불러오는 동안은 빈 오븐, 못 불러오면 절차적 메시로
  let scene: BakingScene | null = null;
  const fog = new FogLayer(fogCanvas);

  audio.setAmbient(true);
  void keepScreenAwake(true);

  // ---- 자동 벤치마크 (첫 굽기에서만): 프레임타임으로 티어 결정 ----
  let benchFrames = 0;
  let benchTime = 0;
  const needBench = save.settings.quality === 'auto' && save.benchTier === null;

  // ---- 김서림 인터랙션: 탭=입김, 드래그=닦기 ----
  let pointerDown = false;
  let moved = false;
  let px = 0;
  let py = 0;
  fogCanvas.addEventListener('pointerdown', (e) => {
    pointerDown = true;
    moved = false;
    px = e.clientX;
    py = e.clientY;
    fogCanvas.setPointerCapture(e.pointerId);
  });
  fogCanvas.addEventListener('pointermove', (e) => {
    if (!pointerDown) return;
    if (!moved && Math.hypot(e.clientX - px, e.clientY - py) > 12) moved = true;
    if (moved) {
      fog.wipe(px, py, e.clientX, e.clientY);
      px = e.clientX;
      py = e.clientY;
    }
  });
  fogCanvas.addEventListener('pointerup', (e) => {
    if (pointerDown && !moved) {
      fog.tapAt(e.clientX, e.clientY);
      void hapticTick();
    }
    pointerDown = false;
  });
  fogCanvas.addEventListener('pointercancel', () => {
    pointerDown = false;
  });

  // ---- 컨트롤 ----
  let lightOn = true;
  lightBtn.addEventListener('click', () => {
    lightOn = !lightOn;
    scene?.setLight(lightOn);
    lightBtn.classList.toggle('off', !lightOn);
    void hapticTick();
  });
  view.querySelector('[data-sound]')!.addEventListener('click', () => openSettingsSheet());
  view.querySelector('[data-back]')!.addEventListener('click', () => {
    confirmSheet('오븐에서 나갈까요? 굽기는 계속 진행돼요', () => ctx.go('title'));
  });

  // ---- 중간 칼집 ----
  const scoreCanvas = view.querySelector<HTMLCanvasElement>('[data-score]');
  /** 줄마다 칼날이 지나간 구간 0~1 */
  const scoreRange: ([number, number] | null)[] = [null, null];
  let scoreDown = false;
  let scorePointer = { x: 0, y: 0 };
  /** 칼집을 기다리는 중인지 */
  const raw = () => (Date.now() - bake.startedAt) / bake.durationMs;
  const waitingScore = () => !!def.midScore && !bake.scored && raw() >= SCORE_AT;
  /** 지금 진행도 — 칼집을 내기 전에는 SCORE_AT에서 멈춘다 */
  const progressNow = () => (def.midScore && !bake.scored ? Math.min(raw(), SCORE_AT) : raw());
  const scoreOpen = (p: number) => (bake.scored ? smoothstep(SCORE_AT, 0.85, p) : 0);
  if (def.midScore) void loadSprites(['tool/knife']);

  function finishScore(): void {
    bake.scored = true;
    // 멈춰 있던 만큼 startedAt을 다시 맞춘다 — 진행도는 계속 wall-clock에서 나온다
    bake.startedAt = Date.now() - SCORE_AT * bake.durationMs;
    void persist();
    void scheduleBakeDoneNotification(bake.startedAt + bake.durationMs, comboName(def, bake.toppingIds));
    void hapticThud();
    scene?.setScore(true, 0);
    // 안내 점선은 칼집을 낸 뒤엔 남지 않는다 — 숨기고, 그려 둔 것도 지운다
    scoreCanvas!.hidden = true;
    scoreCanvas!.getContext('2d')!.clearRect(0, 0, scoreCanvas!.width, scoreCanvas!.height);
    scoreCanvas!.style.display = 'none';
  }

  function scoreAt(p: { x: number; y: number }): void {
    const lines = scene?.scoreLines() ?? [];
    let best = -1;
    let bd = 38;
    let bt = 0;
    lines.forEach((l, i) => {
      const c = scoreRange[i];
      if (c && c[1] - c[0] >= 1) return;
      const dx = l.b.x - l.a.x;
      const dy = l.b.y - l.a.y;
      const tt = ((p.x - l.a.x) * dx + (p.y - l.a.y) * dy) / (dx * dx + dy * dy);
      if (tt < -0.15 || tt > 1.15) return;
      const u = clamp(tt, 0, 1);
      const dd = Math.hypot(p.x - (l.a.x + dx * u), p.y - (l.a.y + dy * u));
      if (dd < bd) {
        bd = dd;
        best = i;
        bt = u;
      }
    });
    if (best < 0) return;
    const c = scoreRange[best];
    scoreRange[best] = c ? [Math.min(c[0], bt), Math.max(c[1], bt)] : [bt, bt];
    const cur = scoreRange[best]!;
    if (cur[1] - cur[0] >= 0.85) {
      scoreRange[best] = [0, 1];
      void hapticThud();
    } else if (Math.random() < 0.12) void hapticTick();
    if (scoreRange.every((r) => r && r[1] - r[0] >= 1)) finishScore();
  }

  if (scoreCanvas) {
    const local = (e: PointerEvent) => {
      const r = scoreCanvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    scoreCanvas.addEventListener('pointerdown', (e) => {
      scoreCanvas.setPointerCapture(e.pointerId);
      scoreDown = true;
      scorePointer = local(e);
      scoreAt(scorePointer);
    });
    scoreCanvas.addEventListener('pointermove', (e) => {
      if (!scoreDown) return;
      scorePointer = local(e);
      scoreAt(scorePointer);
    });
    const up = () => (scoreDown = false);
    scoreCanvas.addEventListener('pointerup', up);
    scoreCanvas.addEventListener('pointercancel', up);
  }

  /** 칼집 낼 자리(점선)·그은 자리·빵칼 */
  function drawScore(): void {
    const c = scoreCanvas;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const lines = scene?.scoreLines() ?? [];
    lines.forEach((l, i) => {
      g.setLineDash([7, 7]);
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(255,245,225,0.8)';
      g.beginPath();
      g.moveTo(l.a.x, l.a.y);
      g.lineTo(l.b.x, l.b.y);
      g.stroke();
      g.setLineDash([]);
      const r = scoreRange[i];
      if (!r || r[1] - r[0] < 0.01) return;
      const at = (u: number) => ({ x: l.a.x + (l.b.x - l.a.x) * u, y: l.a.y + (l.b.y - l.a.y) * u });
      const p0 = at(r[0]);
      const p1 = at(r[1]);
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(92,52,20,0.95)';
      g.beginPath();
      g.moveTo(p0.x, p0.y);
      g.lineTo(p1.x, p1.y);
      g.stroke();
    });
    const img = sprite('tool/knife');
    const tip = META.tool.knife?.tip;
    if (scoreDown && ready(img) && tip) {
      g.save();
      g.translate(scorePointer.x, scorePointer.y);
      // 빵칼 그림은 큰 모양 빚기 판의 카메라로 렌더했다 — 오븐 창에선 조금 키운다
      const ks = w * 1.43;
      g.drawImage(img, -tip[0] * ks, -tip[1] * ks, ks, ks);
      g.restore();
    }
  }

  let dinged = progressNow() >= 1;

  outBtn.addEventListener('click', async () => {
    const progress = progressNow();
    const browning = browningOf(progress);
    void cancelBakeNotification();
    save.activeBake = null;
    await persist();
    ctx.go('finish', {
      breadId: bake.breadId,
      toppingIds: bake.toppingIds,
      browning,
      seed: bake.seed,
      roughness: bake.roughness,
      layout: bake.layout,
      progress,
      // 칼집을 내기 전에 꺼냈으면 칼집 없는 빵이다
      scoreOpen: def.midScore ? scoreOpen(progress) : undefined,
    });
  });

  // ---- 메인 루프 ----
  let raf = 0;
  let disposed = false;
  let lastFrame = 0;
  let lastTick = performance.now();
  const frameInterval = 1000 / FPS_CAP[tier];
  const fpsEl = view.querySelector<HTMLElement>('[data-fps]');
  let fpsFrames = 0;
  let fpsSince = performance.now();

  function loop(now: number): void {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    if (now - lastFrame < frameInterval - 1) return;

    const dt = Math.min((now - lastTick) / 1000, 0.2);
    lastTick = now;
    lastFrame = now;

    // 개발자 모드: 0.5초마다 평균 FPS
    if (fpsEl) {
      fpsFrames++;
      if (now - fpsSince >= 500) {
        fpsEl.textContent = `${Math.round((fpsFrames * 1000) / (now - fpsSince))} fps · ${tier}`;
        fpsFrames = 0;
        fpsSince = now;
      }
    }

    if (scene && needBench && save.benchTier === null) {
      benchFrames++;
      if (benchFrames > 20) benchTime += dt; // 워밍업 이후부터 측정
      if (benchFrames >= 80) {
        const avgFps = 60 / Math.max(benchTime, 0.01);
        save.benchTier = avgFps < 40 ? 'low' : avgFps > 52 ? 'high' : 'mid';
        void persist();
      }
    }

    const progress = progressNow();
    const browning = browningOf(progress);
    const waiting = waitingScore();
    if (def.midScore) scene?.setScore(!!bake.scored, scoreOpen(progress));
    if (scoreCanvas && scoreCanvas.hidden === waiting) scoreCanvas.hidden = !waiting;
    if (waiting) drawScore();
    scene?.setProgress(progress, browning);
    audio.browningLevel = browning;
    scene?.render(now / 1000);
    fog.tick(dt);

    statusEl.textContent = waiting ? '아직 덜 익었어요 · 빵칼로 점선을 따라 십자로 칼집을 내주세요' : statusText(progress);
    // 칼집을 기다리는 동안은 꺼내지 않는다
    outBtn.disabled = waiting || progress <= 0.12;
    if (progress >= 1 && !dinged) {
      dinged = true;
      audio.ensure();
      audio.ding();
      outBtn.classList.add('glow');
    }
  }
  void loadBreadModel(def, bake.toppingIds, bake.seed, bake.layout).then((model) => {
    if (disposed) return;
    scene = new BakingScene(glCanvas, def, bake.toppingIds, bake.seed, tier, model);
    scene.setLight(lightOn);
    // 레이아웃 확정 후 한 번 더
    requestAnimationFrame(() => scene?.resize());
  });
  raf = requestAnimationFrame(loop);

  const onResize = () => scene?.resize();
  window.addEventListener('resize', onResize);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    audio.setAmbient(false);
    audio.browningLevel = 0;
    void keepScreenAwake(false);
    scene?.dispose();
  };
}
