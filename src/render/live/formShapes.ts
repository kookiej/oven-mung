// 모양 빚기의 반죽 모양 — 단계·진행도로부터 지오메트리를 실시간으로 만든다(매 프레임 가능).
// renders/blender_cartoon/render_game.py의 예전 form_shape를 옮긴 것 + 쿠키 떼어 내기·누르기, 칼질.
// 좌표: three.js 미터, 판 윗면이 y = baseY, 화면 앞쪽이 +z. 단위 길이 FS는 게임 화면 짧은 변에 해당한다.
// 마지막 모양(formFinal)은 다음 단계(틀·트레이에 올리기)에서 그대로 쓴다 — 납작하게 누르지 않는다.
// 모든 지오메트리에 정점 색(color)이 있다 — 반죽은 흰색(재질 색 그대로), 칼이 지나간 금은 어둡게. 재질은 vertexColors로.
import * as THREE from 'three';
import type { BreadId } from '../../types';
import { FORMS } from '../../content/forming';
import { bent, extrudeOutline, polyRadius, ropeGeometry, sheetGeometry, slabGeometry, tubeGeometry3, type RopePt, type SheetSample } from './geo';
import { Blob } from './geo';
import { noise3 } from './noise';

export const FS = 0.36;
/** 반죽 단계에서 넘어온 공의 반지름 */
export const R0 = 0.13 * FS;
export const BALL_H = R0 * 0.78;

const ease = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => ease(Math.min(1, Math.max(0, (x - e0) / (e1 - e0))));
const ropeR = (L: number, vol = 1) => Math.min(R0, Math.sqrt((4 * R0 ** 3 * vol) / (3 * Math.max(L, 1e-4))));

/** 쿠키: 큰 반죽(볼 속)에서 뜯어 판 위에 줄 맞춰 놓는 자리 — 판 가운데 기준. 트레이·오븐의 쿠키 자리와 같은 3×2 격자 */
export const COOKIE_PIECES = 6;
export const COOKIE_SPOTS: [number, number][] = [
  [-0.1, -0.055],
  [0.0, -0.055],
  [0.1, -0.055],
  [-0.1, 0.055],
  [0.0, 0.055],
  [0.1, 0.055],
];
export const COOKIE_R = R0 * Math.cbrt(1 / COOKIE_PIECES);
/** 납작하게 누른 쿠키 반죽 — 오븐에서 Blender 쿠키(반지름 0.041)까지 조금 더 퍼진다 */
const COOKIE_FLAT_R = 0.036;
const COOKIE_FLAT_H = 0.007;

/** 파이: 크러스트로 틀에 깔 큰 판 / 남은 반죽을 모아 다시 민 판(격자 띠로 자른다) */
export const PIE_STRIPS = 6;
/** 틀 바닥(반지름 약 0.097)과 옆벽(높이 약 0.024)을 덮고 가장자리가 틀 밖으로 늘어질 만큼 — 틀에 담을 때 크기가 맞게 */
export const PIE_CRUST_R = 0.148;
const PIE_SHEET_R = 0.078;

/** 플랫브레드: 스크레이퍼로 방사형으로 나눈 조각 수와 판 위 자리(판 가운데 기준) — 트레이·오븐(Blender FLAT_SPOTS)과 같은 2×2 */
export const FLAT_PIECES = 4;
export const FLAT_SPOTS: [number, number][] = [
  [-0.072, -0.05],
  [0.072, -0.05],
  [-0.072, 0.05],
  [0.072, 0.05],
];
/** 나누기 전 판에 놓인 반죽(봉긋한 덩이)의 높이·둥글기 */
const FLAT_DOME_H = 0.05;
const FLAT_DOME_K = 2.4;
/** 둥글린 조각 · 소를 올리려 민 판 · 납작하게 누른 끝 모양(오븐에서 Blender 0.046까지 조금 더 퍼진다) */
export const FLAT_BALL_R = 0.03;
const FLAT_BALL_H = 0.027;
const FLAT_SHEET_R = 0.04;
const FLAT_R = 0.042;
const FLAT_H = 0.007;

/** 쿠키에서 떼어 낸 조각 — 떼어 낸 자리(from, y)에서 판 위 자리(spot)로 날아간 정도 f */
export interface Torn {
  spot: number;
  from: [number, number, number];
  f: number;
}

/** 쿠키 무대의 볼 속 큰 반죽 자리 (판 가운데 기준) */
export interface CookieBowl {
  x: number;
  y: number;
  z: number;
}

export interface FormOpts {
  /** 반죽 단계에서 넘어온 공의 거칠기 — 볼에서 본 그 반죽 그대로 */
  rough?: number;
  /** 쿠키 떼어 내기: 볼 속 큰 반죽의 자리, 떼어 낸 조각들, 지금 손가락으로 당기고 있는 조각의 자리(x, y, z) */
  bowl?: CookieBowl;
  torn?: readonly Torn[];
  pull?: [number, number, number] | null;
  /** 하나씩 하는 몸짓(쿠키 누르기, 플랫브레드 둥글리기·감싸기·누르기): 조각마다의 진행 0~1 */
  press?: readonly number[];
  /** 칼질 — 이 단계의 칼선(cutLines)마다 칼날이 지나간 구간 [시작, 끝] (0~1, 없으면 아직) */
  cuts?: readonly ([number, number] | null)[];
  /** 이 단계에 들어온 뒤 지난 시간(초) — 자른 크루아상의 나머지 조각이 치워지는 모습 */
  stepAge?: number;
  /** formShape 단계 k를 마친 뒤 지난 시간(초), 아직이면 0 — 다 민 베이글 반죽을 가로로 돌려 놓는 모습. 없으면 오래전에 마친 것으로 */
  sinceDone?: (k: number) => number;
  /** 하나씩 둥글리기(플랫브레드): 조각마다 굴러간 자세(쿼터니언 x, y, z, w)와 손가락을 따라 비킨 자리(x, z) */
  roll?: readonly { q: [number, number, number, number]; off: [number, number] }[];
}

/** 칼선 — 칼날이 지나가야 하는 선분(판 위 x, z)과 그 자리의 반죽 겉면 높이 */
export interface CutLine {
  a: [number, number];
  b: [number, number];
  y: (x: number, z: number) => number;
}

const WHITE: [number, number, number] = [1, 1, 1];
/** 칼이 지나간 금 — 반죽 색에 곱한다 */
const SCORE_RGB: [number, number, number] = [0.5, 0.42, 0.36];

/** 지오메트리 전체에 정점 색 하나 */
function paint(g: THREE.BufferGeometry, rgb = WHITE): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** 칼선의 [s0, s1] 구간을 따라 겉면에 붙은 가는 금 */
function scoreRibbon(line: CutLine, s0: number, s1: number, w = 0.0011): THREE.BufferGeometry {
  const n = 28;
  const dx = line.b[0] - line.a[0];
  const dz = line.b[1] - line.a[1];
  const len = Math.hypot(dx, dz) || 1;
  const px = (-dz / len) * (w / 2);
  const pz = (dx / len) * (w / 2);
  const V: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = lerp(s0, s1, i / n);
    const x = line.a[0] + dx * t;
    const z = line.a[1] + dz * t;
    // 금의 양 끝은 가늘게
    const k = Math.min(1, Math.min(i, n - i) / 3 + 0.25);
    V.push(x + px * k, line.y(x + px * k, z + pz * k) + 0.0003, z + pz * k);
    V.push(x - px * k, line.y(x - px * k, z - pz * k) + 0.0003, z - pz * k);
    if (i < n) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 위를 보게
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  if (nrm.getY(0) < 0) {
    const a = idx.slice();
    for (let k = 0; k < a.length; k += 3) [a[k + 1], a[k + 2]] = [a[k + 2], a[k + 1]];
    g.setIndex(a);
    g.computeVertexNormals();
  }
  return paint(g, SCORE_RGB);
}

/** 칼질한 금들 */
function scores(lines: readonly CutLine[], cuts: FormOpts['cuts']): THREE.BufferGeometry[] {
  return (cuts ?? []).flatMap((c, i) => (c && lines[i] && c[1] - c[0] > 0.01 ? [scoreRibbon(lines[i], c[0], c[1])] : []));
}

/** 바게트 칼집 셋 — Blender build_baguette와 같은 자리(길이의 -0.22·0·+0.22)·각도(14°)·길이(0.2) */
export const BAGUETTE_SCORES = [-0.22, 0, 0.22];
const BAG_L = 0.72 * FS;
/** 날반죽 바게트는 가늘다 — 오븐에서 Blender 바게트 굵기까지 부푼다 */
const BAG_VOL = 0.75;
const BAG_R = ropeR(BAG_L, BAG_VOL);
const bagRadius = (x: number) => BAG_R * (1 - 0.45 * (2 * (x / BAG_L + 0.5) - 1) ** 4);
/** 이 빵·단계의 칼선 (칼질 단계가 아니면 빈 배열) */
export function cutLines(bid: BreadId, step: number, baseY: number): CutLine[] {
  if (bid === 'croissant' && step === CRO_CUT) {
    // 세로로 긴 세모 — 가운데 세모 하나와 그 옆 칼선. 칼선 간격을 재므로 인접한 선의 시작점이 겹치지 않게
    const y = () => baseY + CRO_H + 0.0004;
    const [, hz] = CRO_SHEET;
    const b = CRO_BASE;
    return [
      { a: [-2 * b, -hz], b: [-b, hz], y },
      { a: [-b, hz], b: [0, -hz], y },
      { a: [b, hz], b: [0, -hz], y },
      { a: [2 * b, -hz], b: [b, hz], y },
    ];
  }
  if (bid === 'flatbread' && step === 0) {
    // 방사형으로 똑같이 — 가운데를 지나는 십자
    const R = R0 * 1.04;
    const y = (x: number, z: number) => baseY + FLAT_DOME_H * Math.sqrt(Math.max(0, 1 - Math.min(1, Math.hypot(x, z) / R0) ** FLAT_DOME_K)) + 0.0005;
    return [
      { a: [-R, 0], b: [R, 0], y },
      { a: [0, -R], b: [0, R], y },
    ];
  }
  if (bid === 'baguette' && step === 6) {
    const al = (14 * Math.PI) / 180;
    const half = (0.2 * BAG_L) / 2;
    const y = (x: number, z: number) => {
      const r = bagRadius(x);
      return baseY + r * 0.78 + 0.92 * Math.sqrt(Math.max(0, r * r - z * z));
    };
    return BAGUETTE_SCORES.map((u) => {
      const xk = u * BAG_L;
      return { a: [xk - Math.cos(al) * half, Math.sin(al) * half], b: [xk + Math.cos(al) * half, -Math.sin(al) * half], y };
    });
  }
  if (bid === 'pie' && step === 2) {
    const R = PIE_SHEET_R;
    return Array.from({ length: PIE_STRIPS - 1 }, (_, k) => {
      const z = -R + ((2 * R) / PIE_STRIPS) * (k + 1);
      const hw = Math.sqrt(R * R - z * z) * 0.98;
      return { a: [-hw, z], b: [hw, z], y: () => baseY + 0.005 };
    });
  }
  return [];
}

