// 2D 빵 드로잉 — 토핑 올리기 미리보기, 꺼내기/자르기 화면, 도감에서 공용.
// 토핑·와플 격자 표현은 3D 셰이더(breadShader.ts)와 짝을 이룬다 — 한쪽만 고치면 오븐과 도감이 어긋난다.
import { ROLLED_PEEK, fillingsOf, getTopping, placedToppings, tintedBread, toppingSlots } from '../content/toppings';
import { rollsIn } from '../content/forming';
import type { BreadDef, GeometryKind, ToppingId } from '../types';
import { breadSurfaceColor, hexToRgb, rgbToCss, seededRandom, smoothstep } from '../util';
import { META, between, crossfade, polyEllipse, polyPath, ready, sprite, squareBox, type Box } from './sprites';

/** 자른 단면의 세로 크기 (화면 짧은 변 대비) */
const CRUMB_FACE_H: Record<GeometryKind, number> = {
  loaf: 0.27,
  panLoaf: 0.3,
  disc: 0.2,
  crescent: 0.27,
  ring: 0.2,
  cylinder: 0.3,
  cup: 0.28,
  square: 0.14,
};

export function crumbFaceHeight(def: BreadDef, s: number): number {
  // 얇은 빵은 단면도 얇게 — 그래도 너무 납작해지지 않도록 완만하게
  return s * CRUMB_FACE_H[def.geometry] * (0.6 + 0.4 * (def.thickness ?? 1));
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * 빵 실루엣 경로를 만든다. (w,h) 영역 중앙 기준.
 * 도넛·베이글은 가운데 구멍이 있어 fill/clip에 넘길 규칙을 돌려준다.
 */
function breadPath(
  ctx: CanvasRenderingContext2D,
  def: BreadDef,
  w: number,
  h: number,
): CanvasFillRule {
  const cx = w / 2;
  const cy = h / 2;
  const s = Math.min(w, h);
  const t = def.thickness ?? 1;
  ctx.beginPath();
  switch (def.geometry) {
    case 'loaf':
      ctx.ellipse(cx, cy + s * 0.05, s * 0.32, s * 0.24, 0, 0, Math.PI * 2);
      return 'nonzero';
    case 'panLoaf': {
      // 산형 식빵 — 식빵틀 모양 그대로인 네모난 몸통 위로 봉긋한 머리
      const l = cx - s * 0.32;
      const r = cx + s * 0.32;
      const b = cy + s * 0.2;
      const sideTop = cy - s * 0.02;
      const peak = cy - s * 0.27;
      const rr = s * 0.04;
      ctx.moveTo(l + rr, b);
      ctx.lineTo(r - rr, b);
      ctx.quadraticCurveTo(r, b, r, b - rr);
      ctx.lineTo(r, sideTop);
      ctx.bezierCurveTo(r, peak, l, peak, l, sideTop);
      ctx.lineTo(l, b - rr);
      ctx.quadraticCurveTo(l, b, l + rr, b);
      ctx.closePath();
      return 'nonzero';
    }
    case 'disc':
      // 비스듬히 내려다본 원판이라 두께는 완만하게만 반영
      ctx.ellipse(cx, cy + s * 0.08, s * 0.34, s * 0.2 * (0.7 + 0.3 * t), 0, 0, Math.PI * 2);
      return 'nonzero';
    case 'crescent': {
      // 초승달: 등이 위로 볼록하고 양끝(뿔)이 아래로 향한 크루아상 모양
      const r = s * 0.3;
      ctx.arc(cx, cy, r, -Math.PI * 0.15, -Math.PI * 0.85, true);
      ctx.arc(cx, cy + r * 0.55, r * 0.72, -Math.PI * 0.8, -Math.PI * 0.2, false);
      ctx.closePath();
      return 'nonzero';
    }
    case 'ring':
      ctx.ellipse(cx, cy + s * 0.06, s * 0.33, s * 0.21, 0, 0, Math.PI * 2);
      ctx.moveTo(cx + s * 0.1, cy + s * 0.05);
      ctx.ellipse(cx, cy + s * 0.05, s * 0.1, s * 0.055, 0, 0, Math.PI * 2);
      return 'evenodd';
    case 'cylinder':
      roundRect(ctx, cx - s * 0.33, cy - s * 0.14, s * 0.66, s * 0.36, s * 0.05);
      return 'nonzero';
    case 'cup':
      // 컵 위로 솟은 머핀 머리만 — 컵받침은 drawCupLiner가 따로 그린다
      ctx.ellipse(cx, cy + s * 0.04, s * 0.29, s * 0.23, 0, Math.PI, Math.PI * 2);
      ctx.closePath();
      return 'nonzero';
    case 'square':
      roundRect(ctx, cx - s * 0.31, cy - s * 0.2, s * 0.62, s * 0.44, s * 0.04);
      return 'nonzero';
  }
}

/** 컵케이크의 줄무늬 종이 컵받침 — 빵보다 먼저, 빵 clip 밖에서 그린다 */
function drawCupLiner(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const s = Math.min(w, h);
  const top = h / 2 + s * 0.03;
  const bottom = h / 2 + s * 0.27;
  const tw = s * 0.28;
  const bw = s * 0.2;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - tw, top);
  ctx.lineTo(cx + tw, top);
  ctx.lineTo(cx + bw, bottom);
  ctx.lineTo(cx - bw, bottom);
  ctx.closePath();
  ctx.fillStyle = '#d98a9c';
  ctx.fill();
  ctx.clip();
  // 주름
  ctx.strokeStyle = 'rgba(90, 30, 45, 0.28)';
  ctx.lineWidth = Math.max(1, s * 0.008);
  for (let i = -6; i <= 6; i++) {
    const f = i / 6;
    ctx.beginPath();
    ctx.moveTo(cx + f * tw, top);
    ctx.lineTo(cx + f * bw, bottom);
    ctx.stroke();
  }
  ctx.restore();
}

