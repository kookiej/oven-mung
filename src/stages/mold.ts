// 틀·트레이에 넣기 — 반죽(과 모양 빚기)을 마친 뒤 모든 빵이 거치는 단계.
// 그릇·트레이는 Blender로 렌더한 그림, 반죽은 실시간 3D(render/live) — 그림의 카메라 그대로라 그릇 안에 담긴다.
//   붓기(pour)  — 화면을 누른 자리의 칸에, 누른 자리로 반죽이 흘러든다. 손가락을 따라 줄기가 움직이고, 반죽은
//                 떨어진 자리에서 번져 칸 바닥을 덮은 뒤 차오른다 — 번지기·차오르기 모두 처음엔 빠르고 점점 느려진다
//                 (지수적으로 다가감). 다른 칸으로 저절로 넘어가지 않는다.
//   담기(식빵)  — 돌돌 만 반죽을 끌어다 식빵틀 위에서 놓으면 툭 떨어져 바닥에 앉는다. 통 모양 그대로(누르지 않는다).
//   올리기(트레이) — 앞쪽 반죽 판에 토핑까지 올린 반죽이 있다. 하나씩 끌어다 트레이에 놓으면
//                 내려앉는다 — 쿠키는 놓은 자리에서 가장 가까운 빈 자리로. 다 옮기면 오븐에 넣는다.
//   파이        — 밀어 편 판을 담으면 틀을 따라 깔리고 가장자리가 틀 밖으로 늘어진다 → 칼로 테두리(점선)를 둘러 자른다.
//                 잘린 반죽은 부서지지 않고 한 고리로 틀 둘레에 내려앉는다(사용자 요청) →
//                 (토핑을 필링으로 올리고, 잘라 낸 반죽을 밀어 띠로 자른 뒤 phase: 'lattice'로 돌아와) 띠를 얹으면 격자로 엮인다.
// 전략 없음: 얼마나 붓든 어디에 놓든 결과는 같다.
import * as THREE from 'three';
import type { StageCtx } from '../main';
import { confirmSheet, el } from '../ui';
import { BREADS, getBread } from '../content/breads';
import { moldTitle, usesVessel, VESSELS } from '../content/vessels';
import { META, loadSprites, ready, sprite, type PourCell } from '../render/sprites';
import { StageView } from '../render/live/stageView';
import { batterMaterial, doughMaterial, toonColor } from '../render/live/materials';
import { PourStream } from '../render/live/geo';
import { tintedBread } from '../content/toppings';
import {
  cellGeometry,
  cellRadius,
  clampToCell,
  fillLevel,
  formedPieces,
  pieCrustGeometry,
  pieLatticeGeometries,
  pieOverhangSector,
  pieRimGeometry,
  pieStripPieces,
  COVER,
  stageMeta,
  stageOf,
  traySpots,
  type Piece,
} from '../render/live/placed';
import { ToppingScene, type PieceNode } from '../render/live/toppingScene';
import { needsPutting, startBake } from './shaping';
import { hapticThud, hapticTick } from '../native';
import { clamp, lerp, smoothstep } from '../util';
import type { BreadDef, BreadId, ToppingId } from '../types';

/** 초당 차오르는 양 — 칸 하나가 3초 남짓이면 가득 */
const POUR_RATE = 0.35;
/** 칸마다 이만큼 차야 다음으로 넘어갈 수 있다 */
const ENOUGH = 0.6;
/** 붓는 자리에서 번지는 빠르기 — 남은 거리의 이 비율씩(초당, 지수적으로 다가감) */
const SPREAD_K = 2.6;
/** 고인 높이가 부은 양을 따라 차오르는 빠르기 (초당, 지수적으로) */
const FILL_K = 3;
/** 볼이 기울어 반죽이 흘러나오기 시작하는 기울기 */
const POUR_TILT = 0.55;
const RIPPLE_SEC = 1.1;
/** 파이 틀 밖으로 늘어진 반죽을 나눈 구간 수 — 칼이 지나간 구간에 금이 난다 */
const TRIM_SECTORS = 56;
/** 이만큼 둘러 자르면 나머지도 잘린 것으로 */
const TRIM_DONE = 0.9;
/** 빵칼 그림은 1.5배 큰 모양 빚기 판의 카메라로 렌더했다 — 다른 무대에선 이만큼 키워 그린다 */
export const KNIFE_SCALE = 1.43;
/** 파이 틀 무대는 틀보다 큰 반죽 판이 들어오게 카메라를 물려 렌더했다(render_game.py의 PIE_MARGIN 1.5, 다른 무대 1.1) — 빵칼도 그만큼 작게 */
const PIE_KNIFE_SCALE = (KNIFE_SCALE * 1.1) / 1.5;