/** 반죽 단계의 덩어리와 같은 결 — 볼에서 치댄 그 반죽이 판으로 넘어온다 (kneading.ts의 Blob 시드) */
export const BALL_SEED = 4.2;

/** 반죽 덩어리 지오메트리 (바닥 가운데가 원점) — 판 위 (x, z)에 놓는다 */
function ball(R: [number, number, number], rough: number, x: number, z: number, baseY: number, seed = BALL_SEED): THREE.BufferGeometry {
  const b = new Blob(seed, 40, 28);
  b.update(R, rough, 0.55, rough * 0.6);
  b.geometry.translate(x, baseY, z);
  return paint(b.geometry);
}

// ---------------------------------------------------------------- 밀어 편 판 · 말고 접기
/** 밀어 편 판의 두께 */
const SHEET_H = 0.006;
/** 돌돌 말아 빚는 반죽(식빵·베이글·프레첼)의 밀어 편 판 두께 — 공의 부피만큼 두툼해야 말았을 때 통통한 통이 된다 */
const ROLL_H = 0.009;
/** 밀대로 민 반죽은 세로로 긴 타원이다(사용자 요청) — 반지름 [x, z]. 조금 길게(사용자 요청) */
const OVAL = {
  shokupan: [0.24 * FS, 0.355 * FS],
  croissant: [0.2 * FS, 0.31 * FS],
  bagel: [0.2 * FS, 0.31 * FS],
  baguette: [0.2 * FS, 0.31 * FS],
  pretzel: [0.17 * FS, 0.25 * FS],
} as const;
/** 타원의 긴 옆선이 거의(완전히는 아니게) 곧도록 — z 방향 지수. 2면 보통 타원(사용자 요청) */
const OVAL_P = 3.2;
/** 크루아상: 겹을 다 만든 뒤 크게 민 직사각형의 반폭 [x, z]·두께 */
const CRO_SHEET: [number, number] = [0.45 * FS, 0.36 * FS];
/** 크게 민 판(과 세모)의 두께 — 세모를 끝까지 말면 예전 초승달만큼 통통한 통(바깥 반지름 약 0.043)이 된다 */
const CRO_H = 0.014;
/** 크루아상 단계 번호 (content/forming.ts의 FORMS.croissant 순서) */
const CRO_CUT = 8;
const CRO_TOP = 9;
const CRO_ROLL_STEP = 10;
/** 크루아상: 접기 전에 길게 민 판 [반폭 x, 반폭 z, 두께] · 세 겹으로 접은 뭉치 · 버터를 감싼 뭉치 */
type Rect = [number, number, number];
const CRO_LONG: Rect = [0.17 * FS, 0.3 * FS, SHEET_H * 1.5];
const CRO_PACK: Rect = [0.17 * FS, 0.1 * FS, 0.024];
const CRO_LOCK: Rect = [0.19 * FS, 0.09 * FS, 0.02];
/** 버터 — 반죽 색에 곱하는 정점 색 */
const BUTTER_RGB: [number, number, number] = [1.0, 0.93, 0.5];
/** 크루아상 세모의 밑변 반폭 — 세로로 길게 */
const CRO_BASE = 0.19 * FS;
/** 다 말았을 때 통의 반길이 — 말면서 양옆으로 늘인다. 초승달로 구부려도 이 길이 그대로다(사용자 요청 — 구부리며 커지지 않게) */
const CRO_SPAN = croArc() / 2;
/** 말기 진행의 이만큼에서 끝까지 다 말린다 — 그 뒤로는 뾰족한 끝이 밑으로 들어간 채 판 가운데로 온다 */
const CRO_ROLLED = 0.85;
/** 식빵·베이글도 말기 진행의 이만큼에서 다 말리고, 그 뒤로 통이 판 가운데로 온다 */
const SHOKU_ROLLED = 0.85;
const BAGEL_ROLLED = 0.85;
/** 베이글: 다 감싸 이은 고리의 둘레(= 굴려 늘인 줄의 길이) · 납작하게 편 끝이 다른 끝을 감싸 겹치는 만큼(한 바퀴 = 1) */
const BAGEL_L = 0.82 * FS;
const BAGEL_OVERLAP = 0.16;
/** 바게트: 세 겹 접기의 접는 곡률 반지름 — 나중 겹이 위로 올라오게 크다 */
const BAG_RB1 = 0.0032;
const BAG_RB2 = 0.0058;
/** 바게트: 세 겹으로 접은 뭉치의 두께 · 반으로 접는 곡률 반지름 */
const BAG_PACK = 0.016;
const BAG_RB3 = 0.0075;

/** z0~z1을 덮는 직사각형 판 */
function rectSheet(hx: number, z0: number, z1: number, baseY: number, th = SHEET_H): THREE.BufferGeometry {
  const mid = (z0 + z1) / 2;
  const hz = (z1 - z0) / 2;
  const poly: [number, number][] = [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ];
  return slabGeometry(0, mid, polyRadius(poly, 0.06), th, baseY);
}

/** 가운데에 놓인 직사각형 판 [반폭 x, 반폭 z, 두께] */
function rectSlab(r: Rect, baseY: number): THREE.BufferGeometry {
  const [hx, hz, H] = r;
  const poly: [number, number][] = [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ];
  return slabGeometry(0, 0, polyRadius(poly, 0.08), H, baseY);
}

const lerpRect = (a: Rect, b: Rect, t: number): Rect => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** 세로로 긴 타원 — v = z / rz(-1 ~ 1) 자리의 반폭 비율. 긴 옆선은 거의 곧고 위아래 끝은 둥글다 */
const ovalProfile = (v: number) => Math.sqrt(Math.max(0, 1 - Math.abs(v) ** OVAL_P));
/** 타원의 z 자리에서의 반폭 */
const ovalW = (rx: number, rz: number, z: number) => rx * ovalProfile(z / rz);
/** 가로로 돌려 놓은 타원(x 반폭 rz, z 반폭 rx)의 z 자리에서의 반폭 — 긴 옆선(앞·뒤)이 거의 곧다 */
const ovalWTurned = (rx: number, rz: number, z: number) => rz * Math.max(0, 1 - Math.min(1, (z / rx) ** 2)) ** (1 / OVAL_P);

