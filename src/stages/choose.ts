// 빵 고르기 — 무엇을 구울지 먼저 정한다. 고른 빵에 따라 반죽 재료가 달라진다.
// 도감을 모을수록 고를 수 있는 빵이 늘어난다.
import type { StageCtx } from '../main';
import { el } from '../ui';
import { BREADS, bakeDurationMs, isBreadUnlocked } from '../content/breads';
import { ingredientsOf } from '../content/ingredients';
import { getSave } from '../state/save';
import { unlockCount } from '../state/album';
import { hapticTick } from '../native';
import { spriteUrl } from '../render/sprites';
import type { BreadDef, BreadId } from '../types';

export function mountChoose(root: HTMLElement, ctx: StageCtx): () => void {
  const save = getSave();
  const albumCount = unlockCount();
  const speed = save.settings.speed;

  /** 속도 설정과 ?fast=1 이 반영된 실제 굽기 시간 */
  const timeLabel = (def: BreadDef): string => {
    const sec = Math.round(bakeDurationMs(def, speed) / 1000);
    return sec < 90 ? `약 ${sec}초` : `약 ${Math.round(sec / 60)}분`;
  };

  const view = el(`
    <div class="choose-view">
      <div class="stage-header">
        <button class="btn btn-ghost" data-back>←</button>
        <span class="stage-title">무엇을 구울까요?</span>
        <span></span>
      </div>
      <div class="bread-cards">
        ${BREADS.map((b) => {
          const open = isBreadUnlocked(b, albumCount);
          return `
            <button class="bread-card${open ? '' : ' locked'}" data-bread="${b.id}" ${open ? '' : 'disabled'}>
              ${
                open
                  ? `<img class="bread-card-emoji" src="${spriteUrl(`bread/${b.id}_2`)}" alt="${b.emoji}" />`
                  : '<span class="bread-card-emoji">🔒</span>'
              }
              <span class="bread-card-name">${b.name}</span>
              <span class="bread-card-desc">${open ? b.desc : `도감 ${b.unlockAt}개를 모으면 열려요`}</span>
              <span class="bread-card-time">${
                open
                  ? `🕯 ${timeLabel(b)} · ${ingredientsOf(b)
                      .map((i) => i.emoji)
                      .join('')}`
                  : ''
              }</span>
            </button>`;
        }).join('')}
      </div>
      <button class="btn btn-primary btn-big" data-next disabled>토핑 고르러 가기</button>
    </div>
  `);
  root.appendChild(view);

  let selected: BreadId | null = null;
  const nextBtn = view.querySelector<HTMLButtonElement>('[data-next]')!;

  for (const card of view.querySelectorAll<HTMLButtonElement>('[data-bread]')) {
    card.addEventListener('click', () => {
      selected = card.dataset.bread as BreadId;
      for (const c of view.querySelectorAll('.bread-card')) c.classList.remove('selected');
      card.classList.add('selected');
      nextBtn.disabled = false;
      void hapticTick();
    });
  }

  // 아직 아무것도 시작하지 않았으니 묻지 않고 바로 홈으로
  view.querySelector('[data-back]')!.addEventListener('click', () => ctx.go('title'));
  nextBtn.addEventListener('click', () => {
    if (selected) ctx.go('pick', { breadId: selected });
  });

  return () => {};
}
