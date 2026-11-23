// Blender 카툰 에셋(renders/blender_cartoon/render_game.py)으로 만든 그림을 불러와 그리는 도구.
// 그림은 모두 정사각형·투명 배경이다. 단계 화면의 무대 그림(stage/*)은 실시간 3D 층(render/live)과 같은 카메라로
// 렌더돼 겹치면 맞물리고, 빵 그림(bread/*)은 빵 고르기·도감에서 그대로 쓴다.
// 그림 안의 자리(토핑을 얹을 윗면, 도구의 끝 따위)는 sprites.json에 그림 안의 비율 좌표(0~1)로,
// 그릇 안쪽 모양은 three.js 좌표(미터)로 들어 있다.
// 그림 파일은 public/assets/<key>.webp — Capacitor가 file://로 열므로 상대 경로로 부른다.
import raw from '../assets/sprites.json';

/** 그림 안의 비율 좌표 (왼쪽 위 0,0 → 오른쪽 아래 1,1) */
export type Pt = [number, number];
/** 벽 반지름 표 — [높이, 반지름] (three.js 미터, 바닥 → 위) */
export type Wall = [number, number][];

/** 반죽을 붓는 칸 하나 (three.js 좌표) */
export interface PourCell {
  kind: 'round' | 'ring' | 'square' | 'tart';
  /** 칸 가운데 [x, z] */
  center: [number, number];
  floorY: number;
  /** 가득 찼을 때의 높이 */
  fullY: number;
  wall?: Wall;
  /** 도넛틀 기둥 쪽 벽 */
  inner?: Wall;
  /** 와플 몰드 네모 칸의 반폭 */
  half?: number;
}

/** 무대마다의 그릇 정보 (three.js 좌표) — render_game.py의 STAGES */
export interface StageMeta {
  floorY?: number;
  rimY?: number;
  topY?: number;
  wall?: Wall;
  half?: [number, number];
  inner?: [number, number];
  above?: [number, number, number];
  spots?: [number, number, number][];
  cells?: PourCell[];
  /** 트레이 무대(mold_tray): 트레이 가운데 [x, z], 앞쪽 반죽 판의 윗면 높이·가운데·반폭 */
  center?: [number, number];
  boardTop?: number;
  boardCenter?: [number, number];
  boardHalf?: [number, number];
}

export interface SpriteMeta {
  stage: Record<string, StageMeta>;
  /** 도구 그림의 기준점 — 가운데·입구(lip)·끝(tip) */
  tool: Record<string, { center?: Pt; lip?: Pt; tip?: Pt }>;
  /** 빵 그림(갈변 2단계)에서 윗면 — 토핑을 흩뿌릴 영역 */
  bread: Record<string, { top: Pt[] }>;
  /** 그림마다 불투명한 영역 [x0, y0, x1, y1] */
  bbox: Record<string, [number, number, number, number]>;
}

/** 아직 렌더하지 않은 묶음이 있어도 화면이 멈추지 않게 빈 표로 채워 둔다 */
export const META: SpriteMeta = {
  stage: {},
  tool: {},
  bread: {},
  bbox: {},
  ...(raw as unknown as Partial<SpriteMeta>),
} as SpriteMeta;

const BASE = './assets/';

export function spriteUrl(key: string): string {
  return `${BASE}${key}.webp`;
}

const cache = new Map<string, HTMLImageElement>();

/** 그림 하나 — 처음 부르면 불러오기 시작한다. 다 불러오기 전에는 그려지지 않는다(ready로 확인) */
export function sprite(key: string): HTMLImageElement {
  let img = cache.get(key);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = spriteUrl(key);
    cache.set(key, img);
  }
  return img;
}

