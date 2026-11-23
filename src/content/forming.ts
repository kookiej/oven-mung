// 모양 빚기 — 반죽(dough)을 쓰는 빵만 거치는 단계. 빵마다 빚는 방법이 다르다.
// 각 단계는 몸짓 하나로 진행도(0~1)를 채우고, 그 진행도가 반죽 모양을 실시간으로 바꾼다
// (render/live/formShapes.ts — Blender 카툰 반죽 판 그림 위의 실시간 3D).
// 식빵·크루아상·베이글·바게트·프레첼은 밀어 편 반죽에 토핑을 올리고 그걸 말거나 접어 빚는다(사용자 요청) — 토핑이 속으로 들어간다.
// 배열의 순서가 곧 formShape의 단계 번호다. 올릴 토핑이 없으면 'toppings' 단계만 건너뛴다(번호는 그대로).
// 전략 없음: 어떻게 빚든 결과(구워지는 빵)는 같다. 칼집·띠 자리도 정해져 있다(칼선 — formShapes.ts의 cutLines).
import type { BreadDef, BreadId } from '../types';

/**
 * rub: 반죽 둘레로 빙글빙글 / roll: 한 축으로 왔다 갔다(밀대로 밀기·굴리기·말기) / press: 누르고 있기 /
 * tear: 큰 반죽을 잡아 당겨 떼어 내기 (count번) / pressEach: 작은 반죽을 하나씩 누르고 있기 /
 * rubEach: 작은 반죽을 하나씩 문질러 굴리기 /
 * cut: 빵칼로 칼선을 따라 긋기 — 칼날이 지나간 자리에만 금이 난다(칼선 수만큼) /
 * toppings: 고른 토핑을 칩으로 끌어다 반죽 위에 올리기
 */
export type FormGesture = 'rub' | 'roll' | 'press' | 'tear' | 'pressEach' | 'rubEach' | 'cut' | 'toppings';

/** 손가락을 따라다니는 도구 — 손으로 하는 몸짓(굴리기·누르기·말기)은 도구 없이 반죽만 움직인다 */
/** scraper = 스크레이퍼(도우 커터) — 반죽을 나눌 때 */
export type FormTool = 'pin' | 'knife' | 'scraper';

export interface FormStep {
  label: string;
  hint: string;
  gesture: FormGesture;
  tool?: FormTool;
  /** roll의 축 */
  axis?: 'x' | 'y';
  /** roll을 한 방향으로만 셀 때 (-1 = 위로 · 왼쪽으로) */
  dir?: 1 | -1;
  /** tear 횟수 */
  count?: number;
  /** 올릴 토핑(소)이 있을 때만 거치는 단계 */
  withToppings?: boolean;
}

/** 가로로 길게 늘이는 굴리기 — 줄과 직각으로, 위아래로 문지른다(사용자 요청) */
const ROPE: FormStep = {
  label: '일정한 굵기로 굴리기',
  hint: '위아래로 문질러 굴리면 일정한 굵기로 길게 늘어나요',
  gesture: 'roll',
  axis: 'y',
};

const PIN_OUT: FormStep = {
  label: '밀대로 밀어 펴기',
  hint: '위아래로 밀대를 밀어 세로로 길게 펴주세요',
  gesture: 'roll',
  axis: 'y',
  tool: 'pin',
};

const ROLL_UP: FormStep = {
  label: '돌돌 말기',
  hint: '아래에서 위로 쓸어 올려 돌돌 말아주세요',
  gesture: 'roll',
  axis: 'y',
  dir: -1,
};

const TOPPINGS: FormStep = {
  label: '토핑 올리기',
  hint: '토핑을 끌어다 반죽 위에 올려주세요',
  gesture: 'toppings',
};

