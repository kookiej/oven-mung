import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GeometryKind, Quality } from '../types';

const SPHERE_SEGMENTS: Record<Quality, number> = { low: 48, mid: 80, high: 128 };
const TORUS_SEGMENTS: Record<Quality, [number, number]> = {
  low: [24, 64],
  mid: [40, 110],
  high: [56, 160],
};
/** 회전체(케이크·컵케이크)의 [둘레 분할, 단면 곡선 분할] */
const LATHE_SEGMENTS: Record<Quality, [number, number]> = {
  low: [48, 6],
  mid: [80, 10],
  high: [120, 14],
};
const BOX_SEGMENTS: Record<Quality, number> = { low: 4, mid: 6, high: 8 };

/** a → b 사이를 steps칸으로 나눈 점들 (a는 빼고 b는 넣는다 — 앞 구간과 이어 붙이기 위해) */
function line(a: THREE.Vector2, b: THREE.Vector2, steps: number): THREE.Vector2[] {
  return Array.from({ length: steps }, (_, i) => a.clone().lerp(b, (i + 1) / steps));
}

/** 사분원 호의 점들 — (cx, cy)를 중심으로 a0 → a1 */
function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  steps: number,
): THREE.Vector2[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / steps;
    return new THREE.Vector2(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  });
}

