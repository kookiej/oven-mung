// 반죽 재료 카탈로그 — 빵마다 id만 나열하고 이모지·이름은 여기 한 곳에 둔다.
// 반죽 단계(볼에 넣는 칩)와 도감 상세(재료 목록)가 공유한다.
import type { BreadDef, IngredientId, ToppingDef } from '../types';

/**
 * 볼에 들어가는 방식 — 반죽 단계의 넣기 모션이 이걸로 갈린다.
 * powder: 솔솔 쏟아져 소복이 쌓임 / liquid: 줄기로 흘러 웅덩이 / egg: 깨서 톡 / solid: 덩어리가 툭 떨어짐
 * viscous: 가는 줄기로 천천히 흘러 똬리를 틀며 봉긋이 쌓이고, 아주 천천히 퍼진다 — 저어야 풀린다
 */
export type IngredientKind = 'powder' | 'liquid' | 'egg' | 'solid' | 'viscous';

/** 가루의 결 — 볼에 쌓인 더미의 질감과 흩어진 알갱이 (render/live/powder.ts) */
export type PowderGrain = 'flour' | 'sugar' | 'salt' | 'yeast';

export interface Ingredient {
  emoji: string;
  name: string;
  kind: IngredientKind;
  /** 볼 안에 쌓이거나 고인 모습의 색 */
  color: string;
  /** 볼 안에서 차지하는 양 (밀가루 = 1) */
  amount: number;
  /** 물·기름처럼 비쳐 보이는 액체 */
  clear?: boolean;
  /** 가루의 결 (powder만) */
  grain?: PowderGrain;
}

export const INGREDIENT: Record<IngredientId, Ingredient> = {
  flour: { emoji: '🌾', name: '밀가루', kind: 'powder', grain: 'flour', color: '#f4efe4', amount: 1 },
  breadFlour: { emoji: '🌾', name: '강력분', kind: 'powder', grain: 'flour', color: '#f2ecdf', amount: 1 },
  cakeFlour: { emoji: '🌾', name: '박력분', kind: 'powder', grain: 'flour', color: '#f8f4ec', amount: 1 },
  water: { emoji: '💧', name: '물', kind: 'liquid', color: '#cfe3ee', amount: 0.7, clear: true },
  coldWater: { emoji: '🧊', name: '찬물', kind: 'liquid', color: '#d6ecf5', amount: 0.6, clear: true },
  milk: { emoji: '🥛', name: '우유', kind: 'liquid', color: '#f7f4ec', amount: 0.7 },
  butter: { emoji: '🧈', name: '버터', kind: 'solid', color: '#f3d77a', amount: 0.4 },
  sugar: { emoji: '🍚', name: '설탕', kind: 'powder', grain: 'sugar', color: '#fbfaf5', amount: 0.45 },
  egg: { emoji: '🥚', name: '달걀', kind: 'egg', color: '#f2b632', amount: 0.5 },
  yeast: { emoji: '🫧', name: '이스트', kind: 'powder', grain: 'yeast', color: '#c9a46a', amount: 0.15 },
  salt: { emoji: '🧂', name: '소금', kind: 'powder', grain: 'salt', color: '#ffffff', amount: 0.12 },
  coarseSalt: { emoji: '🧂', name: '굵은소금', kind: 'powder', grain: 'salt', color: '#f4f4f0', amount: 0.15 },
  honey: { emoji: '🍯', name: '꿀', kind: 'viscous', color: '#e0a028', amount: 0.3 },
  oliveOil: { emoji: '🫒', name: '올리브유', kind: 'liquid', color: '#c9b84a', amount: 0.3, clear: true },
  bakingPowder: { emoji: '🥄', name: '베이킹파우더', kind: 'powder', grain: 'flour', color: '#fafafa', amount: 0.12 },
  vanilla: { emoji: '🌼', name: '바닐라', kind: 'liquid', color: '#5a3a1e', amount: 0.1 },
};

/** 볼에 넣는 가루 토핑(녹차·커피…)을 재료 칩으로 */
export function toppingIngredient(t: ToppingDef): Ingredient {
  return { emoji: t.emoji, name: t.name, kind: 'powder', grain: 'flour', color: t.tint?.color ?? t.color, amount: 0.16 };
}

export function ingredientsOf(def: BreadDef): Ingredient[] {
  return def.ingredients.map((id) => INGREDIENT[id]);
}
