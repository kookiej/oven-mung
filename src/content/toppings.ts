import type { BreadDef, ToppingCategory, ToppingDef, ToppingId } from '../types';
import { browningLabel, mixHex } from '../util';

/** 한 번에 올릴 수 있는 토핑 수 — 셰이더의 토핑 슬롯 수와 같아야 한다 */
export const MAX_TOPPINGS = 2;

/**
 * 이 배열 순서가 곧 제목에서 토핑 이름이 놓이는 순서다 ("녹차 팥앙금 식빵", "아몬드 초코칩 쿠키").
 * 차·향신료 → 견과·앙금 → 초코칩 → 채소·치즈 → 과일 → 슈가파우더. 탭 묶음은 category가,
 * 해금 순서는 unlockAt이 따로 정한다. 기존 5종(아몬드 < 초코칩 < 치즈 < 블루베리 < 슈가파우더)의
 * 상대 순서를 바꾸면 이미 모은 도감 이름이 바뀌니 유지할 것.
 */
export const TOPPINGS: ToppingDef[] = [
  {
    id: 'matcha',
    name: '녹차',
    emoji: '🍵',
    category: 'flavor',
    desc: '반죽이 은은한 연두빛으로 물들어요',
    color: '#5f7d3a',
    density: 0,
    tint: { color: '#8fae5c', amount: 0.55 },
    unlockAt: 16,
  },
  {
    id: 'blackTea',
    name: '홍차',
    emoji: '🫖',
    category: 'flavor',
    desc: '찻잎이 콕콕, 향긋한 갈색 반죽',
    color: '#3d2414',
    density: 0.22,
    size: 0.45,
    tint: { color: '#b07a4c', amount: 0.4 },
    unlockAt: 46,
  },
  {
    id: 'coffee',
    name: '커피',
    emoji: '☕',
    category: 'flavor',
    desc: '쌉싸름한 커피색으로 물들어요',
    color: '#3a2416',
    density: 0,
    tint: { color: '#7a5232', amount: 0.55 },
    unlockAt: 24,
  },
  {
    id: 'cinnamon',
    name: '시나몬',
    emoji: '🪵',
    category: 'flavor',
    desc: '따뜻한 향이 반죽 사이사이 배어요',
    color: '#6e3a1c',
    density: 0.25,
    size: 0.55,
    tint: { color: '#a8683a', amount: 0.3 },
    unlockAt: 34,
  },
  {
    id: 'ginger',
    name: '생강',
    emoji: '🫚',
    category: 'flavor',
    desc: '노르스름하게, 알싸한 향이 나요',
    color: '#c9a24e',
    density: 0,
    tint: { color: '#dcc077', amount: 0.3 },
    unlockAt: 62,
  },
  {
    id: 'mintChoco',
    name: '민트초코',
    emoji: '🌿',
    category: 'flavor',
    desc: '민트빛 반죽에 초코가 콕콕',
    color: '#3a2012',
    density: 0.45,
    tint: { color: '#9adbc1', amount: 0.6 },
    unlockAt: 68,
  },
  {
    id: 'almond',
    name: '아몬드',
    emoji: '🥜',
    category: 'nut',
    desc: '얇게 저민 조각이 노릇하게 같이 구워져요',
    color: '#c9a875',
    density: 0.45,
    unlockAt: 3,
  },
  {
    id: 'chestnut',
    name: '밤',
    emoji: '🌰',
    category: 'nut',
    desc: '포슬포슬한 밤 알갱이가 들어가요',
    color: '#b8894a',
    density: 0.4,
    size: 1.5,
    unlockAt: 22,
  },
  {
    id: 'redBean',
    name: '팥앙금',
    emoji: '🫘',
    category: 'nut',
    desc: '빵 속에 달콤한 팥앙금이 듬뿍 숨어요',
    color: '#5a2630',
    density: 0.42,
    size: 1.6,
    filling: true,
    unlockAt: 30,
  },
  {
    id: 'greenPea',
    name: '완두앙금',
    emoji: '🫛',
    category: 'nut',
    desc: '빵 속에 연두빛 완두앙금이 몽글몽글',
    color: '#9cbf5a',
    density: 0.42,
    size: 1.6,
    filling: true,
    unlockAt: 50,
  },
  {
    id: 'choco',
    name: '초코칩',
    emoji: '🍫',
    category: 'sweet',
    desc: '구워지면서 가장자리가 살짝 녹아요',
    color: '#4a2412',
    density: 0.55,
    unlockAt: 0,
  },
  {
    id: 'corn',
    name: '옥수수',
    emoji: '🌽',
    category: 'savory',
    desc: '톡톡 터지는 노란 옥수수알',
    color: '#f2c84b',
    density: 0.5,
    size: 0.8,
    unlockAt: 18,
  },
  {
    id: 'carrot',
    name: '당근',
    emoji: '🥕',
    category: 'savory',
    desc: '잘게 썬 당근이 주황빛으로 콕콕',
    color: '#e8792b',
    density: 0.42,
    size: 0.8,
    unlockAt: 58,
  },
  {
    id: 'pumpkin',
    name: '단호박',
    emoji: '🎃',
    category: 'savory',
    desc: '달큰한 단호박 조각이 노랗게',
    color: '#e9a23b',
    density: 0.42,
    size: 1.3,
    unlockAt: 36,
  },
  {
    id: 'potato',
    name: '감자',
    emoji: '🥔',
    category: 'savory',
    desc: '포근포근한 감자가 들어가요',
    color: '#e6cf8f',
    density: 0.42,
    size: 1.4,
    unlockAt: 48,
  },
  {
    id: 'sweetPotato',
    name: '고구마',
    emoji: '🍠',
    category: 'savory',
    desc: '꿀 같은 고구마가 숨어 있어요',
    color: '#e3a64a',
    density: 0.42,
    size: 1.4,
    unlockAt: 28,
  },
  {
    id: 'cheese',
    name: '치즈',
    emoji: '🧀',
    category: 'savory',
    desc: '녹아서 노랗게 번지는 걸 보는 재미',
    color: '#e8b445',
    density: 0.6,
    unlockAt: 6,
  },
  {
    id: 'apple',
    name: '사과',
    emoji: '🍎',
    category: 'fruit',
    desc: '아삭한 사과가 말랑하게 익어요',
    color: '#e8c27a',
    density: 0.42,
    size: 1.3,
    unlockAt: 26,
  },
  {
    id: 'pear',
    name: '배',
    emoji: '🍐',
    category: 'fruit',
    desc: '시원하고 달콤한 배 조각',
    color: '#efe2a8',
    density: 0.4,
    size: 1.3,
    unlockAt: 56,
  },
  {
    id: 'banana',
    name: '바나나',
    emoji: '🍌',
    category: 'fruit',
    desc: '익으면서 달콤한 향이 진해져요',
    color: '#f3e08a',
    density: 0.45,
    size: 1.3,
    unlockAt: 20,
  },
  {
    id: 'cherry',
    name: '체리',
    emoji: '🍒',
    category: 'fruit',
    desc: '새빨간 체리가 반짝',
    color: '#8e1b2c',
    density: 0.38,
    size: 1.1,
    unlockAt: 32,
  },
  {
    id: 'strawberry',
    name: '딸기',
    emoji: '🍓',
    category: 'fruit',
    desc: '상큼한 딸기가 붉게 물들어요',
    color: '#d8344a',
    density: 0.42,
    size: 1.2,
    unlockAt: 14,
  },
  {
    id: 'kiwi',
    name: '키위',
    emoji: '🥝',
    category: 'fruit',
    desc: '초록 키위가 새콤하게',
    color: '#7fae3a',
    density: 0.42,
    size: 1.2,
    unlockAt: 44,
  },
  {
    id: 'shineMuscat',
    name: '샤인머스캣',
    emoji: '🍇',
    category: 'fruit',
    desc: '연둣빛 포도알이 탱글탱글',
    color: '#b7d66a',
    density: 0.4,
    size: 1.3,
    unlockAt: 64,
  },
  {
    id: 'melon',
    name: '멜론',
    emoji: '🍈',
    category: 'fruit',
    desc: '향긋한 멜론이 사르르',
    color: '#b9dc8a',
    density: 0.42,
    size: 1.3,
    unlockAt: 60,
  },
  {
    id: 'mango',
    name: '망고',
    emoji: '🥭',
    category: 'fruit',
    desc: '진한 망고가 노랗게 익어요',
    color: '#f2a93b',
    density: 0.42,
    size: 1.3,
    unlockAt: 38,
  },
  {
    id: 'coconut',
    name: '코코넛',
    emoji: '🥥',
    category: 'fruit',
    desc: '하얀 코코넛 채가 바삭해져요',
    color: '#f4efe4',
    density: 0.55,
    size: 0.7,
    unlockAt: 40,
  },
  {
    id: 'orange',
    name: '오렌지',
    emoji: '🍊',
    category: 'fruit',
    desc: '오렌지 껍질이 상큼하게',
    color: '#f28c28',
    density: 0.38,
    unlockAt: 52,
  },
  {
    id: 'lemon',
    name: '레몬',
    emoji: '🍋',
    category: 'fruit',
    desc: '레몬 제스트가 산뜻하게',
    color: '#f2d83b',
    density: 0.32,
    size: 0.8,
    unlockAt: 42,
  },
  {
    id: 'lime',
    name: '라임',
    emoji: '🍋‍🟩',
    category: 'fruit',
    desc: '라임 향이 톡 쏘아요',
    color: '#8cc63f',
    density: 0.32,
    size: 0.8,
    unlockAt: 66,
  },
  {
    id: 'olive',
    name: '올리브',
    emoji: '🫒',
    category: 'fruit',
    desc: '짭조름한 올리브가 송송',
    color: '#4a5a2a',
    density: 0.38,
    size: 1.1,
    unlockAt: 54,
  },
  {
    id: 'blueberry',
    name: '블루베리',
    emoji: '🫐',
    category: 'fruit',
    desc: '톡톡 박힌 알맹이가 진하게 물들어요',
    color: '#4a3a72',
    density: 0.4,
    unlockAt: 9,
  },
  {
    id: 'sugar',
    name: '슈가파우더',
    emoji: '✨',
    category: 'sweet',
    desc: '하얗게 덮였다가 천천히 스며들어요',
    color: '#fbf3e4',
    density: 0.7,
    unlockAt: 12,
  },
];

