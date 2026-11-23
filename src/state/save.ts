import { Preferences } from '@capacitor/preferences';
import { canonicalToppings } from '../content/toppings';
import { isDev } from '../dev/devState';
// album.ts도 이 모듈을 import하지만 서로 함수 안에서만 부르므로 순환 import가 안전하다
import { albumKey } from './album';
import type { ActiveBake, BakeRecord, SaveData, Settings, ToppingId } from '../types';

/** 실제 진행 기록. 개발자 모드에선 건드리지 않도록 테스트 슬롯을 따로 쓴다 */
const REAL_KEY = 'oven-mung-save-v1';
const DEV_KEY = 'oven-mung-save-dev';

/** loadDev() 이후에 불려야 한다 — 부팅 순서는 main.ts가 보장한다 */
function saveKey(): string {
  return isDev() ? DEV_KEY : REAL_KEY;
}

function defaultSettings(): Settings {
  return { volHum: 0.7, volCrackle: 0.8, volDing: 0.9, quality: 'auto', speed: 'normal' };
}

export function defaultSave(): SaveData {
  return {
    settings: defaultSettings(),
    album: [],
    activeBake: null,
    benchTier: null,
  };
}

let cache: SaveData = defaultSave();

/** 옛 저장본의 토핑 표현들을 현재의 표준형 배열로 */
type LegacyToppings = { toppingIds?: ToppingId[]; toppingId?: string };

function normalizeToppings(item: LegacyToppings): ToppingId[] {
  if (Array.isArray(item.toppingIds)) return canonicalToppings(item.toppingIds);
  // 토핑을 하나만 고르던 시절: 'none' 또는 토핑 id 하나
  if (item.toppingId && item.toppingId !== 'none') {
    return canonicalToppings([item.toppingId as ToppingId]);
  }
  return [];
}

/**
 * 옛 저장본을 현재 모양으로 맞춘다 — 토핑이 없거나 하나뿐이던 기록을 토핑 배열로 바꾸고,
 * 같은 조합이 여러 번 있으면 가장 최근 것만 남긴다. 키 형식이 예전과 같아서 이미 모은
 * 도감 칸은 그대로 이어진다. 기존 사용자의 도감을 버리지 않기 위한 처리.
 */
function normalizeAlbum(raw: unknown): BakeRecord[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, BakeRecord>();
  for (const item of raw as (Partial<BakeRecord> & LegacyToppings)[]) {
    if (!item || typeof item.breadId !== 'string') continue;
    const toppingIds = normalizeToppings(item);
    const id = albumKey(item.breadId, toppingIds);
    const rec: BakeRecord = {
      id,
      breadId: item.breadId,
      toppingIds,
      browning: item.browning ?? 0,
      seed: item.seed ?? 0,
      roughness: item.roughness ?? 0,
      finishedAt: item.finishedAt ?? 0,
      isNew: item.isNew ?? false,
    };
    const prev = byKey.get(id);
    if (!prev) {
      byKey.set(id, rec);
    } else if (rec.finishedAt >= prev.finishedAt) {
      // 한 번이라도 열어본 조합이면 새 항목 표시를 되살리지 않는다
      byKey.set(id, { ...rec, isNew: rec.isNew && prev.isNew });
    }
  }
  return [...byKey.values()];
}

function normalizeActiveBake(raw: ActiveBake & LegacyToppings): ActiveBake {
  const { toppingId: _legacy, ...rest } = raw;
  return { ...rest, toppingIds: normalizeToppings(raw) };
}

export async function loadSave(): Promise<SaveData> {
  try {
    const { value } = await Preferences.get({ key: saveKey() });
    if (value) {
      const parsed = JSON.parse(value) as Partial<SaveData>;
      cache = {
        ...defaultSave(),
        ...parsed,
        settings: { ...defaultSettings(), ...(parsed.settings ?? {}) },
        album: normalizeAlbum(parsed.album),
        activeBake: parsed.activeBake
          ? normalizeActiveBake(parsed.activeBake as ActiveBake & LegacyToppings)
          : null,
      };
    }
  } catch (e) {
    console.warn('save load failed, using defaults', e);
    cache = defaultSave();
  }
  return cache;
}

export function getSave(): SaveData {
  return cache;
}

/** 개발자 모드용 — 현재 슬롯에 원본을 그대로 써 넣는다. 다시 불러와야(loadSave) 반영된다 */
export async function writeRawSave(raw: unknown): Promise<void> {
  await Preferences.set({ key: saveKey(), value: JSON.stringify(raw) });
}

/** 개발자 모드용 — 현재 슬롯을 비운다 */
export async function clearSave(): Promise<void> {
  await Preferences.remove({ key: saveKey() });
}

export async function persist(): Promise<void> {
  try {
    await Preferences.set({ key: saveKey(), value: JSON.stringify(cache) });
  } catch (e) {
    console.warn('save persist failed', e);
  }
}
