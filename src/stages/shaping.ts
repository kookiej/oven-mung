// 토핑 올리기 — 앞에서 고른 토핑(pick)을 다 빚은 반죽 위에 올린다. stage 이름은 역사적 이유로 shaping이다.
//   틀 빵: 틀에 넣기(mold)를 마친 모습 그대로(실시간 3D) 토핑을 올리고 오븐에 넣는다.
//   쿠키·플랫브레드: 모양 빚기 다음, 트레이 무대 앞쪽 반죽 판 위에서 올린다 — 그 뒤 틀에 넣기(mold)에서 하나씩 트레이로 옮긴다.
//   말거나 접어 빚는 빵(식빵·크루아상·베이글·바게트·프레첼)은 밀어 편 반죽에 올리므로 이 화면을 거치지 않는다(forming의 토핑 단계).
//   파이는 토핑이 곧 필링이다 — 토핑이 없으면 이 화면을 건너뛰고 필링 없이 속이 빈 채로 굽는다.
// 앙금 같은 소(filling)는 반죽 위에 한 숟갈 얹혔다가 속으로 쏙 들어간다 — 겉에선 안 보이고 자르면 보인다.
// 미리보기와 오븐 속 빵이 같은 seed를 써서, 여기서 본 알갱이 배치 규칙 그대로 구워진다.
import type { StageCtx } from '../main';
import { bindPutChip, confirmSheet, el } from '../ui';
import { BREADS, bakeDurationMs, getBread } from '../content/breads';
import { comboName, placedToppings } from '../content/toppings';
import { rollsIn } from '../content/forming';
import { getSave, persist } from '../state/save';
import { StageView } from '../render/live/stageView';
import { ToppingScene } from '../render/live/toppingScene';
import { stageOf } from '../render/live/placed';
import { usesVessel } from '../content/vessels';
import { scheduleBakeDoneNotification, hapticTick } from '../native';
import type { BreadDef, BreadId, DoughLayout, ToppingId } from '../types';

/** 오븐에 넣는다 — 굽기 시간을 고정하고(wall-clock) 완료 알림을 건다. 토핑 올리기·틀에 넣기가 함께 쓴다 */
export async function startBake(ctx: StageCtx, def: BreadDef, toppingIds: ToppingId[], seed: number, roughness: number, layout?: DoughLayout): Promise<void> {
  const save = getSave();
  const durationMs = bakeDurationMs(def, save.settings.speed);
  const startedAt = Date.now();
  save.activeBake = { breadId: def.id, toppingIds, seed, roughness, startedAt, durationMs, layout };
  await persist();
  // 중간에 칼집을 내는 빵은 칼집을 낸 뒤에 끝나는 시각이 정해진다 (baking.ts)
  if (!def.midScore) void scheduleBakeDoneNotification(startedAt + durationMs, comboName(def, toppingIds));
  ctx.go('baking');
}

/** 이 조합에 토핑 올리기 화면이 필요한지 — 파이는 고른 토핑이 곧 필링이라, 토핑이 없으면 필링 없이 속이 빈 채로 굽는다(사용자 요청) */
export function needsPutting(def: BreadDef, toppingIds: readonly ToppingId[]): boolean {
  if (rollsIn(def)) return false;
  return placedToppings(toppingIds).length > 0;
}

interface ShapingData {
  breadId: BreadId;
  roughness: number;
  toppingIds?: ToppingId[];
  seed?: number;
  /** 붓는 빵: 칸마다 부은 양 — 그 높이 그대로 토핑을 올리고 굽는다 */
  layout?: DoughLayout;
}