export function makeBreadGeometry(kind: GeometryKind, tier: Quality): THREE.BufferGeometry {
  switch (kind) {
    case 'loaf': {
      // 둥근 산형 덩어리 (불) — 구를 눌러 늘인 형태
      const seg = SPHERE_SEGMENTS[tier];
      const geo = new THREE.SphereGeometry(0.72, seg, Math.floor(seg * 0.7));
      geo.scale(1.35, 0.85, 0.95);
      return geo;
    }
    case 'panLoaf': {
      // 산형 식빵 — 식빵틀에 맞는 둥근 모서리 직육면체의 윗면을 봉긋하게 부풀린다.
      // 타원체(loaf)로는 사각 틀에 들어가지 않는다
      const hx = 0.85;
      const hy = 0.42;
      const hz = 0.52;
      // RoundedBoxGeometry는 모서리만 잘게 나누고 평평한 면은 사각형 하나라 윗면을 부풀릴 점이 없다
      // — 면마다 촘촘히 나눈 상자를 쓴다. 모서리가 각진 건 틀 안이라 거의 보이지 않는다
      const seg = BOX_SEGMENTS[tier] * 3;
      const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2, seg, Math.ceil(seg / 2), seg);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        // 위로 갈수록(0→1) 더 많이 솟는다 — 바닥과 옆면 아래쪽은 틀 모양 그대로
        const up = Math.max(0, (y + hy) / (hy * 2));
        const dome = 0.3 * (1 - (x / hx) ** 2) * Math.sqrt(Math.max(0, 1 - (z / hz) ** 2));
        pos.setY(i, y + dome * up ** 3);
      }
      // 상자는 면마다 꼭짓점이 따로라, 셰이더가 노멀 방향으로 부풀리면(요철·크랙) 모서리가 찢어진다.
      // 꼭짓점을 이어 붙여 노멀을 매끈하게 — 모서리가 부드럽게 보이는 것도 빵답다
      geo.deleteAttribute('normal');
      geo.deleteAttribute('uv');
      const merged = mergeVertices(geo);
      merged.computeVertexNormals();
      return merged;
    }
    case 'disc': {
      // 쿠키 — 납작하게 눌린 돔. 팬케이크·파이 두께는 BreadDef.thickness로 조절
      const seg = SPHERE_SEGMENTS[tier];
      const geo = new THREE.SphereGeometry(0.72, seg, Math.floor(seg * 0.7));
      geo.scale(1.25, 0.34, 1.25);
      return geo;
    }
    case 'crescent': {
      // 크루아상 — 토러스 일부를 양 끝으로 갈수록 가늘게
      const [radial, tubular] = TORUS_SEGMENTS[tier];
      const arcLen = Math.PI * 1.25;
      const R = 0.55;
      const geo = new THREE.TorusGeometry(R, 0.3, radial, tubular, arcLen);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        // 토러스 중심선 상의 각도 → 끝으로 갈수록 튜브를 좁힘
        let a = Math.atan2(v.y, v.x);
        if (a < 0) a += Math.PI * 2;
        const t = Math.min(a / arcLen, 1);
        const taper = 0.3 + 0.7 * Math.sin(Math.PI * t);
        const cx = Math.cos(a) * R;
        const cy = Math.sin(a) * R;
        // z는 눕힌 뒤의 세로. 가늘어진 만큼 아래로 내려 밑면을 평평하게 — 그래야 양 끝(뿔)도
        // 트레이에 닿는다. 가운데 기준으로만 좁히면 끝이 공중에 뜬다
        const tube = 0.3;
        pos.setXYZ(i, cx + (v.x - cx) * taper, cy + (v.y - cy) * taper, v.z * taper - tube * (1 - taper));
      }
      geo.computeVertexNormals();
      // 눕혀서 오븐 트레이 위에 놓인 방향으로
      geo.rotateX(-Math.PI / 2);
      geo.rotateY(Math.PI * 0.62);
      geo.center();
      geo.scale(1.15, 1.15, 1.15);
      return geo;
    }
    case 'ring': {
      // 도넛·베이글 — 가운데가 뚫린 고리를 눕힌 형태
      const [radial, tubular] = TORUS_SEGMENTS[tier];
      const geo = new THREE.TorusGeometry(0.56, 0.3, radial, tubular);
      geo.rotateX(-Math.PI / 2);
      geo.scale(1, 0.85, 1);
      return geo;
    }
    case 'cylinder': {
      // 케이크 — 모서리가 둥근 원통. 단면을 회전시켜 노멀이 매끈하게 이어진다
      const [radial, curve] = LATHE_SEGMENTS[tier];
      const R = 0.82;
      const H = 0.36; // 반높이
      const r = 0.12; // 윗모서리 둥글기
      const rb = 0.03; // 아랫모서리 — 틀에 부어 구웠으니 틀 바닥 모서리까지 꽉 찬다
      // 평평한 윗면·아랫면도 촘촘히 나눈다 — 한 줄짜리 긴 삼각형이면 정점마다 계산하는
      // 크랙·요철·노멀이 반지름 방향으로 길게 번져 방사형 줄무늬가 생기고 토핑이 지워진다
      const flat = curve * 3;
      const bottomEdge = new THREE.Vector2(R - rb, -H);
      const topEdge = new THREE.Vector2(R - r, H);
      const profile = [
        new THREE.Vector2(0, -H),
        ...line(new THREE.Vector2(0, -H), bottomEdge, flat).slice(0, -1),
        ...arc(R - rb, -H + rb, rb, rb, -Math.PI / 2, 0, curve),
        ...arc(R - r, H - r, r, r, 0, Math.PI / 2, curve),
        ...line(topEdge, new THREE.Vector2(0, H), flat),
      ];
      const geo = new THREE.LatheGeometry(profile, radial);
      geo.computeVertexNormals();
      return geo;
    }
    case 'cup': {
      // 컵케이크의 빵 부분 — 컵 안에 든 몸통 + 컵 위로 넘친 둥근 머리.
      // 종이 컵받침은 갈변하면 안 되므로 makeCupLiner()로 따로 만든다
      const [radial, curve] = LATHE_SEGMENTS[tier];
      const profile = [
        new THREE.Vector2(0, -0.42),
        new THREE.Vector2(0.44, -0.42),
        new THREE.Vector2(0.56, 0.02),
        // 컵 가장자리 위로 살짝 넘쳐 흐른 머핀 머리 — 각 호의 끝점이 다음 호의 시작점과 맞물린다
        ...arc(0.56, 0.09, 0.1, 0.07, -Math.PI / 2, Math.PI / 2, curve),
        ...arc(0, 0.16, 0.56, 0.44, 0, Math.PI / 2, curve * 2),
      ];
      const geo = new THREE.LatheGeometry(profile, radial);
      geo.computeVertexNormals();
      return geo;
    }
    case 'square': {
      // 와플 — 모서리가 둥근 납작한 판. 격자 무늬는 셰이더의 uGrid가 오브젝트 좌표로 그리므로
      // 지오메트리를 회전시키면 격자와 판의 모서리가 어긋난다 — 돌리지 말 것
      return new RoundedBoxGeometry(1.45, 0.3, 1.45, BOX_SEGMENTS[tier], 0.08);
    }
  }
}

/** 컵케이크의 주름진 종이 컵받침 — 빵 메시의 자식으로 붙인다 */
export function makeCupLiner(): THREE.Mesh {
  // 둘레 분할을 적게 + flatShading으로 주름이 각지게 보이게 한다
  const geo = new THREE.CylinderGeometry(0.6, 0.46, 0.48, 28, 1, true);
  const mat = new THREE.MeshStandardMaterial({
    color: '#d98a9c',
    roughness: 0.8,
    side: THREE.DoubleSide,
    flatShading: true,
  });
  const liner = new THREE.Mesh(geo, mat);
  // 컵받침 바닥(-0.24)이 빵 바닥(-0.42)과 같은 높이에 오도록 — 머핀틀 바닥을 뚫지 않게
  liner.position.y = -0.18;
  return liner;
}
