import './style.css';
import { audio } from './audio/engine';
import { loadSave, getSave } from './state/save';
import { mountTitle } from './stages/title';
import { mountChoose } from './stages/choose';
import { mountPick } from './stages/pick';
import { mountKneading } from './stages/kneading';
import { mountForming } from './stages/forming';
import { mountMold } from './stages/mold';
import { mountShaping } from './stages/shaping';
import { mountBaking } from './stages/baking';
import { mountFinish } from './stages/finish';
import { mountAlbum } from './stages/album';
import { mountShop } from './stages/shop';
import { isDev, loadDev } from './dev/devState';
import { mountDevTools } from './dev/devPanel';

export type StageName =
  | 'title'
  | 'choose'
  | 'pick'
  | 'kneading'
  | 'forming'
  | 'mold'
  | 'shaping'
  | 'baking'
  | 'finish'
  | 'album'
  | 'shop';

export interface StageCtx {
  go(name: StageName, data?: unknown): void;
  /** 지금 화면을 같은 데이터로 다시 그린다 — 개발자 모드에서 저장 데이터를 바꾼 뒤 */
  refresh(): void;
}

type StageMount = (root: HTMLElement, ctx: StageCtx, data?: unknown) => () => void;

const stages: Record<StageName, StageMount> = {
  title: mountTitle,
  choose: mountChoose,
  pick: mountPick,
  kneading: mountKneading,
  forming: mountForming,
  mold: mountMold,
  shaping: mountShaping,
  baking: mountBaking,
  finish: mountFinish,
  album: mountAlbum,
  shop: mountShop,
};

const root = document.querySelector<HTMLDivElement>('#app')!;
let cleanup: (() => void) | null = null;
let current: { name: StageName; data?: unknown } = { name: 'title' };
let navToken = 0;

const ctx: StageCtx = {
  go(name, data) {
    cleanup?.();
    cleanup = null;
    root.innerHTML = '';
    root.className = `stage-${name}`;
    current = { name, data };
    const token = ++navToken;
    const c = stages[name](root, ctx, data);
    // 마운트 도중 다른 스테이지로 보냈다면(데이터 없음 → choose 등) 그쪽이 이미 current와
    // cleanup을 차지했다 — 보낸 쪽의 빈 cleanup으로 덮어쓰면 리스너가 새어 나간다
    if (token === navToken) cleanup = c;
  },
  refresh() {
    ctx.go(current.name, current.data);
  },
};

async function boot(): Promise<void> {
  // 개발자 모드 여부가 저장 슬롯을 정하므로 반드시 먼저
  await loadDev();
  const save = await loadSave();
  if (isDev()) mountDevTools(ctx);
  audio.setVolumes(save.settings);

  // autoplay 정책: 첫 제스처에서 오디오 컨텍스트 생성
  const unlock = () => {
    audio.ensure();
    audio.setVolumes(getSave().settings);
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock);

  // 백그라운드 복귀 시 오디오 재개
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') audio.ensure();
  });

  // 굽던 빵이 있으면 바로 오븐 앞으로
  ctx.go(save.activeBake ? 'baking' : 'title');
}

void boot();