/** 토핑 고르기 탭·상점 묶음 순서 */
export const CATEGORIES: { id: ToppingCategory; name: string }[] = [
  { id: 'flavor', name: '차·향신료' },
  { id: 'nut', name: '견과·앙금' },
  { id: 'savory', name: '채소·치즈' },
  { id: 'fruit', name: '과일' },
  { id: 'sweet', name: '달콤' },
];

export function getTopping(id: ToppingId): ToppingDef {
  const def = TOPPINGS.find((t) => t.id === id);
  if (!def) throw new Error(`unknown topping: ${id}`);
  return def;
}

/** 정렬용 — TOPPINGS 배열 순서 */
export function toppingOrder(id: ToppingId): number {
  const i = TOPPINGS.findIndex((t) => t.id === id);
  return i < 0 ? TOPPINGS.length : i;
}

/**
 * 토핑 목록의 표준형 — 중복 제거, TOPPINGS 순서로 정렬, 최대 개수로 자름.
 * 저장·도감 키·제목이 모두 이걸 거치므로 고른 순서와 상관없이 같은 조합은 같은 칸·같은 이름이 된다.
 */
export function canonicalToppings(ids: readonly ToppingId[]): ToppingId[] {
  return [...new Set(ids)]
    .filter((id) => TOPPINGS.some((t) => t.id === id))
    .sort((a, b) => toppingOrder(a) - toppingOrder(b))
    .slice(0, MAX_TOPPINGS);
}