/** 타원의 가운데에서 가장자리까지 — 각 a마다 (x/rx)² + |z/rz|^P = 1을 푼 값 */
const ovalRCache = new Map<string, Float32Array>();
function ovalR(rx: number, rz: number): (a: number) => number {
  const key = `${rx.toFixed(5)}|${rz.toFixed(5)}`;
  const n = 360;
  let tab = ovalRCache.get(key);
  if (!tab) {
    tab = new Float32Array(n + 1);
    for (let k = 0; k <= n; k++) {
      const a = (2 * Math.PI * k) / n;
      const c = Math.cos(a);
      const s = Math.sin(a);
      let lo = 0;
      let hi = Math.max(rx, rz) * 1.01;
      for (let it = 0; it < 30; it++) {
        const m = (lo + hi) / 2;
        if ((m * c / rx) ** 2 + Math.abs((m * s) / rz) ** OVAL_P < 1) lo = m;
        else hi = m;
      }
      tab[k] = (lo + hi) / 2;
    }
    ovalRCache.set(key, tab);
  }
  const T = tab;
  return (a: number) => {
    const f = ((((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)) * n;
    const k = Math.floor(f);
    return T[k] + (T[Math.min(n, k + 1)] - T[k]) * (f - k);
  };
}

/** 세로로 긴 타원 판 */
function ovalSheet(rx: number, rz: number, baseY: number, th = SHEET_H): THREE.BufferGeometry {
  return slabGeometry(0, 0, ovalR(rx, rz), th, baseY);
}

/** 공에서 세로로 긴 타원으로 밀어 펴는 중의 판 */
function rolledOut(rx: number, rz: number, e: number, baseY: number, th = SHEET_H): THREE.BufferGeometry {
  const Rp = ovalR(rx, rz);
  return slabGeometry(0, 0, (a) => lerp(R0, Rp(a), e), lerp(BALL_H, th, e), baseY);
}

/** 꼭짓점이 뒤(z0), 밑변(반폭 hw)이 앞(z1)인 세모 판 */
function triangle(cx: number, hw: number, z0: number, z1: number, baseY: number, th = SHEET_H): THREE.BufferGeometry {
  const g = (z0 + 2 * z1) / 3;
  const poly: [number, number][] = [
    [0, z0 - g],
    [hw, z1 - g],
    [-hw, z1 - g],
  ];
  return slabGeometry(cx, g, polyRadius(poly, 0.1), th, baseY);
}

/** 볼록한 네 꼭짓점 판 — dx만큼 옆으로 옮겨서 */
function quad(poly: readonly [number, number][], dx: number, baseY: number, th = SHEET_H): THREE.BufferGeometry {
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  return slabGeometry(cx + dx, cz, polyRadius(poly.map(([x, z]) => [x - cx, z - cz] as [number, number]), 0.06), th, baseY);
}

// ---------------------------------------------------------------- 돌돌 말기
/** 말린 판 — 지오메트리와 통(나선)의 바깥 반지름·가운데 */
interface Rolled {
  geo: THREE.BufferGeometry;
  /** 가장 바깥 겹의 중심선 반지름 (겉면은 여기에 반두께를 더한 자리) */
  rOut: number;
  cz: number;
  cy: number;
}

/** 다 말았을 때 통의 바깥 반지름 — 길이 L, 두께 th인 판을 끝까지 말면 */
const rollRadius = (L: number, th: number) => Math.sqrt((th * 0.75) ** 2 + (th * L) / Math.PI) + th / 2;

/**
 * 판을 앞(z1)에서부터 정말로 돌돌 만다(사용자 요청 — 다 만 통을 판 끝에 얹지 않는다). 판은 z0(뒤) ~ z1(앞)이고 자리 s의 반폭이 widthAt(s).
 * 앞에서부터 k만큼(0~1) 말려 있다 — 말린 부분은 판에 닿은 자리를 지나 앞으로 들려 올라가 위로 넘어가며 감기는 나선이다(겹이 서로 닿는다).
 * 길이는 그대로라 다 말면 뒤 끝이 통 밑에 깔린다. stretch는 말린 부분을 양옆으로 늘이는 배율(크루아상), shift는 통을 앞뒤로 옮기는 양
 */
function rollSheet(
  widthAt: (s: number) => number,
  z0: number,
  z1: number,
  k: number,
  baseY: number,
  th: number,
  o: { stretch?: number; shift?: number } = {},
): Rolled {
  const L = z1 - z0;
  const Lr = Math.max(0, Math.min(1, k)) * L;
  const zb = z1 - Lr;
  const p = th;
  const rin = th * 0.75;
  const rOut = Math.sqrt(rin * rin + (p * Lr) / Math.PI);
  const shift = o.shift ?? 0;
  const S = o.stretch ?? 1;
  const h0 = th / 2;
  const cz = zb + shift;
  const cy = baseY + h0 + rOut;
  // 판의 앞뒤 끝은 둥글게 닫힌다
  const hAt = (s: number) => {
    const f = Math.min(1, Math.min(s - z0, z1 - s) / (th * 0.9));
    return h0 * Math.sqrt(Math.max(0, 1 - (1 - Math.max(0, f)) ** 2));
  };
  const samples: SheetSample[] = [];
  const nRoll = Lr > 1e-5 ? 150 : 0;
  const nFlat = zb - z0 > 1e-5 ? 44 : 0;
  for (let i = 0; i < nFlat; i++) {
    // 뒤 끝 쪽이 촘촘하게 — 타원의 둥근 끝
    const f = i / (nRoll ? nFlat : nFlat - 1);
    const s = z0 + (zb - z0) * (1 - Math.cos((Math.PI / 2) * f)) ** 0.8;
    samples.push({ z: s + shift, y: baseY + h0, nz: 0, ny: 1, h: hAt(s), w: widthAt(s) });
  }
  for (let i = 0; i <= nRoll; i++) {
    const d = (Lr * i) / nRoll;
    const s = zb + d;
    const phi = ((rOut - Math.sqrt(Math.max(0, rOut * rOut - (p * d) / Math.PI))) * 2 * Math.PI) / p;
    const R = rOut - (p * phi) / (2 * Math.PI);
    const th0 = -Math.PI / 2 + phi;
    const c = Math.cos(th0);
    const sn = Math.sin(th0);
    const dR = -p / (2 * Math.PI);
    let tz = dR * c - R * sn;
    let ty = dR * sn + R * c;
    const tl = Math.hypot(tz, ty) || 1;
    tz /= tl;
    ty /= tl;
    const w = widthAt(s) * (1 + (S - 1) * smooth(0, 0.02, d));
    samples.push({ z: cz + R * c, y: cy + R * sn, nz: -ty, ny: tz, h: hAt(s), w });
  }
  return { geo: sheetGeometry(samples, baseY), rOut, cz, cy };
}

/** 크루아상 초승달의 굽은 각 — 통의 길이를 따라(-1 왼쪽 끝 ~ 1 오른쪽 끝) 중심선이 가리키는 방향. 오븐 GLB(Blender build_croissant)의 중심선에서 */
let croTheta: Float32Array | null = null;
const CRO_TH_N = 200;
function croBendAngle(sn: number): number {
  if (!croTheta) {
    // croissantLine은 u = 0이 오른쪽 끝 — 왼쪽 끝(u = 1)에서 오른쪽으로
    const M = 400;
    const P = Array.from({ length: M + 1 }, (_, i) => croissantLine(1 - i / M));
    const acc = [0];
    for (let i = 1; i <= M; i++) acc.push(acc[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const ang: number[] = [];
    for (let i = 0; i <= M; i++) {
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(M, i + 1)];
      ang.push(Math.atan2(b[1] - a[1], b[0] - a[0]));
    }
    for (let i = 1; i <= M; i++) {
      while (ang[i] - ang[i - 1] > Math.PI) ang[i] -= 2 * Math.PI;
      while (ang[i] - ang[i - 1] < -Math.PI) ang[i] += 2 * Math.PI;
    }
    const mid = ang[M / 2];
    croTheta = new Float32Array(CRO_TH_N + 1);
    let j = 0;
    for (let k = 0; k <= CRO_TH_N; k++) {
      const s = (k / CRO_TH_N) * acc[M];
      while (j < M - 1 && acc[j + 1] < s) j++;
      const f = (s - acc[j]) / (acc[j + 1] - acc[j] || 1);
      croTheta[k] = lerp(ang[j], ang[j + 1], f) - mid;
    }
  }
  const f = ((Math.max(-1, Math.min(1, sn)) + 1) / 2) * CRO_TH_N;
  const k = Math.min(CRO_TH_N - 1, Math.floor(f));
  return lerp(croTheta[k], croTheta[k + 1], f - k);
}

// ---------------------------------------------------------------- 크루아상 초승달
/** 겹겹이 만 크루아상의 겹 수(1~4) — a = 가운데에서의 거리(0~1) + 겹 가장자리가 둘레를 따라 비스듬히 도는 만큼 */
function croLayers(a: number): number {
  let L = 4;
  for (let k = 1; k <= 3; k++) L -= smooth(0.25 * k - 0.011, 0.25 * k + 0.011, a);
  return L;
}
const croStair = (a: number) => 0.4 + 0.15 * croLayers(a);
const croEnv = (v: number) => Math.max(0.5, 0.94 - 0.5 * v);
const CRO_M = 132;

/** croissantLine의 길이 */
function croArc(): number {
  let L = 0;
  let p = croissantLine(0);
  for (let i = 1; i <= 400; i++) {
    const q = croissantLine(i / 400);
    L += Math.hypot(q[0] - p[0], q[1] - p[1]);
    p = q;
  }
  return L;
}

/** croissantLine의 u 자리까지의 길이 비율 (u = 0 오른쪽 끝에서) */
let croSigma: Float32Array | null = null;
function croSigmaAt(i: number): number {
  if (!croSigma) {
    croSigma = new Float32Array(CRO_M);
    let L = 0;
    let p = croissantLine(0);
    const acc = [0];
    for (let k = 1; k < CRO_M; k++) {
      const q = croissantLine(k / (CRO_M - 1));
      L += Math.hypot(q[0] - p[0], q[1] - p[1]);
      acc.push(L);
      p = q;
    }
    acc.forEach((v, k) => (croSigma![k] = v / L));
  }
  return croSigma[i];
}

/**
 * 크루아상 초승달 — 굽은 정도 e(0 곧게 편 통 ~ 1 초승달). 중심선은 오븐 GLB(Blender build_croissant)와 같은 croissantLine이고,
 * 구부려도 길이와 굵기는 그대로다(사용자 요청). 가운데(가장 바깥 겹)가 가장 높고 양옆으로 겹이 계단처럼 내려간다(참고 사진) —
 * 겹은 서로 붙지 않고 가장자리가 또렷하다. 뾰족한 끝은 밑으로 들어가 있다
 */
function croCrescent(e: number, baseY: number): THREE.BufferGeometry {
  const L = 2 * CRO_SPAN;
  // 왼쪽 끝에서 잰 길이 p에서의 중심선 — 굽은 각을 이어 붙여 길이를 지킨다
  const N = 240;
  const C: [number, number][] = [[0, 0]];
  const TH: number[] = [e * croBendAngle(-1)];
  for (let k = 1; k <= N; k++) {
    const th = e * croBendAngle(-1 + (2 * k) / N);
    const tm = (th + TH[k - 1]) / 2;
    C.push([C[k - 1][0] + (Math.cos(tm) * L) / N, C[k - 1][1] + (Math.sin(tm) * L) / N]);
    TH.push(th);
  }
  const pts: RopePt[] = [];
  for (let i = 0; i < CRO_M; i++) {
    // u = 0이 오른쪽 끝 — 왼쪽 끝에서의 비율은 1 - σ
    const f = (1 - croSigmaAt(i)) * N;
    const k = Math.min(N - 1, Math.floor(f));
    pts.push([lerp(C[k][0], C[k + 1][0], f - k), lerp(C[k][1], C[k + 1][1], f - k), croissantLine(i / (CRO_M - 1))[2]]);
  }
  const g = ropeGeometry(pts, baseY, {
    nseg: 40,
    disp: (i, th) => {
      const v = Math.abs((2 * i) / (CRO_M - 1) - 1);
      // 끝(밑)에서 앞 → 위 → 뒤로 돌아가며 겹이 넓어진다
      const tn = ((((1.5 * Math.PI - th) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
      return pts[i][2] * (croStair(v + 0.25 * (1 - tn)) / croEnv(v) - 1);
    },
  });
  // 가로·앞뒤 상자 가운데를 원점에 — 오븐 GLB(트레이 가운데에 상자 가운데를 맞춘 빵)와 같다
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.translate(-(b.min.x + b.max.x) / 2, 0, -(b.min.z + b.max.z) / 2);
  return g;
}

/** 타원 판(z 반폭 rz, 자리마다 반폭 widthAt)을 앞에서부터 돌돌 말아(앞 40%) 일정한 굵기의 줄로 늘인다(뒤 60%) */
function sheetToRope(widthAt: (s: number) => number, rz: number, Lmax: number, rEnd: number, t: number, baseY: number): THREE.BufferGeometry[] {
  if (t < 0.4) return [rollSheet(widthAt, -rz, rz, smooth(0, 0.4, t), baseY, ROLL_H).geo];
  // 다 만 통과 같은 굵기·길이에서 시작해 늘인다
  const r0 = rollRadius(2 * rz, ROLL_H);
  const L0 = 2 * widthAt(0);
  const e2 = ease((t - 0.4) / 0.6);
  const L = lerp(L0, Lmax, e2);
  const r = lerp(r0, rEnd, e2);
  const z0 = -rz;
  return [ropeGeometry(bent(L, 0, () => r, 80, 0, lerp(z0, 0, e2)), baseY, { lift: Array(80).fill(r * 0.22 * (1 - e2)), capRound: smooth(0, 0.5, e2) })];
}

/** outlineOf가 만든 외곽 점마다, 판의 뒤 끝(0) ~ 앞 끝(1) 중 어디인지 */
function outlineFracs(): number[] {
  const N = 44;
  const out: number[] = [];
  for (let i = 0; i < N; i++) out.push(i / (N - 1));
  for (let k = 0; k < 5; k++) out.push(1);
  for (let i = N - 1; i >= 0; i--) out.push(i / (N - 1));
  for (let k = 0; k < 5; k++) out.push(0);
  return out;
}

/**
 * 편지 접듯 세 겹으로 — 앞쪽 3분의 1을 가운데로, 뒤쪽 3분의 1을 그 위로. 판의 반폭 hx(또는 자리마다 widthAt(0 뒤 ~ 1 앞)),
 * 반깊이 hz, 두께 th
 */
function letterFold(hx: number, hz: number, t: number, baseY: number, th: number, rb1: number, rb2: number, widthAt?: (f: number) => number): THREE.BufferGeometry {
  const third = (2 * hz) / 3;
  const y0 = baseY + th / 2;
  const p1 = Math.PI * ease(Math.min(1, t * 2));
  const p2 = Math.PI * ease(Math.max(0, t * 2 - 1));
  const back = flap(-third / 2, -1, p2, Math.max(0, third - rb2 * p2), rb2, y0).reverse();
  const front = flap(third / 2, 1, p1, Math.max(0, third - rb1 * p1), rb1, y0);
  const outline = outlineOf([...back, [-third / 2, y0], [third / 2, y0], ...front], th);
  return extrudeOutline(hx, outline, baseY, 36, widthAt ? outlineFracs().map(widthAt) : undefined);
}

/** 접는 자리의 안내선 — 판을 가로지르는 선분 (판 위 [x, y, z] 두 점). 접힌 뒤에는 없다 */
export function foldGuides(bid: BreadId, step: number, t: number, baseY: number): [number, number, number][][] {
  const across = (hw: number, z: number, y: number): [number, number, number][] => [
    [-hw, y, z],
    [hw, y, z],
  ];
  /** 세 겹 접기: 앞쪽 선은 앞이 접히기 전까지, 뒤쪽 선은 뒤가 접히기 전까지 (t0 = 접기 시작하는 진행도) */
  const letter = (hw: (z: number) => number, hz: number, y: number, t0 = 0) => {
    const z = hz / 3;
    const tt = (t - t0) / (1 - t0);
    const out: [number, number, number][][] = [];
    if (tt < 0.15) out.push(across(hw(z), z, y));
    if (tt < 0.65) out.push(across(hw(-z), -z, y));
    return out;
  };
  if (bid === 'baguette' && step === 2) {
    const [rx, rz] = OVAL.baguette;
    return letter((z) => ovalW(rx, rz, z), rz, baseY + SHEET_H + 0.001);
  }
  if (bid === 'baguette' && step === 3) {
    const [rx] = OVAL.baguette;
    return t < 0.15 ? [across(rx * 0.9, 0, baseY + BAG_PACK + 0.001)] : [];
  }
  if (bid === 'croissant' && step === 1) {
    const [rx, rz] = OVAL.croissant;
    return letter((z) => ovalW(rx, rz, z), rz, baseY + SHEET_H + 0.001, 0.2);
  }
  if (bid === 'croissant' && (step === 3 || step === 5)) return letter(() => CRO_LONG[0], CRO_LONG[1], baseY + CRO_LONG[2] + 0.001);
  return [];
}

/** 경첩(z0)에서 바깥(dir) 쪽으로 나간 판의 중심선 — 반지름 rb로 phi만큼 들려 뒤집힌다 */
function flap(z0: number, dir: 1 | -1, phi: number, len: number, rb: number, y0: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let k = 1; k <= 10; k++) {
    const a = (phi * k) / 10;
    pts.push([z0 + dir * rb * Math.sin(a), y0 + rb * (1 - Math.cos(a))]);
  }
  const ez = z0 + dir * rb * Math.sin(phi);
  const ey = y0 + rb * (1 - Math.cos(phi));
  for (let k = 1; k <= 8; k++) {
    const s = (len * k) / 8;
    pts.push([ez + dir * Math.cos(phi) * s, ey + Math.sin(phi) * s]);
  }
  return pts;
}

/** 중심선 → 두께 th의 닫힌 외곽 (점 수는 항상 같다) */
function outlineOf(line: readonly [number, number][], th: number): [number, number][] {
  const N = 44;
  const d = [0];
  for (let i = 1; i < line.length; i++) d.push(d[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = d[d.length - 1] || 1;
  const P: [number, number][] = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const s = (i / (N - 1)) * total;
    while (j < line.length - 2 && d[j + 1] < s) j++;
    const f = (s - d[j]) / (d[j + 1] - d[j] || 1);
    P.push([lerp(line[j][0], line[j + 1][0], f), lerp(line[j][1], line[j + 1][1], f)]);
  }
  const nrm = P.map((_, i) => {
    const a = P[Math.max(0, i - 1)];
    const b = P[Math.min(N - 1, i + 1)];
    const dz = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dz, dy) || 1;
    return [-dy / l, dz / l] as [number, number];
  });
  const h = th / 2;
  const out: [number, number][] = [];
  for (let i = 0; i < N; i++) out.push([P[i][0] + nrm[i][0] * h, P[i][1] + nrm[i][1] * h]);
  // 끝을 둥글게 돌아 아랫면으로 돌아온다
  const cap = (c: [number, number], n: [number, number]) => {
    for (let k = 1; k <= 5; k++) {
      const a = (Math.PI * k) / 6;
      out.push([c[0] + (n[0] * Math.cos(a) + n[1] * Math.sin(a)) * h, c[1] + (n[1] * Math.cos(a) - n[0] * Math.sin(a)) * h]);
    }
  };
  cap(P[N - 1], nrm[N - 1]);
  for (let i = N - 1; i >= 0; i--) out.push([P[i][0] - nrm[i][0] * h, P[i][1] - nrm[i][1] * h]);
  cap(P[0], [-nrm[0][0], -nrm[0][1]]);
  return out;
}

/** 외곽을 타원 쪽으로 — 각 점을 가운데에서 본 방향의 타원 위 점으로 옮긴다 */
function toEllipse(outline: readonly [number, number][], rx: number, cy: number, ry: number, k: number): [number, number][] {
  const M = outline.length;
  let oz = 0;
  let oy = 0;
  for (const [z, y] of outline) {
    oz += z / M;
    oy += y / M;
  }
  return outline.map(([z, y]) => {
    const a = Math.atan2(y - oy, z - oz);
    return [lerp(z, rx * Math.cos(a), k), lerp(y, cy + ry * Math.sin(a), k)] as [number, number];
  });
}

/** 떼어 낸 조각이 큰 반죽에서 자리까지 포물선으로 날아가는 중간 자리 */
function flight(from: [number, number, number], to: [number, number], f: number, baseY: number): [number, number, number] {
  const e = ease(f);
  return [lerp(from[0], to[0], e), lerp(from[1], baseY, e * e) + Math.sin(Math.PI * f) * 0.05, lerp(from[2], to[1], e)];
}

/** bid의 모양 빚기 단계 step·진행도 t에서의 반죽 (모든 지오메트리에 정점 색) */
export function formShape(bid: BreadId, step: number, t: number, baseY: number, opts: FormOpts = {}): THREE.BufferGeometry[] {
  return shape(bid, step, t, baseY, opts).map((g) => (g.getAttribute('color') ? g : paint(g)));
}

function shape(bid: BreadId, step: number, t: number, baseY: number, opts: FormOpts): THREE.BufferGeometry[] {
  const e = ease(t);
  switch (bid) {
    case 'cookie': {
      if (step === 0) {
        // 볼 속 큰 반죽에서 손으로 뜯듯 같은 크기의 작은 반죽을 하나씩 뜯어 판 위에 줄 맞춰 놓는다 — 큰 반죽은 그만큼 작아진다.
        // 당기는 동안엔 조각이 손가락을 따라 늘어나고, 가늘어진 목이 끊어지면 떨어져 나간다. 마지막 조각은 남은 반죽 전부
        const torn = opts.torn ?? [];
        const bowl = opts.bowl ?? { x: 0, y: baseY, z: 0 };
        const out: THREE.BufferGeometry[] = [];
        const pulling = opts.pull ? 1 : 0;
        const left = 1 - (torn.length + pulling) / COOKIE_PIECES;
        const r = R0 * Math.cbrt(Math.max(left + pulling * 0.5 / COOKIE_PIECES, 1e-4));
        const last = left <= 0.001;
        if (!last) out.push(ball([r, r * 0.78, r], 0.15 + (opts.rough ?? 0) * 0.3, bowl.x, bowl.z, bowl.y, BALL_SEED));
        torn.forEach((p, i) => {
          const [x, y, z] = flight(p.from, COOKIE_SPOTS[p.spot], Math.min(1, p.f), baseY);
          // 뜯어낸 조각 — 같은 크기, 뜯긴 자리가 거칠다
          out.push(ball([COOKIE_R, COOKIE_R * 0.78, COOKIE_R], 0.42, x, z, y, 2 + p.spot * 1.7));
          void i;
        });
        if (opts.pull) {
          const P = new THREE.Vector3(opts.pull[0], opts.pull[1], opts.pull[2]);
          const C = new THREE.Vector3(bowl.x, bowl.y + r * 0.8, bowl.z);
          const d = P.distanceTo(C);
          const grow = last ? 1 : Math.min(1, Math.max(0.4, (d - r * 0.4) / (r * 1.2)));
          const pr = COOKIE_R * grow;
          out.push(ball([pr, pr * 0.78, pr], 0.42, P.x, P.z, P.y - pr * 0.6, 2 + torn.length * 1.7));
          // 목 — 큰 반죽에서 조각까지, 멀어질수록 가늘어진다
          if (!last && d > r * 0.7) {
            const stretch = Math.min(1, d / (r + COOKIE_R * 2.4));
            const neck = (u: number) => COOKIE_R * (0.6 - 0.36 * stretch) * (0.55 + 0.45 * Math.abs(2 * u - 1) ** 1.5);
            const pts = Array.from({ length: 16 }, (_, i) => C.clone().lerp(P, i / 15));
            out.push(tubeGeometry3(pts, neck));
          }
        }
        return out;
      }
      // 하나씩 꾹 눌러 납작하게 — 조각마다 눌린 정도가 따로
      const press = opts.press ?? [];
      return COOKIE_SPOTS.map(([x, z], i) => {
        const k = ease(Math.min(1, press[i] ?? 0));
        const R = lerp(COOKIE_R, COOKIE_FLAT_R, k);
        return ball([R, lerp(COOKIE_R * 0.78, COOKIE_FLAT_H, k), R], lerp(0.42, 0.06, k), x, z, baseY, 2 + i * 1.7);
      });
    }
    case 'flatbread': {
      // 판에 놓인 반죽 → 스크레이퍼로 넷으로 → 하나씩 둥글리고 → (소가 있으면 밀어 소를 올려 감싸고) → 하나씩 납작하게
      const press = opts.press ?? [];
      const pk = (i: number) => ease(Math.min(1, press[i] ?? 0));
      const piece = (i: number, R: (a: number) => number, H: number, ek: number, c: [number, number] = FLAT_SPOTS[i]) =>
        slabGeometry(c[0], c[1], R, H, baseY, undefined, 64, 14, ek);
      const all = (R: number, H: number, ek: number) => FLAT_SPOTS.map((_, i) => piece(i, () => R, H, ek));
      if (step === 0) {
        const lines = cutLines(bid, 0, baseY);
        const done = (opts.cuts ?? []).filter((c) => c && c[1] - c[0] >= 0.999).length === lines.length;
        // 다 그으면 네 조각으로 살짝 벌어진다
        if (done) return FLAT_SPOTS.map((_, i) => piece(i, flatQuarter(i).R, FLAT_DOME_H, FLAT_DOME_K, flatQuarter(i).c));
        return [slabGeometry(0, 0, () => R0, FLAT_DOME_H, baseY, undefined, 96, 20, FLAT_DOME_K), ...scores(lines, opts.cuts)];
      }
      if (step === 1) {
        // 조각이 제자리로 미끄러져 가고, 하나씩 손바닥 밑에서 공처럼 굴려 동그랗게 — 반죽 결이 굴러가는 쪽으로 돈다(사용자 요청)
        const m = smooth(0, 0.45, opts.stepAge ?? 1);
        return FLAT_SPOTS.map((spot, i) => {
          const q = flatQuarter(i);
          const roll = opts.roll?.[i];
          const c: [number, number] = [lerp(q.c[0], spot[0], m) + (roll?.off[0] ?? 0), lerp(q.c[1], spot[1], m) + (roll?.off[1] ?? 0)];
          return roundingPiece(i, pk(i), q.R, c, roll?.q, baseY);
        });
      }
      if (step === 2) return all(lerp(FLAT_BALL_R, FLAT_SHEET_R, e), lerp(FLAT_BALL_H, SHEET_H, e), lerp(2, 5, e));
      if (step === 3) return all(FLAT_SHEET_R, SHEET_H, 5);
      // 가장자리를 오므려 소를 감싼다 — 다시 동그란 덩이로
      if (step === 4) return FLAT_SPOTS.map((_, i) => piece(i, () => lerp(FLAT_SHEET_R, FLAT_BALL_R, pk(i)), lerp(SHEET_H, FLAT_BALL_H, pk(i)), lerp(5, 2, pk(i))));
      return FLAT_SPOTS.map((_, i) => piece(i, () => lerp(FLAT_BALL_R, FLAT_R, pk(i)), lerp(FLAT_BALL_H, FLAT_H, pk(i)), lerp(2, 3.5, pk(i))));
    }
    case 'shokupan': {
      const [rx, rz] = OVAL.shokupan;
      if (step === 0) return [rolledOut(rx, rz, e, baseY, ROLL_H)];
      if (step === 1) return [ovalSheet(rx, rz, baseY, ROLL_H)];
      // 앞에서부터 판이 정말로 말려 올라간다 — 다 말면 뒤 끝이 통 밑에 깔리고 통이 판 가운데로 온다
      const roll = Math.min(1, e / SHOKU_ROLLED);
      return [rollSheet((s) => ovalW(rx, rz, s), -rz, rz, roll, baseY, ROLL_H, { shift: rz * smooth(SHOKU_ROLLED, 1, e) }).geo];
    }
    case 'croissant': {
      const [ox, oz] = OVAL.croissant;
      const [hx, hz] = CRO_SHEET;
      const b = CRO_BASE;
      if (step === 0) return [rolledOut(ox, oz, e, baseY)];
      if (step === 1) {
        // 차가운 버터를 가운데에 올리고 반죽으로 편지처럼 감싼다
        const drop = smooth(0, 0.18, t);
        const tt = Math.max(0, (t - 0.2) / 0.8);
        const sq = smooth(0.1, 0.9, tt);
        const dough = letterFold(ox, oz, tt, baseY, SHEET_H, 0.0045, 0.0075, (f) => lerp(ox * Math.max(0.17, ovalProfile(2 * f - 1)), CRO_LOCK[0], sq));
        const out = [dough];
        if (tt < 0.98) {
          const g = new THREE.BoxGeometry(ox * 1.25, 0.0024, (oz / 3) * 1.5).toNonIndexed();
          g.translate(0, baseY + SHEET_H + 0.0013 + (1 - drop) ** 2 * 0.06, 0);
          g.computeVertexNormals();
          out.push(paint(g, BUTTER_RGB));
        }
        return out;
      }
      if (step === 2) return [rectSlab(lerpRect(CRO_LOCK, CRO_LONG, e), baseY)];
      if (step === 3 || step === 5) return [letterFold(CRO_LONG[0], CRO_LONG[1], t, baseY, CRO_LONG[2], 0.0055, 0.0105)];
      if (step === 4) return [rectSlab(lerpRect(CRO_PACK, CRO_LONG, e), baseY)];
      // 큰 직사각형 — 세로로 먼저 길게(두께가 반쯤 얇아지고), 그다음 가로로 넓게
      const tall: Rect = [CRO_PACK[0], hz, (CRO_PACK[2] + CRO_H) / 2];
      if (step === 6) return [rectSlab(lerpRect(CRO_PACK, tall, e), baseY)];
      if (step === 7) return [rectSlab(lerpRect(tall, [hx, hz, CRO_H], e), baseY)];
      if (step === CRO_CUT) return [rectSheet(hx, -hz, hz, baseY, CRO_H), ...scores(cutLines(bid, CRO_CUT, baseY), opts.cuts)];
      if (step === CRO_TOP) {
        const out = [triangle(0, b, -hz, hz, baseY, CRO_H)];
        // 나머지 조각은 양옆으로 치워진다
        const k = smooth(0, 0.5, opts.stepAge ?? 1);
        if (k < 1) {
          for (const sx of [-1, 1]) {
            const dx = sx * k * 0.3;
            const poly: [number, number][] = [
              [sx * 0.002, -hz],
              [sx * hx, -hz],
              [sx * hx, hz],
              [sx * (b + 0.002), hz],
            ];
            out.push(quad(poly, dx, baseY, CRO_H));
          }
        }
        return out;
      }
      // 넓은 밑변부터 뾰족한 끝까지 정말로 말린다 — 세모라 바깥 겹일수록 좁아 겹이 계단처럼 또렷하다(참고 사진).
      // 말면서 양옆으로 늘이고, 다 말리면 끝은 저절로 통 밑으로 들어가 판 가운데로 온다
      const triW = (s: number) => (b * (s + hz)) / (2 * hz);
      const stretch = CRO_SPAN / b;
      if (step === CRO_ROLL_STEP) {
        const roll = Math.min(1, e / CRO_ROLLED);
        if (roll < 1) return [rollSheet(triW, -hz, hz, roll, baseY, CRO_H, { stretch: lerp(1, stretch, roll) }).geo];
        // 다 말리면 끝은 밑으로 들어가 곧게 편 초승달 반죽(양 끝이 가는 통)이 되어 판 가운데로 온다 — 구부리기가 이 모양에서 이어진다
        const g = croCrescent(0, baseY);
        g.translate(0, 0, -hz * (1 - smooth(CRO_ROLLED, 1, e)));
        return [g];
      }
      // 초승달로 — 곧게 만 통을 길이·굵기 그대로 구부린다. 끝 모양은 예전 초승달과 같다(사용자 요청) — 오븐 GLB가 이걸 바탕으로 한다
      return [croCrescent(e, baseY)];
    }
    case 'bagel': {
      // 세로로 길게 밀어 › 가로로 돌려 놓고 › 소·토핑 › 감싸며 말고 › 이음매·양 끝을 꼬집어 붙이고 › 일정한 굵기로 늘이고 ›
      // 한쪽 끝을 납작하게 › 둥글게 구부려 납작한 끝으로 다른 끝을 감싸 잇는다(사용자 요청)
      const [rx, rz] = OVAL.bagel;
      // 다 민 판을 가로로 돌려 놓는다 — 밀기를 마치면 저절로
      const turn = step === 0 ? 0 : smooth(0.05, 0.6, opts.sinceDone?.(0) ?? 99);
      const turned = (g: THREE.BufferGeometry) => (g.rotateY((-Math.PI / 2) * ease(turn)), g);
      if (step === 0) return [rolledOut(rx, rz, e, baseY, ROLL_H)];
      if (step === 1 || (step === 2 && turn < 1)) return [turned(ovalSheet(rx, rz, baseY, ROLL_H))];
      const across = (s: number) => ovalWTurned(rx, rz, s);
      if (step === 2) {
        const roll = Math.min(1, e / BAGEL_ROLLED);
        return [rollSheet(across, -rx, rx, roll, baseY, ROLL_H, { shift: rx * smooth(BAGEL_ROLLED, 1, e) }).geo];
      }
      const n = 110;
      if (step === 3) {
        // 이음매와 양 끝을 꼬집어 붙인다 — 말린 결이 드러난 끝이 오므라들고 이음매 금이 사라진다
        const L = 2 * rz;
        const r = BAGEL_LOG_R;
        const lift = Array(n).fill(r * 0.22 * (1 - e));
        const out = [ropeGeometry(bent(L, 0, () => r, n), baseY, { lift, capRound: smooth(0.1, 0.9, t) })];
        if (t < 0.75) {
          const top = baseY + r * 1.64 + r * 0.22 * (1 - e) + 0.0003;
          out.push(scoreRibbon({ a: [-L / 2 + r, -r * 0.35], b: [L / 2 - r, -r * 0.35], y: () => top }, 0, 1, 0.0016 * (1 - t / 0.75)));
        }
        return out;
      }
      if (step === 4) {
        // 좌우로 굴려 일정한 굵기로 늘인다 (부피 그대로)
        const L = lerp(2 * rz, BAGEL_L, e);
        const r = BAGEL_LOG_R * Math.sqrt((2 * rz) / L);
        return [ropeGeometry(bent(L, 0, () => r, n), baseY)];
      }
      const r = BAGEL_R;
      if (step === 5) {
        // 오른쪽 끝을 꾹 눌러 넓적하게 — 다른 끝을 감쌀 자리
        const flat = (i: number) => bagelFlat(i / (n - 1)) * e;
        return [ropeGeometry(bent(BAGEL_L, 0, () => r, n), baseY, { section: (i) => [1 + 0.55 * flat(i), 1 - 0.45 * flat(i)] })];
      }
      if (t >= 0.999) return [bagelRing(baseY)];
      // 둥글게 구부려 양 끝을 맞대고(1) › 넓적한 끝이 다른 끝 위로 넘어가 덮고(2) › 그 끝이 다른 끝을 소매처럼 빙 둘러 감싼다(3) (사용자 요청)
      const bendK = smooth(0, 0.55, e);
      const over = smooth(0.5, 0.8, e);
      const wrapK = smooth(0.78, 1, e);
      const phi = 2 * Math.PI * (0.97 * bendK + (BAGEL_OVERLAP + 0.03) * over);
      const pts = bent(BAGEL_L, phi, () => r, n);
      const lift = over > 0 ? crossLift(pts, r).map((v) => v * 1.1 * over * (1 - wrapK)) : undefined;
      return [
        ropeGeometry(pts, baseY, {
          lift,
          // 감싸는 끝은 소매처럼 덜 오므린다 — 안에 든 끝을 끝까지 덮는다
          capRoundEnd: lerp(1, 0.25, over),
          section: (i) => {
            const f = bagelFlat(i / (n - 1));
            // 넓적하게 눌린 끝이 감싸며 다시 둥글어진다 — 안에 든 끝보다 살짝 굵은 소매
            return [lerp(1 + 0.55 * f, 1 + BAGEL_LIP * f, wrapK), lerp(1 - 0.45 * f, 1 + BAGEL_LIP * f, wrapK)];
          },
        }),
      ];
    }
    case 'pretzel': {
      const [rx, rz] = OVAL.pretzel;
      if (step === 0) return [rolledOut(rx, rz, e, baseY, ROLL_H)];
      if (step === 1) return [ovalSheet(rx, rz, baseY, ROLL_H)];
      const r0 = ropeR(PZ_ROPE, 0.7);
      if (step === 2) return sheetToRope((s) => ovalW(rx, rz, s), rz, PZ_ROPE, r0, t, baseY);
      const path = pretzelPath();
      const n = path.length;
      const pts: RopePt[] = [];
      const lift: number[] = [];
      path.forEach((q, i) => {
        const arm = twistArm(i, n);
        const [ux, uy] = pretzelU(q.f);
        const rU = q.r * 1.12;
        // 꼬기 동안 둘레는 U자 그대로 — 양 끝이 가운데로 당겨지며 위쪽이 좁아진다(사용자 요청: 꼬면서 미리 접혀 있지 않게)
        const [dx, dy] = pretzelDrop(i, n);
        let x: number;
        let y: number;
        let up = Math.max(0, q.zo);
        let rad = q.r;
        let dz = 0;
        if (step === 3) {
          // 곧은 줄 → U자 (참고 사진: 양 끝이 위로 나란히 올라간 U)
          x = lerp(((0.5 - q.f) * PZ_ROPE) / PZ_K, ux, e);
          y = lerp(0, uy, e);
          up = 0;
          rad = lerp(r0 / PZ_K, rU, e);
        } else if (step === 4) {
          // U자의 양 끝을 엇갈려 한 번(X자), 또 한 번 꼰다 — 아래 U자는 꼬인 만큼 당겨질 뿐 둥근 고리로 접히지 않는다
          const [tx, ty, tup] = pretzelTwisted(dx, dy, q, i, n, arm, e);
          const w = smooth(0, 0.5, e);
          x = lerp(ux, tx, w);
          y = lerp(uy, ty, w);
          up = lerp(tup * w, Math.max(0, q.zo), smooth(0.85, 1, e));
          rad = lerp(rU, lerp(q.r * 1.06, q.r, arm), w);
          dz = PZ_SHIFT * w;
        } else {
          // 꼬임을 경첩을 축으로 넘겨 U자 아래쪽에 내린다 — 그동안 U자가 둥근 고리로 펴진다
          const th = step === 5 ? Math.PI * e : Math.PI;
          const open = step === 5 ? ease(e) : 1;
          // 접히는 건 팔(꼬임 + 끝)뿐
          const mirrored = 2 * PZ_HINGE - q.y;
          x = lerp(lerp(dx, q.x, open), q.x, arm);
          y = lerp(lerp(dy, q.y, open), PZ_HINGE + (mirrored - PZ_HINGE) * Math.cos(th), arm);
          up = Math.max(0, q.zo) + arm * Math.abs(mirrored - PZ_HINGE) * Math.sin(th) * 0.8 * PZ_K;
          rad = lerp(lerp(q.r * 1.06, q.r, open), q.r, arm);
          dz = step === 5 ? PZ_SHIFT * (1 - e) : 0;
          // 끝은 U자 위에 얹혀 있다가 눌려 붙는다
          const tip = Math.max(smooth(2, 0, i / PZ_PER_SEG), smooth(n - 1 - 2 * PZ_PER_SEG, n - 1, i));
          if (step === 6) {
            up *= 1 + 0.35 * (1 - e) * tip;
            rad *= 1 + tip * lerp(-0.08, 0.05, e);
          } else {
            up *= 1 + 0.35 * tip;
            rad *= 1 - 0.08 * tip;
          }
        }
        pts.push([x * PZ_K, -y * PZ_K + dz, rad * PZ_K]);
        lift.push(up);
      });
      return [ropeGeometry(pts, baseY, { lift })];
    }
    case 'baguette': {
      const [rx, rz] = OVAL.baguette;
      const hx = rx * 0.96;
      const L0 = 2 * hx;
      if (step === 0) return [rolledOut(rx, rz, e, baseY)];
      if (step === 1) return [ovalSheet(rx, rz, baseY)];
      const third = (2 * rz) / 3;
      if (step === 2) {
        // 편지 접듯 — 앞쪽 3분의 1을 가운데로, 뒤쪽 3분의 1을 그 위로. 접으면서 타원의 둥근 끝이 반듯해진다
        const sq = smooth(0.1, 0.9, t);
        return [letterFold(rx, rz, t, baseY, SHEET_H, BAG_RB1, BAG_RB2, (f) => lerp(rx * Math.max(0.17, ovalProfile(2 * f - 1)), hx, sq))];
      }
      if (step === 3) {
        // 반으로 접고, 이음매를 붙이며 둥근 막대가 된다
        const y0 = baseY + BAG_PACK / 2;
        const ph = Math.PI * ease(Math.min(1, t / 0.6));
        const line: [number, number][] = [[-third / 2, y0], [0, y0], ...flap(0, 1, ph, Math.max(0, third / 2 - BAG_RB3 * ph), BAG_RB3, y0)];
        const packet = outlineOf(line, BAG_PACK);
        const k = smooth(0.6, 1, t);
        const r0 = ropeR(L0, BAG_VOL);
        const out = [extrudeOutline(hx, k > 0 ? toEllipse(packet, r0, baseY + 0.85 * r0, 0.85 * r0, k) : packet, baseY)];
        if (t > 0.5 && t < 0.92) {
          const seamY = baseY + BAG_PACK + 2 * BAG_RB3 - 0.002;
          out.push(scoreRibbon({ a: [-hx * 0.9, -third / 2 + 0.003], b: [hx * 0.9, -third / 2 + 0.003], y: () => seamY }, 0, 1, 0.0012));
        }
        return out;
      }
      // 왔다 갔다 굴려 길게 → 양 끝을 가늘게 → 칼집
      const stretch = step === 4 ? e : 1;
      const taper = step === 4 ? 0 : step === 5 ? e : 1;
      const len = lerp(L0, BAG_L, stretch);
      const r = ropeR(len, BAG_VOL);
      const rope = ropeGeometry(bent(len, 0, (u) => r * (1 - 0.45 * taper * (2 * u - 1) ** 4), 100), baseY);
      if (step < 6) return [rope];
      // 칼집 — 칼날이 지나간 자리에 날카로운 금만. 벌어지는 건 오븐에서(셰이더가 Blender 칼집을 서서히 연다)
      return [rope, ...scores(cutLines(bid, 6, baseY), opts.cuts)];
    }
    case 'pie': {
      if (step === 0) {
        // 반죽 전부를 크게 밀어 편다 — 틀에 깔고 남는 가장자리는 잘라 격자로 쓴다
        const R = lerp(R0, PIE_CRUST_R, e);
        return [slabGeometry(0, 0, () => R, lerp(BALL_H, 0.004, e), baseY)];
      }
      if (step === 1) {
        // 틀에서 잘라 낸 반죽(이미 한 덩이)을 다시 둥글게 민다
        const rH = R0 * 0.72;
        const R = lerp(rH, PIE_SHEET_R, e);
        return [slabGeometry(0, 0, () => R, lerp(rH * 0.78, 0.005, e), baseY)];
      }
      // 띠로 자른다 — 칼날이 지나간 자리에 금이 나고, 끝까지 자른 줄은 띠가 벌어진다
      const done = (opts.cuts ?? []).map((c) => !!c && c[1] - c[0] >= 0.999);
      const partial = (opts.cuts ?? []).map((c, i) => (done[i] ? null : c));
      return [...pieStrips(done, baseY), ...scores(cutLines(bid, 2, baseY), partial)];
    }
    default:
      return [ball([R0, BALL_H, R0], 0, 0, 0, baseY)];
  }
}

/** 둥근 판을 자른 줄(done[k])마다 나뉜 띠들 (가로로 긴 띠가 앞뒤로 늘어선다) */
export function pieStrips(done: readonly boolean[], baseY: number, cx = 0, cz = 0): THREE.BufferGeometry[] {
  const R = PIE_SHEET_R;
  const out: THREE.BufferGeometry[] = [];
  // 자른 자리는 정해져 있다(칼선) — 어느 줄부터 잘라도 된다
  const lines = Array.from({ length: PIE_STRIPS - 1 }, (_, k) => -R + ((2 * R) / PIE_STRIPS) * (k + 1)).filter((_, k) => done[k]);
  const edges = [-R, ...lines, R];
  const n = edges.length - 1;
  for (let i = 0; i < n; i++) {
    const z0 = edges[i];
    const z1 = edges[i + 1];
    const gap = 0.0025;
    const mid = (z0 + z1) / 2 + (i - (n - 1) / 2) * gap;
    // 원과 띠의 교집합 — 가운데 기준 외곽
    const pts: [number, number][] = [];
    const N = 24;
    for (let k = 0; k <= N; k++) {
      const z = lerp(z0 + 0.001, z1 - 0.001, k / N);
      pts.push([Math.sqrt(Math.max(0, R * R - z * z)), z - (z0 + z1) / 2]);
    }
    for (let k = N; k >= 0; k--) {
      const z = lerp(z0 + 0.001, z1 - 0.001, k / N);
      pts.push([-Math.sqrt(Math.max(0, R * R - z * z)), z - (z0 + z1) / 2]);
    }
    out.push(slabGeometry(cx, cz + mid, polyRadius(pts, 0.05), 0.005, baseY, undefined, 72, 10));
  }
  return out;
}

/** 다음 단계로 넘기는 마지막 모양 — 마지막 단계의 끝 */
export function formFinal(bid: BreadId, baseY: number): THREE.BufferGeometry[] {
  const all = (n: number) => Array.from({ length: n }, () => [0, 1] as [number, number]);
  const last = (FORMS[bid]?.length ?? 2) - 1;
  switch (bid) {
    case 'cookie':
      return formShape(bid, 1, 1, baseY, { press: Array(COOKIE_PIECES).fill(1) });
    case 'flatbread':
      return formShape(bid, last, 1, baseY, { press: Array(FLAT_PIECES).fill(1) });
    case 'baguette':
      return formShape(bid, last, 1, baseY, { cuts: all(BAGUETTE_SCORES.length) });
    case 'pie':
      // 크러스트로 깔 큰 판 하나 — 격자 띠는 pieStripsFinal
      return formShape(bid, 0, 1, baseY);
    default:
      return formShape(bid, last, 1, baseY);
  }
}

/** 토핑을 올리는 밀어 편 반죽들 — 토핑 알갱이의 자리를 여기서 정한다 (플랫브레드는 조각마다) */
export function toppingSheets(bid: BreadId, baseY: number): THREE.BufferGeometry[] {
  const i = FORMS[bid]?.findIndex((s) => s.gesture === 'toppings') ?? 0;
  const all = formShape(bid, i, 1, baseY, { stepAge: 1 });
  return bid === 'flatbread' ? all : all.slice(0, 1);
}

/**
 * 판 위의 토핑 (x, z)이 지금 단계에서 보이는 정도 0~1 — 말거나 접거나 감싸면 반죽 속으로 들어가 사라진다.
 * 토핑을 올리기 전 단계는 부르지 않는다. press는 하나씩 하는 몸짓의 조각마다 진행
 */
export function sheetCover(bid: BreadId, step: number, t: number, x: number, z: number, press?: readonly number[]): number {
  const before = (front: number) => smooth(-0.004, 0.004, front - z);
  switch (bid) {
    case 'shokupan': {
      const rz = OVAL.shokupan[1];
      return step < 2 ? 1 : before(lerp(rz, -rz, Math.min(1, ease(t) / SHOKU_ROLLED)));
    }
    case 'croissant': {
      const hz = CRO_SHEET[1];
      return step < CRO_ROLL_STEP ? 1 : step > CRO_ROLL_STEP ? 0 : before(lerp(hz, -hz, Math.min(1, ease(t) / CRO_ROLLED)));
    }
    case 'bagel': {
      // 가로로 돌려 놓은 판 — 앞뒤 반폭이 민 타원의 x 반폭
      const rx = OVAL.bagel[0];
      return step < 2 ? 1 : step > 2 ? 0 : before(lerp(rx, -rx, Math.min(1, ease(t) / BAGEL_ROLLED)));
    }
    case 'pretzel': {
      const rz = OVAL[bid][1];
      return step < 2 ? 1 : step > 2 ? 0 : before(lerp(rz, -rz, smooth(0, 0.4, t)));
    }
    case 'baguette': {
      if (step < 2) return 1;
      if (step > 2) return 0;
      const third = (2 * OVAL.baguette[1]) / 3;
      if (z > third / 2) return 1 - smooth(0.02, 0.22, t);
      if (z < -third / 2) return 1 - smooth(0.52, 0.72, t);
      return 1 - smooth(0.3, 0.48, t);
    }
    case 'flatbread': {
      if (step < 4) return 1;
      if (step > 4) return 0;
      // 그 자리의 조각을 오므린 만큼
      let best = 0;
      FLAT_SPOTS.forEach(([sx, sz], i) => {
        if (Math.hypot(x - sx, z - sz) < Math.hypot(x - FLAT_SPOTS[best][0], z - FLAT_SPOTS[best][1])) best = i;
      });
      return 1 - smooth(0.15, 0.7, press?.[best] ?? 0);
    }
    default:
      return 1;
  }
}

/** 파이 격자로 쓸 띠들 — 잘라 낸 반죽을 다시 밀어 자른 마지막 모양 */
export function pieStripsFinal(baseY: number): THREE.BufferGeometry[] {
  return formShape('pie', 2, 1, baseY, { cuts: Array.from({ length: PIE_STRIPS - 1 }, () => [0, 1] as [number, number]) });
}

// ---------------------------------------------------------------- 크루아상
/** Blender build_croissant의 중심선 (×1.45 트레이 크기, 날반죽이라 ×0.92) — 판 위 (x, z, 반지름), 가운데 맞춤 */
function croissantLine(u: number): [number, number, number] {
  const k = 1.45 * 0.92;
  const a = ((-38 + 256 * u) * Math.PI) / 180;
  const Rc = 0.05 * (1 - 0.28 * (2 * u - 1) ** 2);
  const r = 0.0055 + 0.03 * Math.sin(Math.PI * u) ** 0.7;
  return [Rc * Math.cos(a) * k, (-(Rc * Math.sin(a)) + 0.014) * k, r * k * 0.9];
}

// ---------------------------------------------------------------- 프레첼
// Blender build_pretzel과 같은 경로 — 끝(U자 아래쪽 5시·7시 자리) → 두 팔이 서로 감긴 꼬임 → 둘레 고리 → 반대쪽 꼬임 → 끝.
// (x, y)는 Blender 평면(y가 화면 위쪽), zo는 겹칠 때 들리는 높이(미터), r은 굵기. 트레이 크기(×1.4)의 날반죽(×0.95)
const PZ_K = 0.08 * 1.4 * 0.95;
/** 꼬임을 넘겨 접는 경첩의 y */
const PZ_HINGE = 0.29;
/** U자·꼬기 동안 판 가운데 오도록 앞으로 옮기는 양 */
const PZ_SHIFT = 0.03;
const PZ_PER_SEG = 3;

/** 모양 빚기에서 곧게 굴린 줄의 길이 — 1.5배 큰 판에 가로로 놓인다. U자·꼬기를 거치며 조금씩 더 늘어난다 */
const PZ_ROPE = 0.46;
/** U자: 아래 반원의 반지름 · 위로 올라간 팔의 길이 (경로 단위) — 판 안에 들어오는 크기 */
const PZ_UA = 0.95;
const PZ_UARM = 1.9;
/** 꼬임의 반지름(경로 단위)과 겹칠 때 들리는 높이(미터) — Blender build_pretzel의 R_tw */
const PZ_TW = 0.13;
const PZ_TW_UP = 0.13 * 0.08 * 0.95 * 1.33;

interface PzPoint {
  x: number;
  y: number;
  zo: number;
  r: number;
  /** 경로를 따라간 길이의 비율 0~1 */
  f: number;
}

let pretzelCache: PzPoint[] | null = null;

function pretzelPath(): PzPoint[] {
  if (pretzelCache) return pretzelCache;
  const twist = (phi0: number, upward: boolean): number[][] => {
    const out: number[][] = [];
    for (let k = 0; k <= 16; k++) {
      const t = upward ? k / 16 : 1 - k / 16;
      const ph = phi0 + 2 * Math.PI * t;
      out.push([0.13 * Math.cos(ph), lerp(-0.42, 0.2, t), 0.13 * 0.08 * Math.sin(ph) * 0.95 * 1.33, 0.11]);
    }
    return out;
  };
  const belly = 0.17 * 0.08 * 1.35 * 1.33;
  const ctrl: number[][] = [
    [0.56, -0.62, belly, 0.1],
    [0.36, -0.52, 0.008, 0.11],
    ...twist(0, true),
    [0.34, 0.38, 0, 0.13], [0.68, 0.6, 0, 0.14], [1.04, 0.47, 0, 0.15], [1.18, 0.06, 0, 0.155],
    [1.03, -0.38, 0, 0.165], [0.63, -0.69, 0, 0.17], [0, -0.81, 0, 0.175], [-0.63, -0.69, 0, 0.17],
    [-1.03, -0.38, 0, 0.165], [-1.18, 0.06, 0, 0.155], [-1.04, 0.47, 0, 0.15], [-0.68, 0.6, 0, 0.14],
    [-0.34, 0.38, 0, 0.13],
    ...twist(Math.PI, false),
    [-0.36, -0.52, 0.008, 0.11],
    [-0.56, -0.62, belly, 0.1],
  ];
  const segs = ctrl.length - 1;
  const out: PzPoint[] = [];
  for (let i = 0; i <= segs * PZ_PER_SEG; i++) {
    const f = i / PZ_PER_SEG;
    const k = Math.min(Math.floor(f), segs - 1);
    const u = f - k;
    const p0 = ctrl[Math.max(k - 1, 0)];
    const p1 = ctrl[k];
    const p2 = ctrl[k + 1];
    const p3 = ctrl[Math.min(k + 2, segs)];
    const c = (j: number) =>
      0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * u + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * u * u + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * u * u * u);
    out.push({ x: c(0), y: c(1), zo: c(2), r: c(3) * 0.88, f: 0 });
  }
  let len = 0;
  const acc = out.map((q, i) => (i ? (len += Math.hypot(q.x - out[i - 1].x, q.y - out[i - 1].y)) : 0));
  out.forEach((q, i) => (q.f = acc[i] / len));
  pretzelCache = out;
  return out;
}

/**
 * 경로의 i번째가 팔(꼬임 + 끝)인 정도 — 둘레는 0. 꼬임이 끝나는 자리(경로 18·32)에서 바로 둘레로 넘어간다:
 * 꼬임 밑동과 둘레 옆선 사이에 옆으로 꺾이는 마디가 생기지 않게(사용자 요청 — 참고 사진에 동그라미 친 자리)
 */
function twistArm(i: number, n: number): number {
  const s = (i / (n - 1)) * 50;
  return Math.max(smooth(18.2, 17.8, s), smooth(31.8, 32.2, s));
}

/** U자 — 가운데가 아래 반원, 양 끝이 위(뒤)로 나란히 올라가며 살짝 벌어진다. f = 줄을 따라간 비율 (0 = 오른쪽 끝) */
function pretzelU(f: number): [number, number] {
  const LU = Math.PI * PZ_UA + 2 * PZ_UARM;
  const h = (f - 0.5) * LU;
  const yb = -(PZ_UA + PZ_UARM) / 2;
  const qa = (Math.PI * PZ_UA) / 2;
  if (Math.abs(h) <= qa) {
    const ang = h / PZ_UA;
    return [-PZ_UA * Math.sin(ang), yb + PZ_UA * (1 - Math.cos(ang))];
  }
  const d = Math.abs(h) - qa;
  return [(h < 0 ? 1 : -1) * (PZ_UA + (0.1 * d * d) / PZ_UARM), yb + PZ_UA + d];
}

/**
 * 꼬임을 아직 넘겨 접지 않은 모양 — 둘레 고리 위로 두 팔이 tau만큼 꼬여 올라가 있다 (0 나란히, 0.5 한 번 엇갈린 X자, 1 두 번 꼬임).
 * [x, y, 겹쳐 들린 높이(미터)]
 */
function pretzelTwisted(bx: number, by: number, q: PzPoint, i: number, n: number, arm: number, tau: number): [number, number, number] {
  const s = (i / (n - 1)) * 50;
  const side = s <= 25 ? 1 : -1;
  const sm = s <= 25 ? s : 50 - s;
  // 다 꼬았을 때 이 자리의 꼬임 각 — 끝 쪽 0, 고리 쪽 2π
  const psi = sm < 2 ? 0 : sm > 18 ? 2 * Math.PI : (2 * Math.PI * (sm - 2)) / 16;
  const rho = sm < 2 || sm > 18 ? Math.abs(q.x) : PZ_TW;
  const ang = 2 * Math.PI - (2 * Math.PI - psi) * tau;
  // 엇갈리는 동안 끝은 엇갈린 줄을 따라 비스듬히 위로 뻗는다(참고 사진) — 다 꼬면(tau 1) 제자리로
  const tip = sm < 2 ? (1 - sm / 2) * Math.sin(Math.PI * Math.min(1, tau)) : 0;
  return [
    lerp(bx, side * rho * (1 - 0.3 * tip) * Math.cos(ang), arm),
    lerp(by, 2 * PZ_HINGE - q.y + 0.28 * tip, arm),
    arm * Math.max(0, side * PZ_TW_UP * Math.sin(ang)),
  ];
}

/**
 * 꼬는 동안의 둘레 — U자 그대로, 양 끝이 꼬임 쪽으로 당겨져 위가 좁은 물방울꼴(경로 단위). 꼬임을 아래로 넘기면(접기)
 * 이게 프레첼의 둥근 고리로 펴진다. 경로의 i번째 점이 둘레의 어디인지는 고리 구간(경로 19 ~ 31)의 비율로
 */
let dropCache: { pts: [number, number][]; acc: number[] } | null = null;
function pretzelDrop(i: number, n: number): [number, number] {
  if (!dropCache) {
    // 꼬임 밑동(0.13, 0.38)에서 곧게 내려와 — 옆선이 꺾이지 않고 그대로 엇갈린 팔로 이어진다(참고 사진, 사용자 요청)
    const half: [number, number][] = [[0.13, 0.38], [0.32, 0.02], [0.66, -0.42], [0.93, -0.86], [0.78, -1.22], [0.42, -1.39]];
    const ctrl: [number, number][] = [...half, [0, -1.42], ...half.map(([x, y]) => [-x, y] as [number, number]).reverse()];
    const pts: [number, number][] = [];
    const per = 16;
    for (let k = 0; k < ctrl.length - 1; k++) {
      const p0 = ctrl[Math.max(0, k - 1)];
      const p1 = ctrl[k];
      const p2 = ctrl[k + 1];
      const p3 = ctrl[Math.min(ctrl.length - 1, k + 2)];
      for (let j = 0; j < per; j++) {
        const u = j / per;
        const c = (a: number) =>
          0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * u + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * u * u + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * u * u * u);
        pts.push([c(0), c(1)]);
      }
    }
    pts.push(ctrl[ctrl.length - 1]);
    const acc = [0];
    for (let k = 1; k < pts.length; k++) acc.push(acc[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    dropCache = { pts, acc };
  }
  const { pts, acc } = dropCache;
  const g = Math.max(0, Math.min(1, ((i / (n - 1)) * 50 - 18) / 14));
  const L = g * acc[acc.length - 1];
  let k = 0;
  while (k < acc.length - 2 && acc[k + 1] < L) k++;
  const f = (L - acc[k]) / (acc[k + 1] - acc[k] || 1);
  return [lerp(pts[k][0], pts[k + 1][0], f), lerp(pts[k][1], pts[k + 1][1], f)];
}

// ---------------------------------------------------------------- 베이글
/** 베이글: 말아 붙인 통의 굵기(겉면 반지름) · 일정한 굵기로 늘인 줄의 굵기 (부피 그대로) */
const BAGEL_LOG_R = rollRadius(2 * OVAL.bagel[0], ROLL_H);
const BAGEL_R = BAGEL_LOG_R * Math.sqrt((2 * OVAL.bagel[1]) / BAGEL_L);
/** 다 감싸 이은 고리의 반지름 — Blender build_bagel과 같다(오븐이 이 모양 그대로 굽는다) */
export const BAGEL_RING_R = BAGEL_L / (2 * Math.PI * (1 + BAGEL_OVERLAP));
export const BAGEL_TUBE_R = BAGEL_R;
/** 넓적하게 누르는 끝 — 줄의 이 비율부터 끝까지 */
const bagelFlat = (u: number) => smooth(0.78, 0.95, u);
/** 감싼 끝(소매)이 안에 든 끝보다 굵은 만큼 */
const BAGEL_LIP = 0.035;
/** 감싼 끝의 가장자리 — 고리 둘레의 각(atan2(z, x)). 끝을 맞댄 뒤 BAGEL_OVERLAP만큼 더 감아 넘어간 자리(고리 뒤쪽에서 조금 비킨 곳) */
const BAGEL_SEAM_AT = -Math.PI / 2 - Math.PI * BAGEL_OVERLAP;

/**
 * 이음매에서 잰 각 거리 — 고리 둘레 각 th, 관의 높이 비율 s(-1 밑 ~ 1 꼭대기). 0보다 크면 감싼 끝이 덮은 쪽.
 * 가장자리는 관 꼭대기에서 혀처럼 조금 더 나와 둥근 선을 그린다(참고 사진). Blender build_bagel과 같은 식
 */
function bagelSeamD(th: number, s: number): number {
  const edge = BAGEL_SEAM_AT - 0.16 * Math.max(0, s) ** 0.8 + 0.05;
  const d = th - edge;
  return Math.atan2(Math.sin(d), Math.cos(d));
}
/** 이음매의 겉면 변위(반지름 비율) — 덮인 쪽은 살짝 도톰한 턱, 가장자리에는 옅은 골 (튀어나오지 않게 작게) */
function bagelSeamDisp(d: number): number {
  const lip = d > 0 ? BAGEL_LIP * smooth(0, 0.04, d) * (1 - smooth(0.6, 1.1, d)) : 0;
  return lip - 0.05 * Math.exp(-((d / 0.035) ** 2));
}

/** 다 감싸 이은 고리 — 감싼 끝의 가장자리가 관을 둘러 옅은 접힌 선으로 남는다(사용자 요청, 참고 사진) */
function bagelRing(baseY: number): THREE.BufferGeometry {
  const n = 160;
  const pts: RopePt[] = Array.from({ length: n }, (_, i) => {
    const th = (2 * Math.PI * i) / n;
    return [BAGEL_RING_R * Math.cos(th), BAGEL_RING_R * Math.sin(th), BAGEL_R];
  });
  const cy = baseY + BAGEL_R * 0.78;
  const sOf = (y: number) => Math.max(-1, Math.min(1, (y - cy) / (BAGEL_R * 0.92)));
  const g = ropeGeometry(pts, baseY, {
    closed: true,
    nseg: 40,
    disp: (_i, _th, p) => BAGEL_R * bagelSeamDisp(bagelSeamD(Math.atan2(p.z, p.x), sOf(p.y))),
  });
  // 가장자리의 골은 조금 어둡게 — 옅은 선
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const d = bagelSeamD(Math.atan2(pos.getZ(i), pos.getX(i)), sOf(pos.getY(i)));
    const k = 0.16 * Math.exp(-((d / 0.03) ** 2));
    col.set([1 - k, 1 - k * 1.15, 1 - k * 1.3], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ---------------------------------------------------------------- 플랫브레드 둥글리기
/** 조각마다의 구(재료 자리)와 그 자리의 반죽 결(노이즈) — 굴리면 결이 같이 돈다 */
const roundCache: { dirs: Float32Array; n1: Float32Array; n2: Float32Array; index: THREE.BufferAttribute }[] = [];
/**
 * 4분의 1 조각(qR, 가운데 c)을 공처럼 굴려 둥글리는 중 — k 0(나눈 조각) ~ 1(동그란 덩이). quat은 굴러간 자세:
 * 반죽의 각 자리가 그만큼 돌아간 방향의 겉면에 놓인다(밑면은 판에 눌려 평평). 굴리는 동안 겉이 조금 울퉁불퉁해졌다 매끈해진다
 */
function roundingPiece(i: number, k: number, qR: (a: number) => number, c: [number, number], quat: [number, number, number, number] | undefined, baseY: number): THREE.BufferGeometry {
  let rc = roundCache[i];
  if (!rc) {
    const sph = new THREE.SphereGeometry(1, 40, 26);
    const pos = sph.getAttribute('position');
    const dirs = new Float32Array(pos.array as Float32Array);
    const n1 = new Float32Array(pos.count);
    const n2 = new Float32Array(pos.count);
    const seed = 2 + i * 1.7;
    for (let v = 0; v < pos.count; v++) {
      const [x, y, z] = [dirs[v * 3], dirs[v * 3 + 1], dirs[v * 3 + 2]];
      n1[v] = noise3(x * 2.2 + seed, y * 2.2, z * 2.2);
      n2[v] = noise3(x * 5.5 + seed + 3, y * 5.5, z * 5.5);
    }
    rc = roundCache[i] = { dirs, n1, n2, index: sph.getIndex()! };
  }
  const q = quat ? new THREE.Quaternion(...quat) : new THREE.Quaternion();
  const H = lerp(FLAT_DOME_H, FLAT_BALL_H, k);
  const ek = lerp(FLAT_DOME_K, 2, k);
  const rough = 0.32 * Math.sin(Math.PI * Math.min(1, k * 1.15)) ** 0.6;
  const n = rc.n1.length;
  const V = new Float32Array(n * 3);
  const d = new THREE.Vector3();
  const mid = H * 0.4;
  for (let v = 0; v < n; v++) {
    d.set(rc.dirs[v * 3], rc.dirs[v * 3 + 1], rc.dirs[v * 3 + 2]).applyQuaternion(q);
    const a = Math.atan2(d.z, d.x);
    const rho = Math.min(1, Math.hypot(d.x, d.z));
    const rr = rho * lerp(qR(a), FLAT_BALL_R, k);
    let y = d.y >= 0 ? H * Math.sqrt(Math.max(0, 1 - rho ** ek)) : 0;
    const lump = 1 + rough * (0.17 * rc.n1[v] + 0.06 * rc.n2[v]);
    y = Math.max(0, mid + (y - mid) * lump);
    V[v * 3] = c[0] + Math.cos(a) * rr * lump;
    V[v * 3 + 1] = baseY + y;
    V[v * 3 + 2] = c[1] + Math.sin(a) * rr * lump;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(V, 3));
  g.setIndex(rc.index.clone());
  g.computeVertexNormals();
  return g;
}

/** 플랫브레드를 넷으로 나눈 조각 i — 4분의 1 원. 무게 중심 c와 거기서 잰 가장자리까지의 거리 R(θ) */
const quarterCache: { c: [number, number]; R: (a: number) => number }[] = [];
function flatQuarter(i: number): { c: [number, number]; R: (a: number) => number } {
  if (quarterCache[i]) return quarterCache[i];
  const sx = Math.sign(FLAT_SPOTS[i][0]);
  const sz = Math.sign(FLAT_SPOTS[i][1]);
  const k = 0.42 * R0;
  const gap = 0.004;
  const poly: [number, number][] = [[-sx * k, -sz * k]];
  for (let j = 0; j <= 16; j++) {
    const a = ((Math.PI / 2) * j) / 16;
    poly.push([sx * (R0 * Math.cos(a) - k), sz * (R0 * Math.sin(a) - k)]);
  }
  return (quarterCache[i] = { c: [sx * (k + gap), sz * (k + gap)], R: polyRadius(poly, 0.12) });
}

/** 나중에 지나가는 팔이 꼬인 자리에서 위로 넘어가도록 — 뒤쪽 절반을 겹친 곳에서 들어 올린다 */
function crossLift(pts: readonly RopePt[], r: number): number[] {
  const n = pts.length;
  return pts.map(([x, z], i) => {
    let lift = 0;
    if (i > n / 2) {
      for (let j = 0; j < n / 2; j++) {
        if (Math.abs(i - j) < n / 6) continue;
        const d = Math.hypot(x - pts[j][0], z - pts[j][1]);
        if (d < 2.2 * r) lift = Math.max(lift, r * 1.05 * (1 - d / (2.2 * r)) ** 1.5);
      }
    }
    return lift;
  });
}