function scaleRgb(hex: string, f: number): [number, number, number] {
  const c = hexToRgb(hex);
  return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
}

/** 갈변에 따라 함께 진해지는 토핑 색 — 셰이더의 chipCol과 같은 규칙 */
function toppingColor(color: string, browning: number): string {
  const darken = smoothstep(0.5, 1.6, browning) * 0.35;
  const c = hexToRgb(color);
  return rgbToCss([c[0] * (1 - darken), c[1] * (1 - darken), c[2] * (1 - darken)]);
}

/** 알갱이를 흩뿌릴 타원 영역. s는 알갱이 크기의 기준 길이 */
export interface ToppingArea {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  s: number;
  /** 알갱이 밀도 배율 — 말거나 접어 빚은 빵은 토핑이 속으로 들어가 겉에는 조금만 보인다 */
  densityK?: number;
}

/**
 * 표면에 얹힌 토핑 알갱이. 영역 모양으로 clip된 상태에서 호출한다.
 * 슬롯마다 시드를 다르게 해 두 토핑의 알갱이가 섞여 흩어진다 — 셰이더의 float(i) * 17.0과 짝.
 * 빵 그림(drawBread)과 Blender 빵 그림(drawBreadSprite)이 같은 규칙을 쓴다.
 */
export function drawToppings(
  ctx: CanvasRenderingContext2D,
  toppingIds: readonly ToppingId[],
  browning: number,
  seed: number,
  area: ToppingArea,
): void {
  const { cx, cy, rx, ry, s } = area;
  ctx.save();
  toppingSlots(toppingIds, area.densityK).forEach((slot, i) => {
    if (slot.density <= 0) return;
    const rand = seededRandom(seed + 13 + i * 101);
    ctx.fillStyle = toppingColor(slot.color, browning);
    ctx.globalAlpha = 0.92;
    const count = Math.round(10 + slot.density * 26);
    for (let k = 0; k < count; k++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand());
      const x = cx + Math.cos(a) * rx * rr;
      const y = cy + Math.sin(a) * ry * rr;
      const r = s * (0.016 + rand() * 0.02) * slot.size;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.72 + rand() * 0.3), rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
}

/**
 * 와플 격자 — 칸 안은 그늘지고 칸 경계(살)는 더 진하게 구워진다.
 * 셰이더의 uGrid 분기와 짝 (한 변 5칸).
 */
function drawGrid(ctx: CanvasRenderingContext2D, def: BreadDef, browning: number, w: number, h: number): void {
  const s = Math.min(w, h);
  const x0 = w / 2 - s * 0.31;
  const y0 = h / 2 - s * 0.2;
  const gw = s * 0.62;
  const gh = s * 0.44;
  const n = 5;
  const ridgeW = gw * 0.08;

  // 칸 안의 그늘
  ctx.fillStyle = 'rgba(40, 20, 5, 0.16)';
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      ctx.fillRect(
        x0 + (gw / n) * i + ridgeW / 2,
        y0 + (gh / n) * j + ridgeW / 2,
        gw / n - ridgeW,
        gh / n - ridgeW,
      );
    }
  }
  // 더 진하게 구워진 살
  ctx.strokeStyle = rgbToCss(
    breadSurfaceColor(def.doughColor, def.goldColor, def.brownColor, Math.min(browning * 1.2, 1.6)),
  );
  ctx.lineWidth = ridgeW;
  ctx.beginPath();
  for (let i = 1; i < n; i++) {
    ctx.moveTo(x0 + (gw / n) * i, y0);
    ctx.lineTo(x0 + (gw / n) * i, y0 + gh);
    ctx.moveTo(x0, y0 + (gh / n) * i);
    ctx.lineTo(x0 + gw, y0 + (gh / n) * i);
  }
  ctx.stroke();
}

