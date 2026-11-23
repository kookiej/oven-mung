export type BreadId =
  | 'shokupan'
  | 'cookie'
  | 'croissant'
  | 'pancake'
  | 'bagel'
  | 'flatbread'
  | 'baguette'
  | 'cupcake'
  | 'pretzel'
  | 'doughnut'
  | 'waffle'
  | 'pie'
  | 'cake';

/** 실제 토핑만. "토핑 없음"은 빈 배열로 표현한다 */
export type ToppingId =
  // 차·향신료 — 반죽을 물들인다
  | 'matcha'
  | 'blackTea'
  | 'coffee'
  | 'cinnamon'
  | 'ginger'
  | 'mintChoco'
  // 견과·앙금
  | 'almond'
  | 'chestnut'
  | 'redBean'
  | 'greenPea'
  // 채소·치즈
  | 'corn'
  | 'carrot'
  | 'pumpkin'
  | 'potato'
  | 'sweetPotato'
  | 'cheese'
  // 과일
  | 'apple'
  | 'pear'
  | 'banana'
  | 'cherry'
  | 'strawberry'
  | 'kiwi'
  | 'shineMuscat'
  | 'melon'
  | 'mango'
  | 'coconut'
  | 'orange'
  | 'lemon'
  | 'lime'
  | 'olive'
  | 'blueberry'
  // 달콤
  | 'choco'
  | 'sugar';

/** 토핑 고르기 탭·상점 묶음 */
export type ToppingCategory = 'flavor' | 'nut' | 'savory' | 'fruit' | 'sweet';

export type IngredientId =
  | 'flour'
  | 'breadFlour'
  | 'cakeFlour'
  | 'water'
  | 'coldWater'
  | 'milk'
  | 'butter'
  | 'sugar'
  | 'egg'
  | 'yeast'
  | 'salt'
  | 'coarseSalt'
  | 'honey'
  | 'oliveOil'
  | 'bakingPowder'
  | 'vanilla';

export type GeometryKind =
  | 'loaf'
  | 'panLoaf'
  | 'disc'
  | 'crescent'
  | 'ring'
  | 'cylinder'
  | 'cup'
  | 'square';

/** 무엇에 담아 굽는지 — 'tray' 말고는 반죽 다음에 틀에 넣는 단계(mold)를 거친다 */
export type VesselKind =
  | 'tray'
  | 'loafTin'
  | 'muffinTin'
  | 'doughnutPan'
  | 'waffleIron'
  | 'pieDish'
  | 'cakeTin'
  | 'fryingPan';

export interface BreadDef {
  id: BreadId;
  name: string;
  emoji: string;
  desc: string;
  /** 기본 굽기 시간(분). 속도 설정과 ?fast=1 이 곱해진다 */
  bakeMinutes: number;
  /** 오븐 스프링으로 커지는 비율 (0.35 = 35% 부풂) */
  spring: number;
  /** 크랙이 파이는 깊이 */
  crackDepth: number;
  geometry: GeometryKind;
  /** 굽는 그릇 — 틀·팬이면 오븐 속에서도 그 안에 담긴 채 구워진다 */
  vessel: VesselKind;
  /** 틀에 넣는 방식 — 'pour'(묽은 반죽을 붓기, 기본) / 'place'(반죽 덩어리를 담기) */
  fill?: 'pour' | 'place';
  /** 세로 두께 배율 (기본 1) — 같은 형태로 팬케이크처럼 얇거나 파이처럼 두꺼운 빵을 만든다 */
  thickness?: number;
  /** 덜 익었을 때 오븐에서 칼집을 내고 나머지를 굽는 빵 (팬케이크의 십자 칼집) */
  midScore?: boolean;
  /** 표면 무늬 — 'grid'면 와플 격자. 3D 셰이더와 2D 드로잉 양쪽에 구현되어 있다 */
  pattern?: 'grid';
  doughColor: string;
  goldColor: string;
  brownColor: string;
  crumbColor: string;
  /** 반죽 단계에서 볼에 넣는 재료 */
  ingredients: IngredientId[];
  /** 이 개수 이상 도감을 모으면 해금된다 */
  unlockAt: number;
}

export interface ToppingDef {
  id: ToppingId;
  name: string;
  emoji: string;
  desc: string;
  category: ToppingCategory;
  /** 알갱이 색 — 3D 셰이더와 2D 드로잉이 공유한다 */
  color: string;
  /** 표면 알갱이 밀도 0~1. 가루처럼 반죽에 섞이기만 하는 재료는 0 */
  density: number;
  /** 알갱이 크기 배율 (기본 1) */
  size?: number;
  /** 반죽에 섞여 빵 전체를 물들이는 색 — tintedBread()가 3D·2D 공용으로 적용한다 */
  tint?: { color: string; amount: number };
  /**
   * 앙금처럼 반죽 속에 넣는 소(filling) — 겉에는 알갱이가 없고(toppingSlots에서 빈 슬롯),
   * 자른 단면(drawCrumbFace)과 토핑 올리기 화면에서만 보인다
   */
  filling?: boolean;
  /** 이 개수 이상 도감을 모으면 해금된다 */
  unlockAt: number;
}

export interface ActiveBake {
  breadId: BreadId;
  /** canonicalToppings()를 거친 정렬된 목록 (최대 2개, 없으면 빈 배열) */
  toppingIds: ToppingId[];
  seed: number;
  /** 반죽 거칠기 0(매끈)~1(거침). 반죽을 덜 할수록 거칠다 */
  roughness: number;
  startedAt: number;
  durationMs: number;
  /** 반죽이 그릇에 놓인 모습 — 오븐이 그 반죽 그대로에서 굽기 시작한다 (없으면 기본 자리) */
  layout?: DoughLayout;
  /** 굽는 중간에 칼집을 냈는지 (midScore 빵) — 내기 전까지는 SCORE_AT에서 기다린다 */
  scored?: boolean;
}

/** 틀에 넣기 단계에서 정해진 반죽의 자리 */
export interface DoughLayout {
  /** 붓는 빵: 칸마다 부은 양 0~1 */
  fills?: number[];
  /** 트레이 빵: 조각마다 트레이 위 자리 [x, z] (트레이 가운데 기준, 미터) */
  placed?: [number, number][];
}

export interface BakeRecord {
  /** albumKey() — 빵 × 토핑 조합이 곧 도감의 한 칸이라 중복이 생기지 않는다 */
  id: string;
  breadId: BreadId;
  /** canonicalToppings()를 거친 정렬된 목록 */
  toppingIds: ToppingId[];
  /** 최종 갈변 정도 0~1.6 (1 초과 = 진하게 구움) */
  browning: number;
  seed: number;
  roughness: number;
  finishedAt: number;
  /** 아직 도감 상세를 열어보지 않은 항목 */
  isNew: boolean;
}

export type Quality = 'low' | 'mid' | 'high';

export type Speed = 'slow' | 'normal' | 'fast';

export interface Settings {
  volHum: number;
  volCrackle: number;
  volDing: number;
  quality: 'auto' | Quality;
  speed: Speed;
}

export interface SaveData {
  settings: Settings;
  album: BakeRecord[];
  activeBake: ActiveBake | null;
  /** 자동 벤치마크가 정한 품질 티어 */
  benchTier: Quality | null;
}
