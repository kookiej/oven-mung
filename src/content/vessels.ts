// 굽는 그릇 — 트레이 말고는 반죽 다음에 틀에 넣는 단계(mold)를 거치고, 오븐 속에서도 그 안에서 구워진다.
// 트레이 빵도 같은 단계에서 빚은 반죽을 트레이에 올린다.
import type { BreadDef, VesselKind } from '../types';

export interface VesselDef {
  /** "식빵틀에 담기", "케이크틀에 붓기"의 앞부분 */
  name: string;
}

export const VESSELS: Record<VesselKind, VesselDef> = {
  tray: { name: '트레이' },
  loafTin: { name: '식빵틀' },
  muffinTin: { name: '머핀틀' },
  doughnutPan: { name: '도넛틀' },
  waffleIron: { name: '와플틀' },
  pieDish: { name: '파이 틀' },
  cakeTin: { name: '케이크틀' },
  fryingPan: { name: '프라이팬' },
};

export function usesVessel(def: BreadDef): boolean {
  return def.vessel !== 'tray';
}

/**
 * 묽은 반죽(batter)인지 — 틀에 붓는 빵. 반죽 단계에서 치대지 않고 거품기로 젓고,
 * 그림도 반죽 덩어리가 아니라 그릇에 고인 반죽(render/live)으로 그린다.
 */
export function isBatter(def: BreadDef): boolean {
  return usesVessel(def) && def.fill !== 'place';
}

/** "식빵틀에 담기" / "케이크틀에 붓기" / "트레이에 올리기" (파이는 담고·붓고·덮는다 — mold 단계가 안내) */
export function moldTitle(def: BreadDef): string {
  const verb = !usesVessel(def) ? '올리기' : def.fill === 'place' ? '담기' : '붓기';
  return `${VESSELS[def.vessel].name}에 ${verb}`;
}
