// 도감 — 빵 × 토핑 조합을 중복 없이 모은다. 카드를 누르면 상세를 볼 수 있다.
import type { StageCtx } from '../main';
import { el } from '../ui';
import { getBread } from '../content/breads';
import { bakeTitle, getTopping } from '../content/toppings';
import { ingredientsOf } from '../content/ingredients';
import { markViewed, sortedAlbum } from '../state/album';
import { breadSpriteKeys, paintBread } from '../render/bread2d';
import { loadSprites } from '../render/sprites';
import { formatDate } from '../util';
import type { BakeRecord } from '../types';

/**
 * 캔버스를 dpr에 맞춰 키우고 빵을 그린다.
 * 표시 크기는 CSS가 정하고(width:100%; height:auto) 여기선 비율과 해상도만 잡는다.
 */
function paintRecord(canvas: HTMLCanvasElement, rec: BakeRecord, w: number, h: number): void {
  const dpr = Math.min(window.devicePixelRatio, 2);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const cctx = canvas.getContext('2d')!;
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cctx.clearRect(0, 0, w, h);
  paintBread(cctx, getBread(rec.breadId), rec.toppingIds, rec.browning, rec.seed, w, h);
}

/** 그림을 불러오기 전엔 2D 그림으로 먼저 그리고, 다 불러오면 Blender 그림으로 다시 그린다 */
function paintWhenReady(canvas: HTMLCanvasElement, rec: BakeRecord, w: number, h: number): void {
  paintRecord(canvas, rec, w, h);
  void loadSprites(breadSpriteKeys(rec.breadId)).then(() => {
    if (canvas.isConnected) paintRecord(canvas, rec, w, h);
  });
}

function openDetail(rec: BakeRecord, onViewed: () => void): void {
  const def = getBread(rec.breadId);
  // 이 빵의 반죽 재료 + 올린 토핑
  const ingredients = [...ingredientsOf(def), ...rec.toppingIds.map(getTopping)];

  const sheet = el(`
    <div class="sheet-backdrop">
      <div class="sheet">
        <div class="detail-canvas-wrap"><canvas data-canvas></canvas></div>
        <h2 class="detail-title">${bakeTitle(def, rec.toppingIds, rec.browning)}${def.emoji}</h2>
        <div class="detail-section">
          <h3>재료</h3>
          <div class="detail-ingredients">
            ${ingredients
              .map((i) => `<span class="detail-chip">${i.emoji} ${i.name}</span>`)
              .join('')}
          </div>
        </div>
        <p class="detail-date">${formatDate(rec.finishedAt)}에 구웠어요</p>
        <button class="btn btn-primary" data-close>닫기</button>
      </div>
    </div>
  `);

  const canvas = sheet.querySelector<HTMLCanvasElement>('[data-canvas]')!;
  document.body.appendChild(sheet);
  // 레이아웃이 잡힌 뒤에 실제 폭으로 그린다
  const wrap = canvas.parentElement!;
  paintWhenReady(canvas, rec, wrap.clientWidth || 300, 220);

  const close = () => sheet.remove();
  sheet.querySelector('[data-close]')!.addEventListener('click', close);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });

  if (rec.isNew) void markViewed(rec.id).then(onViewed);
}

export function mountAlbum(root: HTMLElement, ctx: StageCtx): () => void {
  const album = sortedAlbum();

  const view = el(`
    <div class="album-view">
      <div class="stage-header">
        <button class="btn btn-ghost" data-back>←</button>
        <span class="stage-title">도감</span>
        <span></span>
      </div>
      ${
        album.length === 0
          ? `<div class="album-empty">
               <p>🫙</p>
               <p>아직 구운 빵이 없어요.<br/>첫 빵을 구워볼까요?</p>
             </div>`
          : `<div class="album-grid" data-grid></div>`
      }
      <button class="btn btn-primary btn-big" data-bake>빵 구우러 가기</button>
    </div>
  `);
  root.appendChild(view);

  const grid = view.querySelector<HTMLElement>('[data-grid]');
  if (grid) {
    for (const rec of album) {
      const def = getBread(rec.breadId);
      const card = el<HTMLButtonElement>(`
        <button class="album-card">
          ${rec.isNew ? '<span class="album-new">NEW</span>' : ''}
          <canvas></canvas>
          <span class="album-card-name">${def.emoji} ${bakeTitle(def, rec.toppingIds, rec.browning)}</span>
        </button>
      `);
      paintWhenReady(card.querySelector('canvas')!, rec, 140, 120);
      card.addEventListener('click', () =>
        openDetail(rec, () => card.querySelector('.album-new')?.remove()),
      );
      grid.appendChild(card);
    }
  }

  view.querySelector('[data-back]')!.addEventListener('click', () => ctx.go('title'));
  view.querySelector('[data-bake]')!.addEventListener('click', () => ctx.go('choose'));

  return () => {};
}
