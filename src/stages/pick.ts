// 토핑 고르기 — 빵을 고른 다음, 반죽을 시작하기 전에 어떤 토핑을 쓸지 정한다(최대 2개).
// 고른 토핑은 종류에 따라 들어가는 때가 다르다: 차·향신료 같은 가루는 반죽 단계에 볼로, 나머지는 반죽 위에, 슈가파우더는 구운 뒤에.
// seed도 여기서 한 번만 뽑는다 — 이 화면의 미리보기와 토핑 자리, 오븐 속 빵이 같은 seed를 쓴다.
import type { StageCtx } from '../main';
import { el } from '../ui';
import { BREADS, getBread } from '../content/breads';
import {
  CATEGORIES,
  MAX_TOPPINGS,
  canonicalToppings,
  comboName,
  getTopping,
  isToppingUnlocked,
  toppingsIn,
} from '../content/toppings';
import { unlockCount } from '../state/album';
import { breadSpriteKeys, paintBread } from '../render/bread2d';
import { loadSprites } from '../render/sprites';
import { hapticTick } from '../native';
import type { BreadId, ToppingCategory, ToppingId } from '../types';

export function mountPick(root: HTMLElement, ctx: StageCtx, data?: unknown): () => void {
  const d = data as { breadId?: BreadId } | undefined;
  if (!d?.breadId || !BREADS.some((b) => b.id === d.breadId)) {
    ctx.go('choose');
    return () => {};
  }
  const def = getBread(d.breadId);
  const albumCount = unlockCount();
  const seed = Math.random() * 100;

  // 해금된 토핑이 하나라도 있는 종류만 탭으로
  const tabs = CATEGORIES.map((c) => ({
    ...c,
    toppings: toppingsIn(c.id).filter((t) => isToppingUnlocked(t, albumCount)),
  })).filter((c) => c.toppings.length > 0);

  const view = el(`
    <div class="shaping-view">
      <div class="stage-header">
        <button class="btn btn-ghost" data-back>←</button>
        <span class="stage-title">${def.emoji} 토핑 고르기</span>
        <span></span>
      </div>
      <canvas class="pick-canvas" data-canvas></canvas>
      <p class="topping-combo" data-combo></p>
      <div class="topping-picker">
        <p class="topping-label">토핑 <span class="topping-limit">최대 ${MAX_TOPPINGS}개</span></p>
        <div class="topping-tabs">
          ${tabs
            .map((c) => `<button class="topping-tab" data-tab="${c.id}">${c.name}<span class="tab-count" data-count="${c.id}"></span></button>`)
            .join('')}
        </div>
        <div class="topping-strip" data-strip></div>
      </div>
      <button class="btn btn-primary btn-big" data-next>반죽하러 가기</button>
    </div>
  `);
  root.appendChild(view);

  const canvas = view.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  const cctx = canvas.getContext('2d')!;
  const comboEl = view.querySelector<HTMLElement>('[data-combo]')!;
  const strip = view.querySelector<HTMLElement>('[data-strip]')!;

  let selected: ToppingId[] = [];
  let tab: ToppingCategory = tabs[0]?.id ?? 'sweet';

  function drawPreview(): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.clearRect(0, 0, w, h);
    paintBread(cctx, def, selected, 1, seed, w, h);
  }

  /** 지금 탭의 칩 한 줄 — ❌없음은 탭과 상관없이 맨 앞 */
  function renderStrip(): void {
    const list = tabs.find((c) => c.id === tab)?.toppings ?? [];
    strip.innerHTML = `
      <button class="topping-chip" data-none><span class="topping-chip-emoji">❌</span>없음</button>
      ${list
        .map(
          (t) => `
          <button class="topping-chip" data-topping="${t.id}">
            ${t.filling ? '<span class="topping-chip-badge">속</span>' : ''}
            <span class="topping-chip-emoji">${t.emoji}</span>${t.name}
          </button>`,
        )
        .join('')}`;
    strip.scrollLeft = 0;
  }

  function refresh(): void {
    selected = canonicalToppings(selected);
    const full = selected.length >= MAX_TOPPINGS;
    strip.querySelector('[data-none]')!.classList.toggle('selected', selected.length === 0);
    for (const chip of strip.querySelectorAll<HTMLButtonElement>('[data-topping]')) {
      const on = selected.includes(chip.dataset.topping as ToppingId);
      chip.classList.toggle('selected', on);
      // 2개가 찼으면 나머지는 흐리게 — 하나를 빼야 다른 걸 고를 수 있다
      chip.classList.toggle('dimmed', full && !on);
    }
    for (const t of view.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      t.classList.toggle('selected', t.dataset.tab === tab);
    }
    // 탭마다 그 종류에서 고른 개수
    for (const c of tabs) {
      const n = selected.filter((id) => getTopping(id).category === c.id).length;
      view.querySelector(`[data-count="${c.id}"]`)!.textContent = n ? ` ${n}` : '';
    }
    comboEl.textContent = comboName(def, selected);
    drawPreview();
  }

  for (const t of view.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    t.addEventListener('click', () => {
      tab = t.dataset.tab as ToppingCategory;
      renderStrip();
      refresh();
    });
  }

  // 칩은 탭마다 다시 그리므로 줄에 위임한다
  strip.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('.topping-chip');
    if (!chip) return;
    if (chip.hasAttribute('data-none')) selected = [];
    else {
      const id = chip.dataset.topping as ToppingId;
      if (selected.includes(id)) selected = selected.filter((t) => t !== id);
      else if (selected.length < MAX_TOPPINGS) selected = [...selected, id];
      else return;
    }
    refresh();
    void hapticTick();
  });

  // 아직 아무것도 시작하지 않았으니 묻지 않고 바로 홈으로
  view.querySelector('[data-back]')!.addEventListener('click', () => ctx.go('title'));
  view.querySelector('[data-next]')!.addEventListener('click', () => {
    ctx.go('kneading', { breadId: def.id, toppingIds: canonicalToppings(selected), seed });
  });

  renderStrip();
  // 레이아웃이 잡힌 뒤 첫 그림
  requestAnimationFrame(refresh);
  void loadSprites(breadSpriteKeys(def.id)).then(drawPreview);

  return () => {};
}
