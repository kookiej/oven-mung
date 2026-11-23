// 도감 — 빵 × 토핑 조합 하나가 한 칸이다. 같은 조합을 다시 구우면 기존 칸을 갱신한다.
import { breadOrder } from '../content/breads';
import { canonicalToppings, toppingOrder } from '../content/toppings';
import { getSave, persist } from './save';
import { dev } from '../dev/devState';
import type { BakeRecord, BreadId, ToppingId } from '../types';

/**
 * `shokupan:none`, `cookie:choco`, `cookie:almond+choco`
 * 토핑이 하나뿐이거나 없던 시절의 키와 모양이 같아서 옛 도감이 그대로 이어진다.
 */
export function albumKey(breadId: BreadId, toppingIds: readonly ToppingId[]): string {
  const ids = canonicalToppings(toppingIds);
  return `${breadId}:${ids.length ? ids.join('+') : 'none'}`;
}

/** 종류별 정렬 — 빵 순서 → 토핑 개수 → 토핑 순서 */
export function sortedAlbum(): BakeRecord[] {
  return [...getSave().album].sort((a, b) => {
    const d = breadOrder(a.breadId) - breadOrder(b.breadId);
    if (d !== 0) return d;
    const n = a.toppingIds.length - b.toppingIds.length;
    if (n !== 0) return n;
    for (let i = 0; i < a.toppingIds.length; i++) {
      const t = toppingOrder(a.toppingIds[i]) - toppingOrder(b.toppingIds[i]);
      if (t !== 0) return t;
    }
    return 0;
  });
}

/**
 * 도감에 기록한다. 이미 있는 조합이면 최신 기록으로 덮어쓰되 `isNew`는 건드리지 않는다
 * — 이미 발견한 조합이 다시 '새것'이 되면 안 되기 때문.
 * @returns 새로 발견한 조합이면 true
 */
export async function upsertRecord(
  rec: Omit<BakeRecord, 'id' | 'isNew'>,
): Promise<boolean> {
  const album = getSave().album;
  const toppingIds = canonicalToppings(rec.toppingIds);
  const id = albumKey(rec.breadId, toppingIds);
  const existing = album.find((r) => r.id === id);
  if (existing) {
    existing.browning = rec.browning;
    existing.seed = rec.seed;
    existing.roughness = rec.roughness;
    existing.finishedAt = rec.finishedAt;
    await persist();
    return false;
  }
  album.push({ ...rec, toppingIds, id, isNew: true });
  await persist();
  return true;
}

/**
 * 해금 판정에 쓰는 도감 개수. 개발자 모드의 '모두 해금'이면 무한대.
 * 화면에 보여줄 실제 개수는 album.length를 그대로 쓸 것.
 */
export function unlockCount(): number {
  return dev().enabled && dev().unlockAll ? Infinity : getSave().album.length;
}

export function hasNew(): boolean {
  return getSave().album.some((r) => r.isNew);
}

/** 도감 상세를 열어봤다 — 새 항목 표시를 지운다 */
export async function markViewed(id: string): Promise<void> {
  const rec = getSave().album.find((r) => r.id === id);
  if (!rec || !rec.isNew) return;
  rec.isNew = false;
  await persist();
}
