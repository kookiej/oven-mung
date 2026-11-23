export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 결정적 시드 난수 (mulberry32) */
export function seededRandom(seed: number): () => number {
  let a = Math.floor(seed * 1e6) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToCss(rgb: [number, number, number]): string {
  return `rgb(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])})`;
}

export function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;
}

/** 두 hex 색을 섞어 hex로 */
export function mixHex(hexA: string, hexB: string, t: number): string {
  return rgbToHex(lerpColor(hexA, hexB, t));
}

export function lerpColor(hexA: string, hexB: string, t: number): [number, number, number] {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** 갈변 정도 0~1.6 → 빵 표면 색 (dough → gold → brown) */
export function breadSurfaceColor(
  dough: string,
  gold: string,
  brown: string,
  browning: number,
): [number, number, number] {
  if (browning < 0.6) {
    return lerpColor(dough, gold, smoothstep(0.05, 0.6, browning));
  }
  const c = lerpColor(gold, brown, smoothstep(0.6, 1.25, browning));
  // 1.25 이상은 더 어둡게 (탄 것 아님, 진하게 구운 것)
  const darken = smoothstep(1.25, 1.6, browning) * 0.35;
  return [c[0] * (1 - darken), c[1] * (1 - darken), c[2] * (1 - darken)];
}

export function browningLabel(b: number): string {
  if (b < 0.35) return '아직 반죽에 가까운';
  if (b < 0.65) return '살짝 구운';
  if (b < 1.05) return '노릇노릇한';
  if (b < 1.35) return '진하게 구운';
  return '아주 진하게 구운';
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