/** "아몬드 초코칩 쿠키" / 토핑이 없으면 "쿠키" */
export function comboName(def: BreadDef, ids: readonly ToppingId[]): string {
  const names = canonicalToppings(ids).map((id) => getTopping(id).name);
  return [...names, def.name].join(' ');
}

/** "노릇노릇한 아몬드 초코칩 쿠키" — 도감·꺼내기 화면의 제목 */
export function bakeTitle(def: BreadDef, ids: readonly ToppingId[], browning: number): string {
  return `${browningLabel(browning)} ${comboName(def, ids)}`;
}

/** 반죽 단계에 볼에 넣는 가루 재료인지 — 차·향신료처럼 반죽을 물들이는 것 (슈가파우더는 구운 뒤에 뿌린다) */
export function isBowlTopping(t: ToppingDef): boolean {
  return !!t.tint;
}

/** 구운 뒤에 뿌리는 토핑인지 — 슈가파우더 */
export function isAfterBakeTopping(t: ToppingDef): boolean {
  return t.id === 'sugar';
}

/** 볼에 넣는 가루 재료 */
export function bowlToppings(ids: readonly ToppingId[]): ToppingDef[] {
  return canonicalToppings(ids).map(getTopping).filter(isBowlTopping);
}

/** 반죽 위에 올리는 토핑 — 볼에 넣는 가루와 구운 뒤에 뿌리는 것을 뺀 나머지(속에 넣는 소 포함) */
export function placedToppings(ids: readonly ToppingId[]): ToppingDef[] {
  return canonicalToppings(ids)
    .map(getTopping)
    .filter((t) => !isBowlTopping(t) && !isAfterBakeTopping(t));
}

