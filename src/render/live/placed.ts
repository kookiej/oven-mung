// 틀·트레이에 넣은 반죽 — 틀에 넣기 단계(mold)가 모션으로 만들고, 토핑 올리기 단계(shaping)가 다 넣은 모습을 그대로 쓴다.
// 모양 빚기에서 빚은 반죽은 납작하게 누르지 않고 그대로 담는다(식빵 통 반죽은 통 모양 그대로 식빵틀 바닥에).
// 무대(배경 그림·카메라·그릇 가림막)는 stage/<stageOf(def)>.
import * as THREE from 'three';
import type { BreadDef, DoughLayout, ToppingId } from '../../types';
import { placedToppings } from '../../content/toppings';
import { mixHex } from '../../util';
import { META, type PourCell, type StageMeta } from '../sprites';
import { pooledGeometry, ropeGeometry, slabGeometry, squarePoolGeometry, type RopePt, type WallTable } from './geo';
import { COOKIE_SPOTS, FLAT_SPOTS, formFinal, pieStripsFinal } from './formShapes';

/** 이 빵의 틀·트레이 무대 이름 — 트레이 빵은 앞에 반죽 판, 뒤에 트레이가 함께 있는 무대 */
export function stageOf(def: BreadDef): string {
  return def.vessel === 'tray' ? 'mold_tray' : `mold_${def.id}`;
}

export function stageMeta(def: BreadDef): StageMeta {
  return META.stage[stageOf(def)] ?? {};
}

// ---------------------------------------------------------------- 붓는 칸
/** 칸 하나에 높이 level까지 고인 반죽 (칸 가운데로 옮겨 둔 지오메트리) */
export function cellGeometry(cell: PourCell, level: number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (cell.kind === 'square') g = squarePoolGeometry(cell.half ?? 0.05, cell.floorY + 0.0003, level);
  else {
    const flute = cell.kind === 'tart' ? (th: number) => 0.0032 * Math.cos(34 * th) - 0.0032 : undefined;
    g = pooledGeometry(cell.wall as WallTable, cell.floorY + 0.0003, level, {
      inner: cell.inner as WallTable | undefined,
      flute,
      meniscus: 0.0012,
    });
  }
  g.translate(cell.center[0], 0, cell.center[1]);
  return g;
}

/** 이만큼 부으면 칸 바닥이 끝까지 덮인다 — 그 뒤로는 높이만 오른다 */
export const COVER = 0.3;

/** 부은 양 f(0~1)의 반죽 높이 — 바닥을 덮는 얇은 층 → 가득 */
export function fillLevel(cell: PourCell, f: number): number {
  const thin = cell.floorY + 0.0018;
  return f < COVER ? thin : thin + (cell.fullY - thin) * ((f - COVER) / (1 - COVER));
}

/** 칸의 반지름 — 손가락으로 칸을 고를 때 */
export function cellRadius(cell: PourCell): number {
  if (cell.kind === 'square') return (cell.half ?? 0.05) * 1.2;
  const w = cell.wall!;
  return w[w.length - 1][1];
}

/** 칸 안쪽으로 끌어들인 붓는 자리 */
export function clampToCell(cell: PourCell, x: number, z: number): [number, number] {
  const dx = x - cell.center[0];
  const dz = z - cell.center[1];
  if (cell.kind === 'square') {
    const h = (cell.half ?? 0.05) * 0.8;
    return [cell.center[0] + Math.max(-h, Math.min(h, dx)), cell.center[1] + Math.max(-h, Math.min(h, dz))];
  }
  const w = cell.wall!;
  const rOut = w[w.length - 1][1] * 0.8;
  const rIn = cell.inner ? cell.inner[cell.inner.length - 1][1] * 1.3 : 0;
  let d = Math.hypot(dx, dz);
  if (d < 1e-6) {
    if (!rIn) return [cell.center[0], cell.center[1]];
    d = 1e-6;
  }
  const k = Math.max(rIn, Math.min(rOut, d)) / d;
  return [cell.center[0] + dx * k, cell.center[1] + dz * (cell.inner ? k : Math.min(1, k))];
}