export const FORMS: Partial<Record<BreadId, FormStep[]>> = {
  shokupan: [PIN_OUT, TOPPINGS, ROLL_UP],
  cookie: [
    { label: '조금씩 떼어 내기', hint: '볼 속 큰 반죽을 잡고 당기면 같은 크기로 하나씩 뜯겨 판 위에 줄지어 놓여요', gesture: 'tear', count: 6 },
    { label: '하나씩 눌러 펴기', hint: '작은 반죽을 하나씩 꾹 누르고 있으면 납작해져요', gesture: 'pressEach' },
  ],
  // 크루아상: 버터를 감싸 밀고 접기를 되풀이해 겹을 만든다(라미네이션) → 큰 직사각형 → 세모 → 말기(끝은 저절로 밑으로) → 초승달
  croissant: [
    PIN_OUT,
    { label: '버터 감싸기', hint: '위아래로 쓸어 차가운 버터를 반죽으로 편지처럼 감싸주세요', gesture: 'roll', axis: 'y' },
    { ...PIN_OUT, label: '길게 밀기', hint: '위아래로 밀대를 밀어 버터와 반죽을 함께 길게 펴주세요' },
    { label: '세 겹 접기', hint: '위아래로 쓸어 점선을 따라 세 겹으로 접어주세요 · 접을수록 겹이 늘어요', gesture: 'roll', axis: 'y' },
    { ...PIN_OUT, label: '다시 길게 밀기', hint: '위아래로 밀대를 밀어 다시 길게 펴주세요' },
    { label: '한 번 더 접기', hint: '위아래로 쓸어 한 번 더 세 겹으로 접어주세요', gesture: 'roll', axis: 'y' },
    // 큰 직사각형은 세로 먼저, 그다음 가로 — 한 번에 두 방향으로 늘이지 않는다(사용자 요청)
    { ...PIN_OUT, label: '세로로 길게 밀기', hint: '위아래로 밀대를 밀어 겹겹이 쌓인 반죽을 세로로 길게 펴주세요' },
    { ...PIN_OUT, label: '가로로 넓게 밀기', hint: '좌우로 밀대를 밀어 큰 직사각형이 되게 가로로 넓혀주세요', axis: 'x' },
    { label: '세로로 긴 세모 자르기', hint: '빵칼로 점선을 따라 그어 세로로 긴 세모를 잘라내 주세요', gesture: 'cut', tool: 'knife' },
    TOPPINGS,
    { ...ROLL_UP, label: '밑변에서 끝으로 말기', hint: '아래에서 위로 쓸어 넓은 밑변부터 말아주세요 · 뾰족한 끝은 저절로 밑으로 들어가요' },
    { label: '초승달로 구부리기', hint: '빙글빙글 돌려 양 끝을 앞으로 둥글게 구부려주세요', gesture: 'rub' },
  ],
  // 베이글: 밀어 펴 가로로 돌려 놓고 → 소·토핑 → 감싸며 말기 → 이음매·양 끝 꼬집기 → 일정한 굵기로 → 한쪽 끝 납작하게 →
  // 납작한 끝으로 다른 끝을 감싸 잇기 (사용자 요청)
  bagel: [
    { ...PIN_OUT, hint: '위아래로 밀대를 밀어 세로로 길게 펴주세요 · 다 펴면 가로로 돌려 놓아요' },
    TOPPINGS,
    { ...ROLL_UP, label: '감싸며 말기', hint: '아래에서 위로 쓸어 올려 토핑을 감싸며 돌돌 말아주세요' },
    { label: '이음매 꼬집어 붙이기', hint: '꾹 누르고 있으면 이음매와 양 끝을 꼬집어 붙여요', gesture: 'press' },
    ROPE,
    { label: '한쪽 끝 납작하게', hint: '꾹 누르고 있으면 오른쪽 끝이 넓적하게 눌려요', gesture: 'press' },
    { label: '양 끝 감싸 잇기', hint: '빙글빙글 돌려 둥글게 구부리고, 납작한 끝으로 다른 끝을 감싸 이어주세요', gesture: 'rub' },
  ],
  // 플랫브레드: 판에 놓고 → 스크레이퍼로 방사형으로 똑같이 나누고 → 하나씩 둥글리고 → (소가 있으면) 밀어 소를 올려 감싸고 → 하나씩 납작하게
  flatbread: [
    { label: '넷으로 나누기', hint: '스크레이퍼로 점선을 따라 그어 반죽을 똑같이 넷으로 나눠주세요', gesture: 'cut', tool: 'scraper' },
    { label: '하나씩 둥글리기', hint: '조각 위에서 빙글빙글 문질러 하나씩 동그랗게 굴려주세요', gesture: 'rubEach' },
    { ...PIN_OUT, label: '작게 밀어 펴기', hint: '위아래로 밀대를 밀어 소를 올릴 수 있게 펴주세요', withToppings: true },
    { ...TOPPINGS, label: '소 올리기', hint: '소를 끌어다 반죽 가운데에 올려주세요' },
    { label: '오므려 감싸기', hint: '하나씩 꾹 누르고 있으면 가장자리를 오므려 소를 감싸요', gesture: 'pressEach', withToppings: true },
    { label: '하나씩 눌러 펴기', hint: '하나씩 꾹 누르고 있으면 납작해져요', gesture: 'pressEach' },
  ],
  baguette: [
    PIN_OUT,
    TOPPINGS,
    { label: '세 겹으로 접기', hint: '위아래로 쓸어 점선을 따라 앞뒤를 편지처럼 가운데로 접어주세요', gesture: 'roll', axis: 'y' },
    { label: '반으로 접어 붙이기', hint: '아래에서 위로 쓸어 점선을 따라 반으로 접고 이음매를 붙여주세요', gesture: 'roll', axis: 'y', dir: -1 },
    { label: '길게 늘이기', hint: '위아래로 왔다 갔다 굴려 길게 늘여주세요', gesture: 'roll', axis: 'y' },
    { label: '양 끝 가늘게', hint: '위아래로 문질러 굴리면 양 끝이 뾰족해져요', gesture: 'roll', axis: 'y' },
    { label: '칼집 내기', hint: '빵칼로 점선을 따라 비스듬히 쓱 그어 칼집을 세 줄 내주세요', gesture: 'cut', tool: 'knife' },
  ],
  // 파이: 크게 밀어 틀에 깔고 → 가장자리를 잘라 내고 → 토핑을 필링으로 올리고 → 잘라 낸 반죽(이미 한 덩이)을 밀어 격자로 (PIE_LATTICE_STEPS)
  pie: [{ ...PIN_OUT, label: '크게 밀어 펴기', hint: '위아래로 밀대를 밀어 파이 틀을 덮을 만큼 크게 펴주세요' }],
  pretzel: [
    PIN_OUT,
    TOPPINGS,
    ROPE,
    { label: 'U자 만들기', hint: '빙글빙글 돌려 반죽을 U자로 구부려주세요', gesture: 'rub' },
    { label: '양 끝 두 번 꼬기', hint: '빙글빙글 돌려 양 끝을 엇갈리게 한 번, 또 한 번 꼬아주세요', gesture: 'rub' },
    { label: '꼬임을 아래로 접기', hint: '위에서 아래로 쓸어 꼬인 부분을 U자 아래쪽(5시·7시 자리)에 내려주세요', gesture: 'roll', axis: 'y', dir: 1 },
    { label: '눌러 붙이기', hint: '꾹 누르고 있으면 끝이 단단히 붙어요', gesture: 'press' },
  ],
};

/** 파이 격자 — 틀에서 잘라 낸 반죽(끊기지 않은 한 덩이)으로. 필링을 올린 뒤 다시 모양 빚기로 돌아와 거친다 */
export const PIE_LATTICE_STEPS: FormStep[] = [
  { ...PIN_OUT, label: '남은 반죽 밀어 펴기', hint: '위아래로 밀대를 밀어 둥글게 펴주세요' },
  { label: '띠로 자르기', hint: '빵칼로 점선을 따라 가로로 끝까지 그어 격자로 얹을 띠를 잘라주세요', gesture: 'cut', tool: 'knife' },
];

/** 모양 빚기 단계가 없는 빵(묽은 반죽)이면 null */
export function formStepsOf(def: BreadDef): FormStep[] | null {
  return FORMS[def.id] ?? null;
}

/** 밀어 편 반죽에 토핑을 올리고 말거나 접어 빚는 빵인지 — 토핑이 속으로 들어가고, 모양 빚기 뒤에 따로 올리는 단계가 없다 */
export function rollsIn(def: BreadDef): boolean {
  return !!FORMS[def.id]?.some((s) => s.gesture === 'toppings');
}
