import type { StageCtx } from '../main';
import { el, openSettingsSheet } from '../ui';
import { getSave } from '../state/save';
import { hasNew } from '../state/album';
import { isDev, timeDivisor } from '../dev/devState';

export function mountTitle(root: HTMLElement, ctx: StageCtx): () => void {
  const save = getSave();
  const baking = save.activeBake !== null;
  const view = el(`
    <div class="title-view">
      <div class="title-hero">
        <div class="title-emoji">🍞</div>
        <h1>오븐 멍</h1>
        <p class="title-tag">굽는 걸 바라보기만 해도 좋아서</p>
        ${timeDivisor() > 1 ? `<p class="fast-badge">⚡ 빠른 굽기 ×1/${timeDivisor()}</p>` : ''}
        ${isDev() ? '<p class="dev-badge">🛠 개발자 모드 · 테스트 저장</p>' : ''}
      </div>
      <div class="title-buttons">
        ${baking ? '<button class="btn btn-primary btn-big" data-oven>오븐 앞으로 🔥</button>' : ''}
        <button class="btn ${baking ? '' : 'btn-primary btn-big'}" data-start>빵 구우러 가기</button>
        <button class="btn" data-album>
          <span class="label-dot">도감${hasNew() ? '<i class="new-dot"></i>' : ''}</span>
        </button>
        <button class="btn" data-shop>상점</button>
        <button class="btn" data-settings>설정</button>
      </div>
    </div>
  `);
  view.querySelector('[data-oven]')?.addEventListener('click', () => ctx.go('baking'));
  view.querySelector('[data-start]')!.addEventListener('click', () => ctx.go('choose'));
  view.querySelector('[data-album]')!.addEventListener('click', () => ctx.go('album'));
  view.querySelector('[data-shop]')!.addEventListener('click', () => ctx.go('shop'));
  view.querySelector('[data-settings]')!.addEventListener('click', () => openSettingsSheet());
  root.appendChild(view);
  return () => {};
}