export function mountShaping(root: HTMLElement, ctx: StageCtx, data?: unknown): () => void {
  const d = data as Partial<ShapingData> | undefined;
  if (!d?.breadId || !BREADS.some((b) => b.id === d.breadId)) {
    ctx.go('choose');
    return () => {};
  }
  const def = getBread(d.breadId);
  const roughness = d.roughness ?? 0.3;
  const toppingIds = d.toppingIds ?? [];
  const seed = d.seed ?? Math.random() * 100;
  // 트레이 빵은 토핑을 올린 뒤 트레이로 옮긴다. 파이는 토핑이 필링 — 올린 뒤 남은 반죽을 모아 격자를 얹는다
  const toTray = !usesVessel(def);
  const isPie = def.id === 'pie';
  const placed = placedToppings(toppingIds);
  // 파이는 처음엔 빈 크러스트다 — 고른 토핑을 올리면 그게 필링이 된다(토핑이 없으면 이 화면을 거치지 않는다)
  const chips: { id: string; emoji: string; name: string; filling?: boolean }[] = placed;

  const view = el(`
    <div class="shaping-view">
      <div class="stage-header">
        <button class="btn btn-ghost" data-back>←</button>
        <span class="stage-title">${isPie ? '필링 올리기' : '토핑 올리기'}</span>
        <span></span>
      </div>
      <div data-preview class="stage-slot"></div>
      <p class="hint" data-hint>${isPie ? '필링을 끌어다 틀에 깐 반죽 위에 올려주세요' : '토핑을 끌어다 반죽 위에 올려주세요'}</p>
      <div class="ingredient-tray" data-tray>
        ${chips.map((t) => `<button class="chip" data-chip="${t.id}"><span class="chip-emoji">${t.emoji}</span>${t.name}</button>`).join('')}
      </div>
      <button class="btn btn-primary btn-big" data-bake ${chips.length ? 'disabled' : ''}>${toTray ? '트레이에 옮기기 →' : isPie ? '격자 띠 만들기 →' : '오븐에 넣기 🔥'}</button>
    </div>
  `);
  root.appendChild(view);

  const sv = new StageView(stageOf(def), 0.56);
  view.querySelector('[data-preview]')!.replaceWith(sv.el);
  sv.el.classList.add('topping-preview');
  let scene: ToppingScene | null = null;
  const hint = view.querySelector<HTMLElement>('[data-hint]')!;
  const bakeBtn = view.querySelector<HTMLButtonElement>('[data-bake]')!;
  const tray = view.querySelector<HTMLElement>('[data-tray]')!;

  /** 지금까지 올린 토핑 */
  const put: ToppingId[] = [];
  /** 올린 칩 수 */
  let putCount = 0;
  /** 방금 올린 소가 반죽 속으로 들어가는 모션 — 1(위에 얹힘) → 0(속에 들어감) */
  let fillingReveal = 0;
  let sinkRaf = 0;

  function sinkFilling(): void {
    cancelAnimationFrame(sinkRaf);
    fillingReveal = 1;
    const t0 = performance.now();
    const step = (now: number) => {
      // 잠깐 얹혀 있다가(0.35초) 쏙 들어간다
      const t = (now - t0) / 1000;
      fillingReveal = t < 0.35 ? 1 : Math.max(0, 1 - ((t - 0.35) / 0.55) ** 2);
      scene?.setFillingReveal(fillingReveal);
      if (fillingReveal > 0) sinkRaf = requestAnimationFrame(step);
      else void hapticTick();
    };
    sinkRaf = requestAnimationFrame(step);
  }

  function paint(animate: boolean): void {
    scene?.setToppings(toppingIds, seed, { active: put, animate });
    scene?.setFillingReveal(fillingReveal);
  }

  for (const chip of view.querySelectorAll<HTMLButtonElement>('[data-chip]')) {
    bindPutChip(chip, () => {
      const t = chips.find((c) => c.id === chip.dataset.chip)!;
      chip.disabled = true;
      chip.classList.add('used');
      put.push(t.id as ToppingId);
      putCount++;
      if (t.filling && !isPie) sinkFilling();
      if (isPie) scene?.setFilled(true, true);
      paint(true);
      void hapticTick();
      if (putCount >= chips.length) {
        hint.textContent = isPie ? '필링을 듬뿍 채웠어요' : '토핑을 다 올렸어요';
        tray.classList.add('done');
        bakeBtn.disabled = false;
      }
    });
  }

  view.querySelector('[data-back]')!.addEventListener('click', () => {
    confirmSheet('처음 화면으로 갈까요? 반죽한 건 사라져요', () => ctx.go('title'));
  });

  bakeBtn.addEventListener('click', () => {
    if (toTray) ctx.go('mold', { breadId: def.id, roughness, toppingIds, seed });
    else if (isPie) ctx.go('forming', { breadId: def.id, roughness, phase: 'lattice', toppingIds, seed });
    else void startBake(ctx, def, toppingIds, seed, roughness, d.layout);
  });

  // 3D 무대 — 불러오면 토핑 장면을 만들고, 그 뒤로는 매 프레임 그린다
  let disposed = false;
  let raf = 0;
  let last = performance.now();
  void sv.load().then((st) => {
    if (disposed) return;
    scene = new ToppingScene(st, def, d.layout);
    if (isPie) scene.setFilled(putCount > 0);
    paint(false);
  });
  const frame = (now: number) => {
    if (disposed) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    sv.layout();
    scene?.update(dt);
    sv.render();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    sv.dispose();
    cancelAnimationFrame(sinkRaf);
  };
}