// ---------------------------------------------------------------- 파이
/** 바닥 크러스트 — 타르트팬 안쪽(바닥·주름진 옆벽)을 따라 깔린 얇은 반죽 판 (render_cartoon.build_pie와 같은 모양) */
export function pieCrustGeometry(sm: StageMeta, thick = 0.0045): THREE.BufferGeometry {
  const wall = sm.wall as WallTable;
  const floorY = (sm.floorY ?? 0.0022) + 0.0003;
  const rimY = (sm.rimY ?? 0.026) + 0.0004;
  const prof: THREE.Vector2[] = [];
  // 바깥 면: 가운데 바닥 → 벽을 따라 위로
  prof.push(new THREE.Vector2(0, floorY));
  for (const [y, r] of wall) if (y <= rimY) prof.push(new THREE.Vector2(r - 0.0004, Math.max(floorY, y)));
  prof.push(new THREE.Vector2(wall[wall.length - 1][1] - 0.0004, rimY));
  // 위쪽 둥근 테
  prof.push(new THREE.Vector2(wall[wall.length - 1][1] - thick * 0.5, rimY + thick * 0.4));
  // 안쪽 면: 벽을 따라 아래로 → 가운데
  for (let i = wall.length - 1; i >= 0; i--) {
    const [y, r] = wall[i];
    if (y > rimY) continue;
    prof.push(new THREE.Vector2(r - thick, Math.max(floorY + thick, y)));
  }
  prof.push(new THREE.Vector2(0, floorY + thick));
  const g = new THREE.LatheGeometry(prof, 120);
  // 타르트팬의 주름
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 0.09 || pos.getY(i) < floorY + 0.002) continue;
    const k = (r + 0.0032 * Math.cos(34 * Math.atan2(z, x)) - 0.0006) / r;
    pos.setXYZ(i, x * k, pos.getY(i), z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** 파이 틀 가장자리 위로 남은 반죽 — 조각 하나(각도 a0~a1). 틀 테두리에서 바깥으로 늘어져 있다. 칼로 둘러 잘라 낸다 */
export function pieOverhangSector(sm: StageMeta, a0: number, a1: number): THREE.BufferGeometry {
  const rimY = (sm.rimY ?? 0.026) + 0.0015;
  const wall = sm.wall as WallTable;
  const r0 = wall[wall.length - 1][1] - 0.008;
  const r1 = r0 + 0.034;
  const nr = 5;
  const nt = 4;
  const V: number[] = [];
  const idx: number[] = [];
  const thick = 0.0032;
  for (const up of [1, 0]) {
    for (let j = 0; j <= nr; j++) {
      for (let i = 0; i <= nt; i++) {
        const a = a0 + ((a1 - a0) * i) / nt;
        const k = j / nr;
        const wob = 0.0035 * Math.sin(a * 7 + 1.3) + 0.002 * Math.sin(a * 17);
        const r = r0 + (r1 + wob - r0) * k;
        const y = rimY - 0.012 * k * k + (up ? thick : 0);
        V.push(Math.cos(a) * r, y, Math.sin(a) * r);
      }
    }
  }
  const row = nt + 1;
  const layer = (nr + 1) * row;
  for (let j = 0; j < nr; j++) {
    for (let i = 0; i < nt; i++) {
      const q = j * row + i;
      idx.push(q, q + row, q + 1, q + 1, q + row, q + row + 1);
      const w = q + layer;
      idx.push(w, w + 1, w + row, w + 1, w + row + 1, w + row);
    }
  }
  // 바깥 가장자리
  for (let i = 0; i < nt; i++) {
    const a = nr * row + i;
    const b2 = a + layer;
    idx.push(a, b2, a + 1, a + 1, b2, b2 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 필링 — 크러스트 안에 소복이, 가운데가 봉긋 (render_cartoon.build_pie의 필링) */
export function pieFillingGeometry(cell: PourCell): THREE.BufferGeometry {
  const g = cellGeometry(cell, cell.fullY);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const R = cellRadius(cell);
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < cell.fullY - 1e-4) continue;
    const q = Math.min(1, Math.hypot(pos.getX(i), pos.getZ(i)) / R);
    pos.setY(i, pos.getY(i) + 0.006 * (1 - q * q));
  }
  g.computeVertexNormals();
  return g;
}

/** 토핑 없는 파이 — 필링 없이 속이 빈 크러스트로 굽는다(사용자 요청). 오븐·꺼내기는 GLB의 필링을 빼고, 도감은 필링 없는 그림 */
export function pieHollow(def: BreadDef, ids: readonly ToppingId[]): boolean {
  return def.id === 'pie' && placedToppings(ids).length === 0;
}

/** 필링 색 — 고른 토핑이 곧 필링이다 (토핑이 없으면 필링이 없지만, 색은 사과 필링으로 둔다) */
export function pieFillingColor(ids: readonly ToppingId[]): string {
  const apple = '#d08a3a';
  // 반죽에 섞는 가루와 구운 뒤에 뿌리는 슈가파우더는 필링이 아니다
  const cols = placedToppings(ids).map((t) => t.color);
  if (!cols.length) return apple;
  return cols.length > 1 ? mixHex(cols[0], cols[1], 0.5) : mixHex(cols[0], apple, 0.25);
}

/** 격자 띠의 자리·폭·높이 — render_cartoon.build_pie의 격자와 같다 (오븐이 이 격자 그대로 굽는다) */
const LATTICE_POS = [-0.079, -0.0474, -0.0158, 0.0158, 0.0474, 0.079];
const LATTICE_W = 0.0188;
const LATTICE_T = 0.0047;

/** 엮은 격자 — 가로·세로 띠가 번갈아 위아래로 지나간다 */
export function pieLatticeGeometries(): THREE.BufferGeometry[] {
  const Rl = 0.1;
  const sp = 0.0316;
  const out: THREE.BufferGeometry[] = [];
  for (const axis of [0, 1]) {
    LATTICE_POS.forEach((c, k) => {
      const Lh = Math.sqrt(Math.max(Rl * Rl - c * c, 0));
      // 띠 하나를 넓적한 판으로 — 길이 방향으로 물결쳐 다른 띠 위아래로 엮인다
      const g = new THREE.BoxGeometry(Lh * 2, LATTICE_T, LATTICE_W, 48, 1, 2);
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const s = p.getX(i);
        const weave = Math.cos((Math.PI * (s - LATTICE_POS[0])) / sp) * (k % 2 ? -1 : 1) * (axis ? -1 : 1);
        const dome = 0.007 * (1 - (s * s + c * c) / 0.104 ** 2);
        p.setY(i, p.getY(i) + 0.0215 + dome + 0.0029 * weave);
      }
      if (axis === 0) g.translate(0, 0, c);
      else {
        g.rotateY(Math.PI / 2);
        g.translate(c, 0, 0);
      }
      g.computeVertexNormals();
      out.push(g);
    });
  }
  return out;
}

/** 테두리 — 격자 끝을 눌러 붙인 둥근 띠 (render_cartoon.build_pie의 테두리) */
export function pieRimGeometry(): THREE.BufferGeometry {
  const n = 240;
  const r = 0.0074;
  const y0 = 0.026 + 0.0012;
  const pts: RopePt[] = Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    const R = 0.1032 + 0.0032 * Math.cos(34 * a);
    return [Math.cos(a) * R, Math.sin(a) * R, r];
  });
  return ropeGeometry(pts, y0 - r * 0.78, { closed: true, nseg: 14 });
}