export function ready(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

/** 여러 그림을 미리 불러온다 — 실패해도 멈추지 않는다 */
export function loadSprites(keys: readonly string[]): Promise<void> {
  return Promise.all(
    keys.map((k) => {
      const img = sprite(k);
      if (ready(img)) return undefined;
      return new Promise<void>((res) => {
        img.addEventListener('load', () => res(), { once: true });
        img.addEventListener('error', () => res(), { once: true });
      });
    }),
  ).then(() => undefined);
}

/** 정사각형 그림을 놓을 자리 (캔버스 CSS 픽셀) */
export interface Box {
  x: number;
  y: number;
  size: number;
}

/** 캔버스 안에 정사각형 상자 — 가로 가운데, 세로는 cy 비율에 중심 */
export function squareBox(w: number, h: number, fit = 1, cy = 0.5): Box {
  const size = Math.min(w, h) * fit;
  return { x: (w - size) / 2, y: h * cy - size / 2, size };
}

export function at(b: Box, p: Pt): { x: number; y: number } {
  return { x: b.x + p[0] * b.size, y: b.y + p[1] * b.size };
}

export function drawSprite(ctx: CanvasRenderingContext2D, key: string, b: Box, alpha = 1): boolean {
  const img = sprite(key);
  if (!ready(img) || alpha <= 0) return ready(img);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.drawImage(img, b.x, b.y, b.size, b.size);
  ctx.restore();
  return true;
}

/** 그림 속 다각형 경로 */
export function polyPath(ctx: CanvasRenderingContext2D, b: Box, poly: readonly Pt[]): void {
  ctx.beginPath();
  poly.forEach((p, i) => {
    const q = at(b, p);
    if (i === 0) ctx.moveTo(q.x, q.y);
    else ctx.lineTo(q.x, q.y);
  });
  ctx.closePath();
}

/** 다각형을 감싸는 타원 (비율 좌표) */
export function polyEllipse(poly: readonly Pt[]): { cx: number; cy: number; rx: number; ry: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of poly) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2 };
}

export function inPoly(poly: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const tintCache = new Map<string, HTMLCanvasElement>();

/**
 * 색을 곱해 물들인 그림 — 볼 속 반죽처럼 여러 빵이 같이 쓰는 그림은 밝은 중립색으로 렌더돼 있고,
 * 여기서 빵의 반죽 색을 곱한다(명암은 그대로). 아직 안 불러왔으면 null
 */
export function tinted(key: string, color: string): HTMLCanvasElement | null {
  const id = `${key}|${color}`;
  const hit = tintCache.get(id);
  if (hit) return hit;
  const img = sprite(key);
  if (!ready(img)) return null;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  tintCache.set(id, c);
  return c;
}

/** 물들인 그림을 상자에 */
export function drawTinted(ctx: CanvasRenderingContext2D, key: string, color: string, b: Box, alpha = 1): void {
  const c = tinted(key, color);
  if (!c || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.drawImage(c, b.x, b.y, b.size, b.size);
  ctx.restore();
}

/**
 * 프레임 겹쳐 그리기 — 앞 프레임은 반을 넘어설 때까지 그대로 두고 뒤 프레임이 서서히 덮는다.
 * 둘 다 반투명해져 바닥이 비쳐 보이는 걸 막는다
 */
export function crossfade(draw: (key: string, alpha: number) => void, a: string, b: string, t: number): void {
  if (t <= 0.001 || a === b) {
    draw(a, 1);
    return;
  }
  if (t >= 0.999) {
    draw(b, 1);
    return;
  }
  draw(a, 1 - Math.max(0, (t - 0.5) * 2));
  draw(b, t);
}

/** 단계 값 v가 놓인 두 프레임과 그 사이 비율 — stops는 오름차순 */
export function between(stops: readonly number[], v: number): { i: number; j: number; t: number } {
  if (v <= stops[0]) return { i: 0, j: 0, t: 0 };
  for (let k = 0; k < stops.length - 1; k++) {
    if (v <= stops[k + 1]) return { i: k, j: k + 1, t: (v - stops[k]) / (stops[k + 1] - stops[k]) };
  }
  const n = stops.length - 1;
  return { i: n, j: n, t: 0 };
}
