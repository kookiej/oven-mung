// 상점 — 토핑 진열장. 화폐는 없고 도감을 모으면 저절로 열린다.
import type { StageCtx } from '../main';
import { el } from '../ui';
import {
  CATEGORIES,
  MAX_TOPPINGS,
  isToppingUnlocked,
  nextToppingUnlock,
  toppingsByUnlock,
} from '../content/toppings';
import { BREADS } from '../content/breads';
import { getSave } from '../state/save';
import { unlockCount } from '../state/album';

export function mountShop(root: HTMLElement, ctx: StageCtx): () => void {
  // 보여줄 개수는 실제 도감 수, 해금 판정은 unlockCount() (개발자 모드의 '모두 해금')
  const count = getSave().album.length;
  const unlocked = unlockCount();
  const next = nextToppingUnlock(unlocked);
  const lockedBread = BREADS.find((b) => b.unlockAt > unlocked);

  const progress = next
    ? `도감 ${count}개 · ${next.emoji} ${next.name}까지 ${next.unlockAt - count}개 남았어요`
    : `도감 ${count}개 · 토핑을 전부 모았어요 ✨`;

  const view = el(`
    <div class="shop-view">
      <div class="stage-header">
        <button class="btn btn-ghost" data-back>←</button>
        <span class="stage-title">상점</span>
        <span></span>
      </div>
      <p class="shop-progress">${progress}</p>
      <div class="shop-list">
        ${CATEGORIES.map((c) => {
          // 종류별로 묶고, 그 안에서는 해금되는 순서대로
          const list = toppingsByUnlock().filter((t) => t.category === c.id);
          const owned = list.filter((t) => isToppingUnlocked(t, unlocked)).length;
          return `
            <h3 class="shop-group">${c.name} <span>${owned}/${list.length}</span></h3>
            ${list
              .map((t) => {
                const open = isToppingUnlocked(t, unlocked);
                return `
                  <div class="topping-card${open ? '' : ' locked'}">
                    <span class="topping-emoji">${t.emoji}</span>
                    <span class="topping-name">${t.name}</span>
                    <span class="topping-desc">${t.desc}</span>
                    <span class="topping-state">${open ? '보유 중' : `🔒 도감 ${t.unlockAt}개부터`}</span>
                  </div>`;
              })
              .join('')}`;
        }).join('')}
      </div>
      <p class="shop-hint">
        토핑은 반죽을 마친 뒤 ${MAX_TOPPINGS}개까지 올릴 수 있어요${lockedBread ? `<br/>도감 ${lockedBread.unlockAt}개를 모으면 ${lockedBread.emoji} ${lockedBread.name}도 구울 수 있어요` : ''}
      </p>
      <button class="btn btn-primary btn-big" data-bake>빵 구우러 가기</button>
    </div>
  `);
  root.appendChild(view);

  view.querySelector('[data-back]')!.addEventListener('click', () => ctx.go('title'));
  view.querySelector('[data-bake]')!.addEventListener('click', () => ctx.go('choose'));

  return () => {};
}