// ---------------------------------------------------------------- 트레이·식빵틀의 반죽
export interface Piece {
  /** 가운데가 원점(바닥 높이 0)인 지오메트리 */
  geo: THREE.BufferGeometry;
  /** 빚기 판에서의 자리 (x, z) — 함께 끌고 다닐 때 상대 위치 */
  offset: [number, number];
}

/** 여러 조각으로 빚는 빵의 판 위 자리 (쿠키 6개, 플랫브레드 4개) — 한 덩이 빵이면 null */
export function pieceSpots(def: BreadDef): [number, number][] | null {
  return def.id === 'cookie' ? COOKIE_SPOTS : def.id === 'flatbread' ? FLAT_SPOTS : null;
}

/** 모양 빚기의 마지막 모양을 조각별로 — 가운데를 원점으로 옮겨 둔다 */
export function formedPieces(def: BreadDef): Piece[] {
  const geos = formFinal(def.id, 0);
  const spots = pieceSpots(def);
  if (spots) {
    return geos.map((g, i) => {
      g.translate(-spots[i][0], 0, -spots[i][1]);
      return { geo: g, offset: spots[i] };
    });
  }
  // 나머지는 한 덩이 — 모든 지오메트리를 한 조각으로. 가로·앞뒤 상자 가운데를 원점에: 오븐 GLB도 트레이 가운데에 상자 가운데를 맞춰 두어서,
  // 어긋나면 굽기 시작할 때 정점이 엉뚱한 반죽 겉면에 붙어 반죽이 뭉개지고 트레이에 묻힌 듯 보인다(프레첼)
  const geo = mergeAll(geos);
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  geo.translate(-(b.min.x + b.max.x) / 2, 0, -(b.min.z + b.max.z) / 2);
  return [{ geo, offset: [0, 0] }];
}