export function mountMold(root: HTMLElement, ctx: StageCtx, data?: unknown): () => void {
  const d = data as { breadId?: BreadId; roughness?: number; toppingIds?: ToppingId[]; seed?: number; phase?: 'lattice' } | undefined;
  if (!d?.breadId || !BREADS.some((b) => b.id === d.breadId)) {
    ctx.go('choose');
    return () => {};
  }
  const def = getBread(d.breadId);
  // 앞에서 고른 토핑·seed 그대로 오븐까지
  const toppingIds = d.toppingIds ?? [];
  const seed = d.seed ?? Math.random() * 100;
  const next = { breadId: def.id, roughness: d.roughness ?? 0.3, toppingIds, seed };
  /** 틀에 넣은 다음 토핑 올리기를 거치는지 */
  const putNext = needsPutting(def, toppingIds);
  const doughColor = tintedBread(def, toppingIds).doughColor;
  const mode: 'pour' | 'shokupan' | 'tray' | 'pie' = !usesVessel(def)
    ? 'tray'
    : def.id === 'shokupan'
      ? 'shokupan'
      : def.id === 'pie'
        ? 'pie'
        : 'pour';
  const vesselName = VESSELS[def.vessel].name;
  /** 파이의 두 번째 방문 — 필링을 올린 뒤 격자를 얹는다 */
  const latticePhase = mode === 'pie' && d.phase === 'lattice';
  void loadSprites(['tool/pour_bowl', 'tool/knife']);
  // 토핑 없는 파이는 필링 없이 속이 빈 채로 — 테두리를 자르면 곧장 격자 띠를 만든다(사용자 요청)
  const nextLabel =
    mode === 'pie' && !latticePhase ? (putNext ? '필링 올리러 가기' : '격자 띠 만들기 →') : mode === 'tray' || latticePhase || !putNext ? '오븐에 넣기 🔥' : '토핑 올리러 가기';

  const view = el(`
    <div class="mold-view">
      <div class="stage-header">
        <button class="btn btn-ghost" data-back>←</button>
        <span class="stage-title">${def.emoji} ${latticePhase ? '격자 얹기' : moldTitle(def)}</span>
        <span></span>
      </div>
      <div data-stage class="stage-slot"></div>
      <p class="hint" data-hint></p>
      <button class="btn btn-primary btn-big mold-next" data-next disabled>${nextLabel}</button>
    </div>
  `);
  root.appendChild(view);
  const sv = new StageView(stageOf(def), 0.56);
  view.querySelector('[data-stage]')!.replaceWith(sv.el);
  const hint = view.querySelector<HTMLElement>('[data-hint]')!;
  const nextBtn = view.querySelector<HTMLButtonElement>('[data-next]')!;
  const sm = stageMeta(def);

  let disposed = false;
  let raf = 0;
  let clock = 0;
  const ready_ = () => (nextBtn.disabled = false);

  // ================================================================ 붓기 (묽은 반죽)
  const cells: PourCell[] = mode === 'pour' ? (sm.cells ?? []) : [];
  interface CellState {
    fill: number;
    mesh: THREE.Mesh | null;
    mat: ReturnType<typeof batterMaterial>;
    origin: [number, number] | null;
    /** 지금 만들어 둔 메시의 높이 */
    level: number;
    /** 보이는 높이 — 부은 양의 높이를 지수적으로 따라간다 */
    shownLevel: number;
    /** 붓는 자리에서 번진 반지름 */
    spread: number;
  }
  const pourColor = doughColor;
  const cellState: CellState[] = cells.map((c) => ({
    fill: 0,
    mesh: null,
    mat: batterMaterial(pourColor),
    origin: null,
    level: -1,
    shownLevel: c.floorY,
    spread: 0,
  }));
  // 줄기 — 볼 입구에서 떨어지는 3D 관
  const stream = new PourStream(new THREE.MeshStandardMaterial({ color: toonColor(pourColor, 1.08, 1.03), roughness: 0.62 }));
  let pressing = false;
  let tilt = 0;
  /** 지금 붓는 칸 (-1이면 칸 밖) */
  let target = -1;
  /** 줄기가 떨어지는 자리 (월드 x, z) — 손가락을 부드럽게 따라간다 */
  const streamAt = new THREE.Vector2();
  const streamGoal = new THREE.Vector2();
  let streamCut: number | null = null;
  let ripples: number[] = [];
  let rippleTimer = 0;
  let lastTickFill = 0;

  function cellAt(px: number, py: number): { i: number; x: number; z: number } | null {
    const st = sv.stage;
    if (!st) return null;
    let best: { i: number; x: number; z: number; d: number } | null = null;
    cells.forEach((c, i) => {
      const hit = st.onPlane(px, py, c.fullY);
      if (!hit) return;
      const dd = Math.hypot(hit.x - c.center[0], hit.z - c.center[1]) / cellRadius(c);
      if (dd < 1.25 && (!best || dd < best.d)) best = { i, x: hit.x, z: hit.z, d: dd };
    });
    if (!best) return null;
    const b = best as { i: number; x: number; z: number };
    const [x, z] = clampToCell(cells[b.i], b.x, b.z);
    return { i: b.i, x, z };
  }

  function aimAt(px: number, py: number): void {
    const hit = cellAt(px, py);
    target = hit ? hit.i : -1;
    if (hit) {
      streamGoal.set(hit.x, hit.z);
      if (streamCut === null) streamAt.copy(streamGoal);
    }
  }

  function updatePour(dt: number): void {
    const st = sv.stage;
    if (!st) return;
    tilt = clamp(tilt + (pressing && target >= 0 ? dt / 0.35 : -dt / 0.3), 0, 1);
    streamAt.lerp(streamGoal, Math.min(1, dt * 10));
    const flowing = pressing && target >= 0 && tilt >= POUR_TILT && cellState[target].fill < 1;
    if (flowing) {
      streamCut = 0;
      const cs = cellState[target];
      if (!cs.origin) cs.origin = [streamAt.x, streamAt.y];
      cs.fill = clamp(cs.fill + dt * POUR_RATE, 0, 1);
      rippleTimer -= dt;
      if (rippleTimer <= 0) {
        ripples.push(0);
        rippleTimer = 0.32;
      }
      if (Math.abs(cs.fill - lastTickFill) > 0.12) {
        lastTickFill = cs.fill;
        void hapticTick();
      }
    } else if (streamCut !== null) {
      streamCut += dt / 0.28;
      if (streamCut >= 1) {
        streamCut = null;
        stream.mesh.visible = false;
      }
    }
    ripples = ripples.map((a) => a + dt).filter((a) => a < RIPPLE_SEC);
    // 칸마다의 반죽 — 떨어진 자리에서 번져 바닥을 덮고(퍼짐 마스크), 그 뒤로 차오른다. 번지는 반지름과 보이는 높이는
    // 목표를 지수적으로 따라간다 — 처음엔 빠르게 퍼지고 차오르다 점점 느려진다(붓기를 멈춰도 잠깐 더 번진다)
    cells.forEach((cell, i) => {
      const cs = cellState[i];
      if (cs.fill <= 0) return;
      const far = cellRadius(cell) * 2.2;
      const goalR = far * Math.min(1, Math.sqrt(cs.fill / COVER) * 1.15);
      cs.spread = Math.max(cs.spread, 0.004);
      cs.spread += (goalR - cs.spread) * (1 - Math.exp(-dt * SPREAD_K));
      cs.shownLevel += (fillLevel(cell, cs.fill) - cs.shownLevel) * (1 - Math.exp(-dt * FILL_K));
      const level = Math.max(cs.shownLevel, cell.floorY + 0.0018);
      if (!cs.mesh) {
        cs.mesh = new THREE.Mesh(cellGeometry(cell, level), cs.mat);
        cs.mesh.receiveShadow = true;
        st.scene.add(cs.mesh);
        cs.level = level;
      } else if (Math.abs(level - cs.level) > 0.0002) {
        cs.mesh.geometry.dispose();
        cs.mesh.geometry = cellGeometry(cell, level);
        cs.level = level;
      }
      const o = cs.origin ?? cell.center;
      cs.mat.spread.origin.set(o[0], o[1]);
      // 붓는 자리에서 칸 가장 먼 곳까지 번지면 바닥이 다 덮인다
      cs.mat.spread.radius.value = cs.spread >= far * 0.98 ? 10 : cs.spread;
    });
    const all = cellState.every((c) => c.fill >= ENOUGH);
    if (pressing && target >= 0) {
      const f = cellState[target].fill;
      hint.textContent =
        f >= 1 ? '이 칸은 가득 찼어요' : f >= COVER ? '바닥을 다 덮었어요 · 조금 더 차오르게…' : '바닥에 번지는 중…';
    } else if (!all) {
      const left = cellState.filter((c) => c.fill < ENOUGH).length;
      hint.textContent =
        cells.length > 1
          ? `반죽을 부을 칸을 눌러주세요 · 남은 칸 ${left}개`
          : `${vesselName}을 누르고 있으면 반죽이 흘러들어가요`;
    }
    if (all) {
      hint.textContent = '이 정도면 충분해요 · 더 부어도 괜찮아요';
      ready_();
    }
  }

  /** 위에서 붓는 볼(그림)·물결(2D)과 줄기(3D) */
  function drawPour(g: CanvasRenderingContext2D): void {
    const st = sv.stage;
    if (!st || target < 0 && streamCut === null && tilt <= 0) return;
    const ci = target >= 0 ? target : 0;
    const cell = cells[ci];
    const level = Math.max(cellState[ci].shownLevel, cell.floorY);
    const land = st.project(new THREE.Vector3(streamAt.x, level, streamAt.y));
    const above = st.project(new THREE.Vector3(streamAt.x, cell.fullY + 0.12, streamAt.y));
    const b = sv.box;
    // 물결 — 떨어지는 자리에서 넓고 느리게
    if (cellState[ci].fill > 0.02) {
      const ppm = st.pixelsPerMeter(new THREE.Vector3(streamAt.x, level, streamAt.y));
      for (const age of ripples) {
        const f = age / RIPPLE_SEC;
        const rr = ppm * (0.004 + f * 0.022);
        g.strokeStyle = `rgba(255,250,236,${0.32 * (1 - f)})`;
        g.lineWidth = Math.max(1, b.size * 0.004);
        g.beginPath();
        g.ellipse(land.x, land.y, rr, rr * 0.72, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // 볼 — 입구(lip)를 축으로 기운다. 그림은 이미 기운 모습이라 덜 기운 쪽으로 되돌려 그린다
    const lip = { x: land.x + b.size * 0.03, y: above.y };
    const bowl = sprite('tool/pour_bowl');
    const L = META.tool.pourBowl?.lip;
    if (ready(bowl) && L) {
      const bb = META.bbox['tool/pour_bowl'] ?? [0, 0, 1, 1];
      const D = (b.size * 0.27) / (bb[2] - bb[0]);
      g.save();
      g.translate(lip.x, lip.y);
      g.rotate((1 - tilt) * 0.55);
      g.globalAlpha = smoothstep(0, 0.25, tilt) * 0.6 + 0.4;
      g.drawImage(bowl, -L[0] * D, -L[1] * D, D, D);
      g.restore();
    }
    // 줄기 — 볼 입구(그림) 아래에서 떨어지는 자리까지 3D로
    if (streamCut !== null && streamCut < 1) {
      const top = st.onPlane(lip.x, lip.y, cell.fullY + 0.12);
      if (top) {
        stream.update(top, new THREE.Vector3(streamAt.x, level, streamAt.y), 0.0062, clock, streamCut);
        stream.mesh.visible = true;
      }
    } else stream.mesh.visible = false;
  }

  // ================================================================ 끌어다 놓기 (식빵·트레이·파이)
  interface Carry {
    pieces: { mesh: THREE.Mesh; offset: [number, number]; from: THREE.Vector3; to: THREE.Vector3 }[];
    /** 들고 있는 높이 */
    hover: number;
    home: THREE.Vector3;
    at: THREE.Vector3;
    dragging: boolean;
    /** 놓은 뒤 내려앉는 진행 0~1 (null이면 아직) */
    settle: number | null;
    onPlaced: () => void;
    /** 놓을 수 있는 자리인지 (월드 x, z) */
    accepts: (x: number, z: number) => boolean;
    /** 놓은 자리 → 조각마다 앉을 자리 */
    landing: (x: number, z: number) => THREE.Vector3[];
  }
  let carry: Carry | null = null;
  const dough = doughMaterial(doughColor);
  // 빚은 반죽(칼집 금이 정점 색)
  const doughV = doughMaterial(doughColor, true);

  function showPiece(c: Carry): void {
    carry = c;
    for (const p of c.pieces) {
      p.mesh.position.copy(c.home).add(new THREE.Vector3(p.offset[0], 0, p.offset[1]));
      sv.stage?.scene.add(p.mesh);
    }
  }

  function piecesOf(list: Piece[], scale = 1): Carry['pieces'] {
    return list.map((p) => {
      const m = new THREE.Mesh(p.geo, doughV);
      m.castShadow = true;
      m.receiveShadow = true;
      m.scale.setScalar(scale);
      return { mesh: m, offset: [p.offset[0] * scale, p.offset[1] * scale], from: new THREE.Vector3(), to: new THREE.Vector3() };
    });
  }

  /** 식빵 — 통 반죽을 식빵틀 위로 */
  function shokupanCarry(): Carry {
    const rim = sm.rimY ?? 0.1;
    const inner = sm.inner ?? [0.094, 0.044];
    const floor = (sm.floorY ?? 0.0008) + 0.0004;
    // 틀 뒤쪽 위에 조금 작게 떠 있다 — 카메라에 가까우면 틀을 다 가린다. 놓으면 제 크기로 틀에 앉는다
    const home = new THREE.Vector3(0, rim + 0.018, -0.03);
    return {
      pieces: piecesOf(formedPieces(def), 0.7),
      hover: rim + 0.018,
      home,
      at: home.clone(),
      dragging: false,
      settle: null,
      accepts: (x, z) => Math.abs(x) < inner[0] * 1.3 && Math.abs(z) < inner[1] * 2.2,
      // 놓은 자리와 상관없이 틀 가운데 바닥으로 — 틀에 꼭 맞는 통 반죽
      landing: () => [new THREE.Vector3(0, floor, 0)],
      onPlaced: () => {
        hint.textContent = `${vesselName}에 쏙 들어갔어요`;
        ready_();
      },
    };
  }

  // ---- 트레이 빵: 반죽 판(앞)에서 트레이(뒤)로 하나씩 ----
  let tray: ToppingScene | null = null;
  const trayC = sm.center ?? [0, -0.122];
  const trayHalf = sm.half ?? [0.165, 0.115];
  const trayTop = sm.topY ?? 0.0009;
  const HOVER = (sm.boardTop ?? 0.022) + 0.035;
  let held: PieceNode | null = null;
  const heldAt = new THREE.Vector3();
  /** 조각마다 놓인 트레이 자리(쿠키는 자리 번호) */
  const placedOn = new Map<PieceNode, number>();
  /** 조각마다 트레이 위 자리 [x, z] (트레이 가운데 기준) — 오븐이 그 자리에서 굽는다 */
  const placedAt = new Map<PieceNode, [number, number]>();
  /** 내려앉거나 판으로 돌아가는 움직임 */
  const moves: { node: PieceNode; from: THREE.Vector3; to: THREE.Vector3; t: number; land: boolean }[] = [];
  const spots = traySpots(def);

  /** 놓은 자리 → 앉을 자리. 여러 조각(쿠키·플랫브레드)은 가장 가까운 빈 자리, 한 덩이는 놓은 자리(트레이 밖으로 나가지 않게) */
  function landingFor(node: PieceNode, x: number, z: number): { to: THREE.Vector3; spot: number } {
    if (spots.length > 1) {
      const used = new Set(placedOn.values());
      let best = 0;
      let bd = Infinity;
      spots.forEach(([sx, , sz], i) => {
        if (used.has(i)) return;
        const dd = Math.hypot(sx - x, sz - z);
        if (dd < bd) {
          bd = dd;
          best = i;
        }
      });
      return { to: new THREE.Vector3(...spots[best]), spot: best };
    }
    const bb = new THREE.Box3().setFromObject(node.group);
    const hx = Math.max(0, trayHalf[0] - (bb.max.x - bb.min.x) / 2 - 0.012);
    const hz = Math.max(0, trayHalf[1] - (bb.max.z - bb.min.z) / 2 - 0.012);
    return { to: new THREE.Vector3(clamp(x, trayC[0] - hx, trayC[0] + hx), trayTop, clamp(z, trayC[1] - hz, trayC[1] + hz)), spot: 0 };
  }

  function grabTray(px: number, py: number): void {
    const st = sv.stage;
    if (!tray || !st) return;
    let best: PieceNode | null = null;
    let bd = sv.box.size * 0.11;
    for (const n of tray.pieces) {
      if (placedOn.has(n) || moves.some((m) => m.node === n)) continue;
      const q = st.project(n.group.position.clone().add(new THREE.Vector3(0, 0.01, 0)));
      const dd = Math.hypot(q.x - px, q.y - py);
      if (dd < bd) {
        bd = dd;
        best = n;
      }
    }
    if (!best) return;
    held = best;
    heldAt.copy(best.group.position);
    void hapticTick();
  }

  function dropTray(): void {
    const n = held;
    held = null;
    if (!n) return;
    const p = n.group.position;
    const onTray = Math.abs(p.x - trayC[0]) < trayHalf[0] * 1.05 && Math.abs(p.z - trayC[1]) < trayHalf[1] * 1.25;
    if (onTray) {
      const { to, spot } = landingFor(n, p.x, p.z);
      placedOn.set(n, spot);
      placedAt.set(n, [to.x - trayC[0], to.z - trayC[1]]);
      moves.push({ node: n, from: p.clone(), to, t: 0, land: true });
    } else moves.push({ node: n, from: p.clone(), to: n.home.clone(), t: 0, land: false });
  }

  function updateTray(dt: number): void {
    if (!tray) return;
    if (held) {
      // 손가락을 따라 판 위로 살짝 들려 움직인다
      const goal = heldAt.clone();
      goal.y = HOVER + Math.sin(clock * 3) * 0.002;
      held.group.position.lerp(goal, Math.min(1, dt * 16));
    }
    for (let i = moves.length - 1; i >= 0; i--) {
      const m = moves[i];
      m.t = Math.min(1, m.t + dt / (m.land ? 0.5 : 0.4));
      const e = 1 - (1 - m.t) ** 2;
      const g = m.node.group;
      g.position.set(lerp(m.from.x, m.to.x, e), lerp(m.from.y, m.to.y, m.t * m.t), lerp(m.from.z, m.to.z, e));
      // 툭 내려앉으며 납작해졌다 돌아온다
      const land = clamp((m.t - 0.7) / 0.3, 0, 1);
      const sq = m.land && land > 0 ? Math.exp(-land * 4) * Math.sin(land * 12) * 0.12 : 0;
      g.scale.set(1 + sq, 1 - sq, 1 + sq);
      if (m.t >= 1) {
        g.scale.setScalar(1);
        moves.splice(i, 1);
        if (m.land) void hapticThud();
      }
    }
    const left = tray.pieces.length - placedOn.size;
    if (left > 0) {
      hint.textContent =
        tray.pieces.length > 1
          ? `반죽을 하나씩 끌어다 트레이에 올려주세요 · 남은 반죽 ${left}개`
          : '반죽을 끌어다 트레이에 올려주세요';
    } else if (!moves.length && nextBtn.disabled) {
      hint.textContent = '트레이에 살포시 올렸어요 · 이제 오븐에 넣어요';
      ready_();
    }
  }

  // ---- 파이: 판 깔기 → 테두리 자르기 → (필링) → 격자 ----
  let pieStep = 0; // 0 판 담기, 1 테두리 자르기, 2 격자 얹기, 3 끝
  let crustMesh: THREE.Mesh | null = null;
  let crustDrape = 0;
  const latticeMeshes: THREE.Mesh[] = [];
  let latticeT = -1;
  /** 틀 밖으로 늘어진 반죽 — 구간마다 칼이 지나가면 금(line)이 난다. 다 자르면 고리째 내려앉는다 */
  const overhang: { mesh: THREE.Mesh; cut: boolean; line: THREE.Mesh }[] = [];
  const cutLineMat = new THREE.MeshBasicMaterial({ color: '#7a5a3c' });
  /** 다 자른 고리가 틀 둘레로 내려앉은 정도 0~1 */
  let ringDrop = 0;
  let trimAngle: number | null = null;
  let trimming = false;
  let trimDone = false;
  function pieSheetCarry(): Carry {
    const rim = sm.rimY ?? 0.026;
    // 민 그대로의 크기(틀보다 크다)로 틀 뒤쪽 위에 떠 있다 — 줄였다 키우지 않는다. 끌어다 놓으면 틀을 덮고 가장자리가 늘어진다
    const home = new THREE.Vector3(0, rim + 0.022, -0.06);
    const sheet = formedPieces(def)[0];
    return {
      pieces: piecesOf([{ geo: sheet.geo, offset: [0, 0] }], 1),
      hover: rim + 0.022,
      home,
      at: home.clone(),
      dragging: false,
      settle: null,
      accepts: (x, z) => Math.hypot(x, z) < 0.14,
      landing: () => [new THREE.Vector3(0, rim + 0.002, 0)],
      onPlaced: () => {
        // 틀을 따라 깔린다 — 가장자리는 틀 밖으로 늘어진다
        crustMesh = new THREE.Mesh(pieCrustGeometry(sm), dough);
        crustMesh.castShadow = true;
        crustMesh.receiveShadow = true;
        crustMesh.scale.y = 0.05;
        crustMesh.position.y = (sm.rimY ?? 0.026) * 0.95;
        sv.stage?.scene.add(crustMesh);
        crustDrape = 0.0001;
        for (let i = 0; i < TRIM_SECTORS; i++) {
          const a0 = (i / TRIM_SECTORS) * Math.PI * 2;
          const a1 = ((i + 1.03) / TRIM_SECTORS) * Math.PI * 2;
          const m = new THREE.Mesh(pieOverhangSector(sm, a0, a1), dough);
          m.castShadow = true;
          sv.stage?.scene.add(m);
          // 칼이 지나간 자리의 금 — 테두리를 따라가는 가는 띠
          const rr = (sm.wall ? sm.wall[sm.wall.length - 1][1] : 0.108) - 0.007;
          const yy = (sm.rimY ?? 0.026) + 0.0052;
          const V: number[] = [];
          const I: number[] = [];
          for (let k = 0; k <= 3; k++) {
            const a = a0 + ((a1 - a0) * k) / 3;
            V.push(Math.cos(a) * (rr - 0.0009), yy, Math.sin(a) * (rr - 0.0009), Math.cos(a) * (rr + 0.0009), yy, Math.sin(a) * (rr + 0.0009));
            if (k < 3) I.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3, k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
          }
          const lg = new THREE.BufferGeometry();
          lg.setAttribute('position', new THREE.Float32BufferAttribute(V, 3));
          lg.setIndex(I);
          const line = new THREE.Mesh(lg, cutLineMat);
          line.visible = false;
          sv.stage?.scene.add(line);
          overhang.push({ mesh: m, cut: false, line });
        }
        hint.textContent = '빵칼로 점선을 따라 틀 테두리를 빙 둘러 남는 반죽을 잘라 내세요';
      },
    };
  }

  /** 손가락이 테두리 근처를 지나가면 그 사이 조각들을 자른다 */
  function trimAt(px: number, py: number): void {
    const st = sv.stage;
    if (!st || trimDone) return;
    const hit = st.onPlane(px, py, sm.rimY ?? 0.026);
    if (!hit) return;
    const r = Math.hypot(hit.x, hit.z);
    if (r < 0.07 || r > 0.17) {
      trimAngle = null;
      return;
    }
    const a = Math.atan2(hit.z, hit.x);
    const from = trimAngle ?? a;
    let da = a - from;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    trimAngle = a;
    if (Math.abs(da) > 1.2) return;
    const steps = Math.ceil(Math.abs(da) / ((Math.PI * 2) / TRIM_SECTORS)) + 1;
    for (let k = 0; k <= steps; k++) {
      const q = from + (da * k) / steps;
      const i = ((Math.floor((q / (Math.PI * 2)) * TRIM_SECTORS) % TRIM_SECTORS) + TRIM_SECTORS) % TRIM_SECTORS;
      if (overhang[i] && !overhang[i].cut) {
        overhang[i].cut = true;
        if (i % 6 === 0) void hapticTick();
      }
    }
    const done = overhang.filter((o) => o.cut).length / TRIM_SECTORS;
    if (done >= TRIM_DONE) {
      for (const o of overhang) o.cut = true;
      trimDone = true;
      void hapticThud();
      hint.textContent = putNext ? '깔끔하게 잘렸어요 · 남은 반죽은 격자에 써요 · 이제 필링을 올려요' : '깔끔하게 잘렸어요 · 남은 반죽으로 격자 띠를 만들어요';
      ready_();
    }
  }

  function updateTrim(dt: number): void {
    // 칼이 지나간 구간엔 금만 난다 — 반죽은 부서지지 않는다. 다 자르면 고리째 틀 둘레로 스르르 내려앉아 그대로 남는다
    if (trimDone && ringDrop < 1) ringDrop = Math.min(1, ringDrop + dt / 0.55);
    const e = 1 - (1 - ringDrop) ** 2;
    const down = ((sm.rimY ?? 0.026) - 0.011) * e;
    for (const o of overhang) {
      o.line.visible = o.cut && !trimDone;
      o.mesh.position.y = -down;
      o.mesh.scale.set(1 + 0.14 * e, 1, 1 + 0.14 * e);
    }
  }

  function latticePieces(): Carry {
    const rim = sm.rimY ?? 0.026;
    const home = new THREE.Vector3(0, rim + 0.04, -0.075);
    // 띠들은 한 묶음으로 — 묶음 가운데를 기준으로
    const strips = pieStripPieces();
    return {
      pieces: piecesOf(strips, 0.62),
      hover: rim + 0.04,
      home,
      at: home.clone(),
      dragging: false,
      settle: null,
      accepts: (x, z) => Math.hypot(x, z) < 0.14,
      landing: () => strips.map(() => new THREE.Vector3(0, rim + 0.004, 0)),
      onPlaced: () => {
        // 띠가 가로·세로로 엮인 격자가 되고, 끝을 눌러 붙인 테두리가 생긴다
        for (const g of [...pieLatticeGeometries(), pieRimGeometry()]) {
          const m = new THREE.Mesh(g, dough);
          m.castShadow = true;
          m.receiveShadow = true;
          m.scale.y = 0.001;
          sv.stage?.scene.add(m);
          latticeMeshes.push(m);
        }
        latticeT = 0;
        hint.textContent = '격자가 예쁘게 엮였어요';
        pieStep = 3;
        ready_();
      },
    };
  }

  function updateCarry(dt: number): void {
    const c = carry;
    if (!c) return;
    if (c.settle === null) {
      // 들고 다니기 — 손가락을 부드럽게 따라가고, 놓지 않았으면 제자리로 돌아간다
      c.pieces.forEach((p, i) => {
        const goal = c.at.clone().add(new THREE.Vector3(p.offset[0], 0, p.offset[1]));
        goal.y = c.hover + (c.dragging ? 0.012 : 0) + Math.sin(clock * 2 + i) * 0.002;
        p.mesh.position.lerp(goal, Math.min(1, dt * 14));
      });
      return;
    }
    // 내려앉기 — 조각마다 조금씩 늦게, 툭 떨어져 출렁
    c.settle = Math.min(1, c.settle + dt / 0.6);
    c.pieces.forEach((p, i) => {
      const k = clamp((c.settle! - i * 0.04) / (1 - Math.min(0.5, c.pieces.length * 0.04)), 0, 1);
      const e = 1 - (1 - k) ** 2;
      p.mesh.position.set(lerp(p.from.x, p.to.x, e), lerp(p.from.y, p.to.y, k * k), lerp(p.from.z, p.to.z, e));
      const land = clamp((k - 0.7) / 0.3, 0, 1);
      const sq = land > 0 ? Math.exp(-land * 4) * Math.sin(land * 12) * 0.12 : 0;
      // 들고 다니던 크기 → 제 크기(1)로, 내려앉으며 납작해졌다 돌아온다
      const from = p.mesh.userData.from ?? p.mesh.scale.x;
      p.mesh.userData.from = from;
      const base = lerp(from, 1, e);
      p.mesh.scale.set(base * (1 + sq), base * (1 - sq), base * (1 + sq));
    });
    if (c.settle >= 1) {
      void hapticThud();
      const done = c;
      carry = null;
      done.onPlaced();
      if (mode === 'pie' && pieStep === 0) {
        // 깔린 판 대신 틀 모양 크러스트가 보인다
        for (const p of done.pieces) p.mesh.visible = false;
        pieStep = 1;
      } else if (mode === 'pie' && pieStep === 3) {
        for (const p of done.pieces) p.mesh.visible = false;
      }
    }
  }

  // ================================================================ 입력
  const fg = sv.fg;
  let pointer = { x: 0, y: 0 };
  fg.addEventListener('pointerdown', (e) => {
    fg.setPointerCapture(e.pointerId);
    pointer = sv.local(e);
    if (mode === 'pie' && pieStep === 1) {
      trimming = true;
      trimAngle = null;
      trimAt(pointer.x, pointer.y);
      return;
    }
    if (mode === 'pour' && cells.length) {
      pressing = true;
      aimAt(pointer.x, pointer.y);
      return;
    }
    if (mode === 'tray') {
      grabTray(pointer.x, pointer.y);
      return;
    }
    const c = carry;
    const st = sv.stage;
    if (!c || c.settle !== null || !st) return;
    // 반죽 근처를 잡았을 때만 끈다
    const near = c.pieces.some((p) => {
      const q = st.project(p.mesh.position);
      return Math.hypot(q.x - pointer.x, q.y - pointer.y) < sv.box.size * 0.18;
    });
    if (near) {
      c.dragging = true;
      void hapticTick();
    }
  });
  fg.addEventListener('pointermove', (e) => {
    pointer = sv.local(e);
    if (trimming) {
      trimAt(pointer.x, pointer.y);
      return;
    }
    if (pressing) {
      aimAt(pointer.x, pointer.y);
      return;
    }
    if (held) {
      const hit = sv.stage?.onPlane(pointer.x, pointer.y, HOVER);
      if (hit) heldAt.copy(hit);
      return;
    }
    const c = carry;
    if (!c?.dragging || !sv.stage) return;
    const hit = sv.stage.onPlane(pointer.x, pointer.y, c.hover);
    if (hit) c.at.set(hit.x, c.hover, hit.z);
  });
  const release = () => {
    trimming = false;
    trimAngle = null;
    if (pressing) {
      pressing = false;
      return;
    }
    if (held) {
      dropTray();
      return;
    }
    const c = carry;
    if (!c?.dragging) return;
    c.dragging = false;
    if (c.accepts(c.at.x, c.at.z)) {
      const to = c.landing(c.at.x, c.at.z);
      c.pieces.forEach((p, i) => {
        p.from.copy(p.mesh.position);
        p.to.copy(to[Math.min(i, to.length - 1)]);
        // 한 덩이(식빵·트레이 한 개)는 상대 위치를 그대로
        if (to.length === 1 && c.pieces.length > 1) p.to.add(new THREE.Vector3(p.offset[0], 0, p.offset[1]));
      });
      c.settle = 0;
    } else {
      c.at.copy(c.home);
    }
  };
  fg.addEventListener('pointerup', release);
  fg.addEventListener('pointercancel', release);

  // ================================================================ 시작
  void sv.load().then((st) => {
    if (disposed) return;
    st.scene.add(stream.mesh);
    if (mode === 'shokupan') {
      showPiece(shokupanCarry());
      hint.textContent = `돌돌 만 반죽을 끌어다 ${vesselName}에 담아주세요`;
    } else if (mode === 'tray') {
      // 토핑까지 올린 반죽이 앞쪽 반죽 판에 — 하나씩 트레이로
      tray = new ToppingScene(sv.stage!, def);
      tray.setToppings(toppingIds, seed);
      // 속에 넣은 소는 이미 반죽 속이다 — 겉에 드러나지 않는다
      tray.setFillingReveal(0);
    } else if (mode === 'pie') {
      if (latticePhase) {
        // 크러스트와 필링(고른 토핑)은 그대로 — 그 위에 격자. 토핑이 없으면 빈 크러스트 그대로
        const pie = new ToppingScene(st, def);
        pie.setToppings(toppingIds, seed);
        pie.setFilled(putNext);
        pieStep = 2;
        showPiece(latticePieces());
        hint.textContent = '자른 띠를 끌어다 파이 위에 얹어주세요';
      } else {
        showPiece(pieSheetCarry());
        hint.textContent = '크게 민 반죽을 끌어다 파이 틀에 깔아주세요';
      }
    }
  });

  let last = performance.now();
  function frame(now: number): void {
    if (disposed) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    clock += dt;
    const g = sv.layout();
    if (sv.stage) {
      if (mode === 'pour') updatePour(dt);
      updateTrim(dt);
      updateCarry(dt);
      updateTray(dt);
      // 파이: 깔린 크러스트가 틀을 따라 내려앉고, 격자가 엮이며 내려앉는다
      if (crustMesh && crustDrape > 0 && crustDrape < 1) {
        crustDrape = Math.min(1, crustDrape + dt / 0.5);
        const e = 1 - (1 - crustDrape) ** 3;
        crustMesh.scale.y = lerp(0.05, 1, e);
        crustMesh.position.y = lerp((sm.rimY ?? 0.026) * 0.95, 0, e);
      }
      if (latticeT >= 0 && latticeT < 1) {
        latticeT = Math.min(1, latticeT + dt / 0.6);
        latticeMeshes.forEach((m, i) => {
          const k = clamp((latticeT - i * 0.03) / 0.6, 0, 1);
          m.scale.y = Math.max(0.001, 1 - (1 - k) ** 3);
          m.position.y = (1 - k) * 0.02;
        });
      }
      if (mode === 'pour') drawPour(g);
      sv.render();
      // 자를 자리 안내선 — 아직 자르지 않은 테두리 구간을 점선으로
      if (mode === 'pie' && pieStep === 1 && !trimDone && overhang.length) {
        const rr = (sm.wall ? sm.wall[sm.wall.length - 1][1] : 0.108) - 0.007;
        const yy = (sm.rimY ?? 0.026) + 0.0055;
        g.save();
        g.setLineDash([6, 6]);
        g.lineWidth = 2;
        g.strokeStyle = 'rgba(120, 78, 40, 0.75)';
        g.beginPath();
        let pen = false;
        for (let i = 0; i <= TRIM_SECTORS; i++) {
          const o = overhang[i % TRIM_SECTORS];
          const a = (i / TRIM_SECTORS) * Math.PI * 2;
          const q = sv.stage.project(new THREE.Vector3(Math.cos(a) * rr, yy, Math.sin(a) * rr));
          if (o.cut && overhang[(i + TRIM_SECTORS - 1) % TRIM_SECTORS].cut) pen = false;
          else {
            if (pen) g.lineTo(q.x, q.y);
            else g.moveTo(q.x, q.y);
            pen = true;
          }
        }
        g.stroke();
        g.restore();
      }
      // 테두리를 자르는 빵칼 — 칼끝이 손가락 자리, 칼날은 테두리의 접선 방향
      if (trimming && !trimDone) {
        const img = sprite('tool/knife');
        const tip = META.tool.knife?.tip;
        const c = sv.stage.project(new THREE.Vector3(0, sm.rimY ?? 0.026, 0));
        if (ready(img) && tip) {
          const b = sv.box;
          g.save();
          g.translate(pointer.x, pointer.y);
          g.rotate(Math.atan2(pointer.y - c.y, pointer.x - c.x) + Math.PI / 2);
          const ks = b.size * PIE_KNIFE_SCALE;
          g.drawImage(img, -tip[0] * ks, -tip[1] * ks, ks, ks);
          g.restore();
        }
      }
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  // ---- 내비게이션 ----
  view.querySelector('[data-back]')!.addEventListener('click', () => {
    confirmSheet('처음 화면으로 갈까요? 반죽한 건 사라져요', () => ctx.go('title'));
  });
  nextBtn.addEventListener('click', () => {
    if (mode === 'tray') {
      // 놓은 자리 그대로 오븐에 — 트레이 가운데 기준
      const placed = tray!.pieces.map((n) => placedAt.get(n) ?? [0, 0]) as [number, number][];
      void startBake(ctx, def, toppingIds, seed, next.roughness, { placed });
    } else if (latticePhase) void startBake(ctx, def, toppingIds, seed, next.roughness);
    else if (mode === 'pie' && !putNext) ctx.go('forming', { ...next, phase: 'lattice' });
    else if (mode === 'pour') {
      const layout = { fills: cellState.map((c) => c.fill) };
      if (putNext) ctx.go('shaping', { ...next, layout });
      else void startBake(ctx, def, toppingIds, seed, next.roughness, layout);
    } else if (putNext) ctx.go('shaping', next);
    else void startBake(ctx, def, toppingIds, seed, next.roughness);
  });

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    sv.dispose();
  };
}

export type { BreadDef };
