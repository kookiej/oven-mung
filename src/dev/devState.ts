// 개발자 모드 상태 — 설정 시트의 토글로 켜고, 켜져 있으면 별도 테스트 저장 슬롯을 쓴다.
// 다른 모듈(content·state·util)이 import해도 순환이 생기지 않도록 Preferences 외엔 의존하지 않는다.
import { Preferences } from '@capacitor/preferences';

const KEY = 'oven-mung-dev';

export interface DevOptions {
  enabled: boolean;
  /** 도감 개수와 상관없이 모든 빵·토핑을 연다 — 개발자 모드에선 기본으로 켜져 있다 */
  unlockAll: boolean;
  /** 굽기 시간을 이 값으로 나눈다 (1 · 20 · 100) */
  timeDivisor: number;
  /** 반죽 화면에 '건너뛰기' 버튼 */
  skipKnead: boolean;
  /** 굽기 화면에 FPS 표시 */
  showFps: boolean;
}

function defaults(): DevOptions {
  return { enabled: false, unlockAll: true, timeDivisor: 1, skipKnead: true, showFps: false };
}

let cache: DevOptions = defaults();

export async function loadDev(): Promise<DevOptions> {
  try {
    const { value } = await Preferences.get({ key: KEY });
    if (value) cache = { ...defaults(), ...(JSON.parse(value) as Partial<DevOptions>) };
  } catch (e) {
    console.warn('dev options load failed', e);
    cache = defaults();
  }
  return cache;
}

export function dev(): DevOptions {
  return cache;
}

export function isDev(): boolean {
  return cache.enabled;
}

export async function persistDev(): Promise<void> {
  try {
    await Preferences.set({ key: KEY, value: JSON.stringify(cache) });
  } catch (e) {
    console.warn('dev options persist failed', e);
  }
}

/**
 * 굽기 시간 나눗수 — `?fast=1`(20)과 개발자 모드 배율 중 큰 쪽.
 * 개발자 모드가 꺼져 있으면 개발자 배율은 무시한다.
 */
export function timeDivisor(): number {
  const urlFast = new URLSearchParams(location.search).get('fast') === '1' ? 20 : 1;
  return Math.max(urlFast, cache.enabled ? cache.timeDivisor : 1);
}

/**
 * 개발자 모드를 켜고 끈다 — 저장 슬롯이 바뀌므로 앱을 다시 불러온다.
 * 실제 진행 기록(oven-mung-save-v1)은 켜져 있는 동안 건드리지 않는다.
 */
export async function switchDevMode(on: boolean): Promise<void> {
  cache.enabled = on;
  // 켤 때마다 모두 해금으로 시작한다 — 해금 사다리를 시험하려면 패널에서 끈다
  if (on) cache.unlockAll = true;
  await persistDev();
  location.reload();
}