/** 여러 지오메트리를 하나로 — 정점 색(칼집 금)도 같이 */
function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  if (geos.length === 1) return geos[0];
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const g of geos) {
    const p = g.getAttribute('position').array as ArrayLike<number>;
    const c = g.getAttribute('color')?.array as ArrayLike<number> | undefined;
    const base = pos.length / 3;
    for (let i = 0; i < p.length; i++) {
      pos.push(p[i]);
      col.push(c ? c[i] : 1);
    }
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(base + ix.getX(i));
    else for (let i = 0; i < p.length / 3; i++) idx.push(base + i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

/** 파이 격자로 얹을 띠들 — 한 묶음으로 옮긴다 */
export function pieStripPieces(): Piece[] {
  return pieStripsFinal(0).map((geo) => ({ geo, offset: [0, 0] as [number, number] }));
}

/** 트레이에서 조각이 놓일 자리 — 쿠키는 정해진 6자리, 플랫브레드는 4자리(오븐 GLB의 자리와 같다), 나머지는 트레이 가운데 */
export function traySpots(def: BreadDef): [number, number, number][] {
  const sm = META.stage.mold_tray ?? {};
  const top = sm.topY ?? 0.0009;
  const c = sm.center ?? [0, 0];
  if (def.id === 'cookie') return (sm.spots ?? COOKIE_SPOTS.map(([x, z]) => [x + c[0], top, z + c[1]])) as [number, number, number][];
  if (def.id === 'flatbread') return FLAT_SPOTS.map(([x, z]) => [x + c[0], top, z + c[1]]);
  return [[c[0], top, c[1]]];
}

/** 트레이 무대 앞쪽 반죽 판에서 조각이 놓인 자리 — 모양 빚기 판에서의 자리 그대로 */
export function boardSpots(def: BreadDef): [number, number, number][] {
  const sm = META.stage.mold_tray ?? {};
  const top = sm.boardTop ?? 0.022;
  const c = sm.boardCenter ?? [0, 0.128];
  return formedPieces(def).map((p) => [c[0] + p.offset[0], top, c[1] + p.offset[1]]);
}

export { slabGeometry };

// ---------------------------------------------------------------- 같은 반죽 오브젝트
/** 반죽 한 조각 — 토핑 화면이 그대로 보여 주고, 오븐·꺼내기가 이 모습에서 시작한다 */
export interface DoughSpec {
  geo: THREE.BufferGeometry;
  /** 놓인 자리 (무대 좌표) */
  at: THREE.Vector3;
  /** 토핑 알갱이가 얹히는 면인지 */
  surface: boolean;
  /** 재질 — dough 빚은 반죽(정점 색), crust 크러스트, filling 필링, batter 부은 반죽 */
  kind: 'dough' | 'crust' | 'filling' | 'batter';
}

/** 토핑 화면의 반죽 — 트레이 빵은 앞쪽 반죽 판 위(빚은 자리), 틀 빵은 틀 속에 넣은 모습(부은 양 그대로) */
export function doughSpecs(def: BreadDef, layout?: DoughLayout): DoughSpec[] {
  const sm = stageMeta(def);
  if (def.vessel === 'tray') {
    const spots = boardSpots(def);
    return formedPieces(def).map((p, i) => ({ geo: p.geo, at: new THREE.Vector3(...spots[i]), surface: true, kind: 'dough' }));
  }
  if (def.id === 'shokupan') {
    return [{ geo: formedPieces(def)[0].geo, at: new THREE.Vector3(0, (sm.floorY ?? 0.0008) + 0.0004, 0), surface: true, kind: 'dough' }];
  }
  if (def.id === 'pie') {
    const out: DoughSpec[] = [{ geo: pieCrustGeometry(sm), at: new THREE.Vector3(), surface: false, kind: 'crust' }];
    const cell = sm.cells?.[0];
    if (cell) out.push({ geo: pieFillingGeometry(cell), at: new THREE.Vector3(), surface: true, kind: 'filling' });
    return out;
  }
  return (sm.cells ?? []).map((cell, i) => ({
    geo: cellGeometry(cell, fillLevel(cell, layout?.fills?.[i] ?? 1)),
    at: new THREE.Vector3(),
    surface: true,
    kind: 'batter' as const,
  }));
}

/** 트레이 위 기본 자리 (트레이 가운데 기준) — 틀에 넣기를 거치지 않았을 때 */
export function defaultPlaced(def: BreadDef): [number, number][] {
  const c = stageMeta(def).center ?? [0, 0];
  return traySpots(def).map(([x, , z]) => [x - c[0], z - c[1]]);
}

/**
 * 오븐이 시작할 반죽 — GLB와 같은 좌표(그릇 기준 미터). 트레이 빵은 놓은 자리에, 틀 빵은 틀 속에.
 * 파이는 크러스트 + 격자 + 테두리(필링은 GLB 그대로라 뺀다)
 */
export function bakeStartSurfaces(def: BreadDef, layout?: DoughLayout): THREE.BufferGeometry[] {
  const toWorld = (g: THREE.BufferGeometry, at: THREE.Vector3) => {
    const c = g.clone();
    c.translate(at.x, at.y, at.z);
    if (!c.getAttribute('normal')) c.computeVertexNormals();
    return c;
  };
  if (def.vessel === 'tray') {
    const sm = stageMeta(def);
    const placed = layout?.placed ?? defaultPlaced(def);
    return formedPieces(def).map((p, i) => {
      const q = placed[Math.min(i, placed.length - 1)];
      return toWorld(p.geo, new THREE.Vector3(q[0], sm.topY ?? 0.0009, q[1]));
    });
  }
  if (def.id === 'pie') {
    const sm = stageMeta(def);
    const o = new THREE.Vector3();
    return [pieCrustGeometry(sm), ...pieLatticeGeometries(), pieRimGeometry()].map((g) => toWorld(g, o));
  }
  return doughSpecs(def, layout).map((d) => toWorld(d.geo, d.at));
}