export function drawBread(
  ctx: CanvasRenderingContext2D,
  def: BreadDef,
  toppingIds: readonly ToppingId[],
  browning: number,
  seed: number,
  w: number,
  h: number,
): void {
  // 녹차·커피 같은 가루 재료로 물든 색 — 3D 셰이더도 같은 함수를 쓴다
  def = tintedBread(def, toppingIds);
  const rand = seededRandom(seed + 7);
  const surface = breadSurfaceColor(def.doughColor, def.goldColor, def.brownColor, browning);

  if (def.geometry === 'cup') drawCupLiner(ctx, w, h);

  ctx.save();
  const rule = breadPath(ctx, def, w, h);
  ctx.fillStyle = rgbToCss(surface);
  ctx.fill(rule);

  // 얼룩덜룩한 갈변 반점
  ctx.clip(rule);
  const darker = breadSurfaceColor(
    def.doughColor,
    def.goldColor,
    def.brownColor,
    Math.min(browning * 1.35 + 0.1, 1.6),
  );
  const s = Math.min(w, h);
  for (let i = 0; i < 14; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = s * (0.03 + rand() * 0.08);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgbToCss(darker));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.25 + browning * 0.2;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (def.pattern === 'grid') drawGrid(ctx, def, browning, w, h);
  // 셰이더에서 윗면에 몰리는 것과 맞추기 위해 살짝 위로 끌어올린 영역
  drawToppings(ctx, toppingIds, browning, seed, {
    cx: w / 2,
    cy: h / 2 - s * 0.03,
    rx: s * 0.3,
    ry: s * 0.2,
    s,
  });

  // 위쪽 하이라이트
  ctx.globalAlpha = 0.18;
  const hl = ctx.createLinearGradient(0, h * 0.15, 0, h * 0.6);
  hl.addColorStop(0, '#fff2d8');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** 잘린 단면 (크럼) — 옅은 속살 + 기공, 섞여 들어간 토핑 */
export function drawCrumbFace(
  ctx: CanvasRenderingContext2D,
  def: BreadDef,
  toppingIds: readonly ToppingId[],
  browning: number,
  seed: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  def = tintedBread(def, toppingIds);
  const rand = seededRandom(seed + 31);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = def.crumbColor;
  ctx.fill();
  ctx.clip();

  // 기공
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand());
    const x = cx + Math.cos(a) * rx * 0.85 * rr;
    const y = cy + Math.sin(a) * ry * 0.85 * rr;
    const r = 2 + rand() * 4;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.6 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // 속까지 섞여 들어간 토핑
  for (const slot of toppingSlots(toppingIds)) {
    if (slot.density <= 0) continue;
    ctx.fillStyle = toppingColor(slot.color, browning);
    const count = Math.round(4 + slot.density * 8);
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand());
      const x = cx + Math.cos(a) * rx * 0.8 * rr;
      const y = cy + Math.sin(a) * ry * 0.8 * rr;
      const r = (3 + rand() * 4) * slot.size;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.6 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 속에 넣은 소 — 단면 가운데에 몽글하게. 둘이면 바깥·안쪽 두 겹
  fillingsOf(toppingIds).forEach((f, i) => {
    const k = i === 0 ? 1 : 0.55;
    const fx = rx * 0.55 * k;
    const fy = ry * 0.48 * k;
    const fcy = cy + ry * 0.06;
    const path = () => {
      ctx.beginPath();
      for (let j = 0; j <= 32; j++) {
        const a = (j / 32) * Math.PI * 2;
        const wob = 1 + 0.09 * Math.sin(a * 3 + seed + i) + 0.05 * Math.sin(a * 7 + seed * 2);
        const x = cx + Math.cos(a) * fx * wob;
        const y = fcy + Math.sin(a) * fy * wob;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    // 소에 닿은 속살은 살짝 물든다
    ctx.save();
    path();
    ctx.strokeStyle = f.color;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = Math.max(3, fx * 0.25);
    ctx.stroke();
    ctx.restore();
    path();
    ctx.fillStyle = f.color;
    ctx.fill();
    // 앙금 결 — 으깬 알갱이와 껍질 조각
    ctx.save();
    path();
    ctx.clip();
    for (let j = 0; j < 14; j++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand());
      const x = cx + Math.cos(a) * fx * rr;
      const y = fcy + Math.sin(a) * fy * rr;
      const r = 1 + rand() * 2.5;
      ctx.fillStyle = rand() < 0.5 ? rgbToCss(scaleRgb(f.color, 0.72)) : rgbToCss(scaleRgb(f.color, 1.15));
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.7, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
  ctx.restore();

  // 단면 테두리 (껍질)
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.lineWidth = 5;
  ctx.strokeStyle = rgbToCss(
    breadSurfaceColor(def.doughColor, def.goldColor, def.brownColor, 1.0),
  );
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- Blender 카툰 빵 그림
// 그릇에서 빼낸 빵을 굽기 정도 4단계(0 반죽 · 0.55 살짝 · 1 노릇 · 1.4 진하게)로 렌더해 두었다.
// 지금 갈변 정도를 사이에 둔 두 장을 겹치고, 녹차처럼 물들이는 재료는 빵 모양 그대로 색을 섞고,
// 토핑 알갱이는 빵 윗면(sprites.json의 bread.top)에만 흩뿌린 뒤 빵 모양으로 오려 낸다.

const BROWN_LEVELS = [0, 0.55, 1, 1.4];

/** 빵 그림의 이름 — 토핑 없는 파이는 필링 없이 속이 빈 그림(사용자 요청) */
function spriteIdOf(def: BreadDef, toppingIds: readonly ToppingId[]): string {
  return def.id === 'pie' && !placedToppings(toppingIds).length ? 'pie_empty' : def.id;
}

/** 미리 불러 둘 빵 그림 — 파이는 필링 없는 그림도 */
export function breadSpriteKeys(id: string): string[] {
  const keys = (sid: string) => BROWN_LEVELS.map((_, k) => `bread/${sid}_${k}`);
  return id === 'pie' ? [...keys(id), ...keys('pie_empty')] : keys(id);
}

export function breadSpriteBox(w: number, h: number): Box {
  return squareBox(w, h, 1, 0.5);
}

/** 빵 그림을 그린다. 그림을 아직 못 불러왔으면 false — 부르는 쪽이 2D 그림(drawBread)으로 대신한다 */
export function drawBreadSprite(
  ctx: CanvasRenderingContext2D,
  def: BreadDef,
  toppingIds: readonly ToppingId[],
  browning: number,
  seed: number,
  w: number,
  h: number,
  box: Box = breadSpriteBox(w, h),
): boolean {
  const byId = (sid: string) => BROWN_LEVELS.map((_, k) => `bread/${sid}_${k}`);
  let keys = byId(spriteIdOf(def, toppingIds));
  // 필링 없는 파이 그림이 아직 없으면 보통 그림으로
  if (!ready(sprite(keys[0]))) keys = byId(def.id);
  const s = between(BROWN_LEVELS, Math.min(browning, 1.4));
  const A = sprite(keys[s.i]);
  const B = sprite(keys[s.j]);
  if (!ready(A) || !ready(B)) return false;
  const dpr = ctx.getTransform().a || 1;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { c, g };
  };
  const bread = make();
  crossfade(
    (key, alpha) => {
      bread.g.globalAlpha = alpha;
      bread.g.drawImage(sprite(key), box.x, box.y, box.size, box.size);
    },
    keys[s.i],
    keys[s.j],
    s.t,
  );
  bread.g.globalAlpha = 1;
  // 반죽을 물들이는 재료 — 빵 모양 그대로 색을 섞는다 (tintedBread와 같은 재료·양)
  bread.g.globalCompositeOperation = 'source-atop';
  for (const id of toppingIds) {
    const t = getTopping(id).tint;
    if (!t) continue;
    bread.g.globalAlpha = t.amount * 0.5;
    bread.g.fillStyle = t.color;
    bread.g.fillRect(0, 0, w, h);
  }
  bread.g.globalAlpha = 1;
  bread.g.globalCompositeOperation = 'source-over';
  // 토핑 — 윗면에만, 빵 밖(초승달 안쪽·고리 구멍)으로 나가지 않게 빵 모양으로 오린다
  const top = META.bread[def.id]?.top;
  if (top && toppingSlots(toppingIds).some((t) => t.density > 0)) {
    const tp = make();
    tp.g.save();
    polyPath(tp.g, box, top);
    tp.g.clip();
    const e = polyEllipse(top);
    drawToppings(tp.g, toppingIds, browning, seed, {
      cx: box.x + e.cx * box.size,
      cy: box.y + e.cy * box.size,
      rx: e.rx * box.size * 0.95,
      ry: e.ry * box.size * 0.95,
      s: box.size * 0.8,
      densityK: rollsIn(def) ? ROLLED_PEEK : 1,
    });
    tp.g.restore();
    tp.g.globalCompositeOperation = 'destination-in';
    tp.g.drawImage(A, box.x, box.y, box.size, box.size);
    bread.g.drawImage(tp.c, 0, 0, w, h);
  }
  // 바닥에 지는 그림자 — 빵 그림은 그림자 없이 렌더돼 있다
  const bb = META.bbox[keys[2]] ?? [0.15, 0.2, 0.85, 0.8];
  ctx.save();
  const sx = box.x + ((bb[0] + bb[2]) / 2) * box.size;
  const sy = box.y + bb[3] * box.size;
  const rw = ((bb[2] - bb[0]) / 2) * box.size;
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rw);
  g.addColorStop(0, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(sx, sy - rw * 0.06, rw, rw * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.drawImage(bread.c, 0, 0, w, h);
  ctx.restore();
  return true;
}

/** 빵 그림 — Blender 그림이 준비됐으면 그것, 아니면 2D 그림 */
export function paintBread(
  ctx: CanvasRenderingContext2D,
  def: BreadDef,
  toppingIds: readonly ToppingId[],
  browning: number,
  seed: number,
  w: number,
  h: number,
): void {
  if (!drawBreadSprite(ctx, def, toppingIds, browning, seed, w, h)) drawBread(ctx, def, toppingIds, browning, seed, w, h);
}

/** 빵 그림 안에서 빵이 차지하는 세로 범위 (화면 픽셀) — 자른 단면을 놓을 자리 */
export function breadSpan(def: BreadDef, w: number, h: number): { top: number; bottom: number } | null {
  const bb = META.bbox[`bread/${def.id}_2`];
  if (!bb || !ready(sprite(`bread/${def.id}_2`))) return null;
  const b = breadSpriteBox(w, h);
  return { top: b.y + bb[1] * b.size, bottom: b.y + bb[3] * b.size };
}