/** 오븐에 들어가는 토핑 — 슈가파우더는 구운 뒤에 뿌리니 굽는 동안엔 없다 */
export function bakedToppingIds(ids: readonly ToppingId[]): ToppingId[] {
  return canonicalToppings(ids).filter((id) => !isAfterBakeTopping(getTopping(id)));
}

/** 슈가파우더를 뿌리는 조합인지 */
export function hasDusting(ids: readonly ToppingId[]): boolean {
  return canonicalToppings(ids).some((id) => isAfterBakeTopping(getTopping(id)));
}

/** 말거나 접어 빚는 빵은 토핑이 속으로 들어간다 — 겉에는 저절로 드러나지 않는다(사용자 요청: 겉에 토핑을 저절로 올리지 않는다). 자른 면에만 보인다 */
export const ROLLED_PEEK = 0;

export interface ToppingSlot {
  color: string;
  density: number;
  /** 알갱이 크기 배율 */
  size: number;
}

/** 겉에 알갱이로 얹히는 토핑인지 — 가루 재료(밀도 0)와 속에 넣는 소(filling)는 아니다 */
function onSurface(t: ToppingDef): boolean {
  return t.density > 0 && !t.filling;
}

/**
 * 렌더러에 넘길 토핑 슬롯 — 항상 MAX_TOPPINGS 길이, 빈 슬롯은 밀도 0.
 * 알갱이 토핑이 두 개면 빵이 덮이지 않도록 각각 옅게 한다(물들이기만 하는 가루 재료는 세지 않는다).
 * 가루 재료와 속에 넣는 소(filling)의 슬롯은 밀도 0인 빈 슬롯이 된다 — 색은 tintedBread()가,
 * 소는 fillingsOf()로 단면 그림이 맡는다.
 * 3D 셰이더와 2D 드로잉이 모두 이 함수를 쓰므로 규칙은 여기 한 곳에만 둔다.
 */
export function toppingSlots(ids: readonly ToppingId[], densityK = 1): ToppingSlot[] {
  const list = canonicalToppings(ids).map(getTopping);
  const chunky = list.filter(onSurface).length;
  const factor = chunky > 1 ? 0.7 : 1;
  return Array.from({ length: MAX_TOPPINGS }, (_, i) => {
    const t = list[i];
    // 반죽에 섞는 가루(홍차·시나몬·민트초코…)는 반죽 색만 물들인다 — 겉에 알갱이를 저절로 뿌리지 않는다(사용자 요청)
    return t && onSurface(t) && !isBowlTopping(t)
      ? { color: t.color, density: t.density * factor * (isAfterBakeTopping(t) ? 1 : densityK), size: t.size ?? 1 }
      : { color: '#000000', density: 0, size: 1 };
  });
}

/** 반죽 속에 넣는 소 — 앙금처럼 겉에는 안 보이고 자르면 보인다 */
export function fillingsOf(ids: readonly ToppingId[]): ToppingDef[] {
  return canonicalToppings(ids)
    .map(getTopping)
    .filter((t) => t.filling);
}

/**
 * 녹차·커피처럼 반죽에 섞이는 재료로 물든 빵 — 3D 셰이더 색과 2D 드로잉 색이 모두 여기서 나온다.
 * 반죽·속살은 tint만큼, 노릇한 색·진한 색은 그보다 약하게 섞어 구워지는 색 변화는 살린다.
 */
export function tintedBread(def: BreadDef, ids: readonly ToppingId[]): BreadDef {
  let out = def;
  for (const t of canonicalToppings(ids).map(getTopping)) {
    if (!t.tint) continue;
    const { color, amount: a } = t.tint;
    out = {
      ...out,
      doughColor: mixHex(out.doughColor, color, a),
      crumbColor: mixHex(out.crumbColor, color, a),
      goldColor: mixHex(out.goldColor, color, a * 0.55),
      brownColor: mixHex(out.brownColor, color, a * 0.3),
    };
  }
  return out;
}

export function isToppingUnlocked(def: ToppingDef, albumCount: number): boolean {
  return albumCount >= def.unlockAt;
}

export function toppingsIn(category: ToppingCategory): ToppingDef[] {
  return TOPPINGS.filter((t) => t.category === category);
}

/** 해금되는 순서대로 — 상점 진열 순서 */
export function toppingsByUnlock(): ToppingDef[] {
  return [...TOPPINGS].sort((a, b) => a.unlockAt - b.unlockAt);
}

/** 다음으로 해금될 토핑 (모두 열렸으면 null) */
export function nextToppingUnlock(albumCount: number): ToppingDef | null {
  return toppingsByUnlock().find((t) => t.unlockAt > albumCount) ?? null;
}
