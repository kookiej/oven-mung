# 오븐 멍 — 빵 13종과 굽는 그릇 8종을 실제 사진을 참고해 사실적으로 렌더한다.
# 게임 메시(breadMesh.ts)를 옮긴 render_breads.py와 달리, 형태·크기·색은 실물 사진을 따른다.
# 단위는 미터, Z-up. 크랙은 그리지 않는다(바게트의 칼집은 크랙이 아니라 의도한 모양이라 남긴다).
#
# 실행: blender --background --factory-startup --python render_real.py -- <출력 폴더>
#   환경 변수 ONLY=shokupan,vessel_tray  SAMPLES=160  RES=1080  SAVE=1
import bpy, bmesh, math, os, sys, random, traceback
from mathutils import Vector, Matrix, noise

OUT = sys.argv[sys.argv.index('--') + 1]
os.makedirs(OUT, exist_ok=True)
LOG = open(os.path.join(OUT, '_log.txt'), 'w', encoding='utf-8')
def log(*a):
    LOG.write(' '.join(str(x) for x in a) + '\n'); LOG.flush()

SAMPLES = int(os.environ.get('SAMPLES', '160'))
RES = int(os.environ.get('RES', '1080'))
ONLY = [k for k in os.environ.get('ONLY', '').split(',') if k]
SAVE = os.environ.get('SAVE', '1') == '1' and not ONLY

# ---------------------------------------------------------------- 수학
def srgb2lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def hexrgb(h): h = h.lstrip('#'); return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
def hexlin(h): return tuple(srgb2lin(c) for c in hexrgb(h))
def lerp(a, b, t): return a + (b - a) * t
def lerp3(a, b, t): return tuple(lerp(x, y, t) for x, y in zip(a, b))
def clamp(x, a=0.0, b=1.0): return min(max(x, a), b)
def smooth(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t)
def pn(x, y, z, seed=0.0):
    return noise.noise(Vector((x, y, z + seed * 7.31)), noise_basis='PERLIN_NEW')

# ---------------------------------------------------------------- 메시 도우미
SC = [None]
# 게임용 내보내기(render_game.py)에서 바꾸는 전역 값 — 기본값이면 기존 렌더와 똑같다
LOD = [1.0]     # 메시 분할 배율: 격자·관·회전체의 분할 수에 곱한다 (GLB를 가볍게)
BROWN = [1.0]   # 굽기 배율: 빵 재질이 정점 속성 toast에 곱한다 (0 = 반죽, 1 = 기존 렌더, 1.4 = 진하게)

def lod(n, lo=8):
    return max(lo, int(round(n * LOD[0])))

def quads(Nu, Nv, wu=False, wv=False, off=0):
    F = []
    for i in range(Nu if wu else Nu - 1):
        i2 = (i + 1) % Nu
        for j in range(Nv if wv else Nv - 1):
            j2 = (j + 1) % Nv
            F.append((off + i * Nv + j, off + i2 * Nv + j, off + i2 * Nv + j2, off + i * Nv + j2))
    return F

def make_mesh(name, V, F, attrs=None, merge=False, smooth_shade=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in V], [], F)
    for k, vals in (attrs or {}).items():
        a = me.attributes.new(k, 'FLOAT', 'POINT'); a.data.foreach_set('value', vals)
    bm = bmesh.new(); bm.from_mesh(me)
    if merge: bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    me.polygons.foreach_set('use_smooth', [smooth_shade] * len(me.polygons))
    me.update()
    return me

def add(name, me, mat=None, loc=(0, 0, 0), rot=(0, 0, 0), matrix=None):
    o = bpy.data.objects.new(name, me)
    SC[0].collection.objects.link(o)
    if matrix is not None: o.matrix_world = matrix
    else:
        o.location = loc; o.rotation_euler = rot
    if mat is not None and me is not None: me.materials.append(mat)
    return o

def finalize_toast(me, fn):
    """정점마다 굽기 정도(toast, 0~1.6)를 계산해 속성으로 넣는다 — 셰이더가 색 곡선으로 바꾼다"""
    n = len(me.vertices)
    co = [0.0] * (3 * n); me.vertices.foreach_get('co', co)
    nr = [0.0] * (3 * n); me.vertices.foreach_get('normal', nr)
    attrs = {}
    for a in me.attributes:
        if a.domain == 'POINT' and a.data_type == 'FLOAT' and not a.name.startswith('.'):
            vals = [0.0] * n; a.data.foreach_get('value', vals); attrs[a.name] = vals
    out = []
    for i in range(n):
        P = Vector(co[3 * i:3 * i + 3]); N = Vector(nr[3 * i:3 * i + 3])
        out.append(fn(P, N, {k: v[i] for k, v in attrs.items()}))
    a = me.attributes.get('toast') or me.attributes.new('toast', 'FLOAT', 'POINT')
    a.data.foreach_set('value', out)

# 사각 격자 (u,v ∈ [-1,1]) → 둥근 사각형(원 포함). 같은 방향의 경계 비율로 반지름 방향으로만 줄인다
def rr(u, v, a, b, rc):
    x, y = a * u, b * v
    r = math.hypot(x, y)
    if r < 1e-12: return 0.0, 0.0
    c, s = x / r, y / r
    t_rect = min(a / abs(c) if abs(c) > 1e-12 else 1e9, b / abs(s) if abs(s) > 1e-12 else 1e9)
    px, py = t_rect * c, t_rect * s
    t1 = t_rect
    if rc > 0 and abs(px) > a - rc + 1e-12 and abs(py) > b - rc + 1e-12:
        cx, cy = math.copysign(a - rc, c), math.copysign(b - rc, s)
        dc = c * cx + s * cy
        t1 = dc + math.sqrt(max(dc * dc - (cx * cx + cy * cy) + rc * rc, 0.0))
    k = t1 / t_rect
    return x * k, y * k

def square_loop(n):
    L = []
    for i in range(n): L.append((-1 + 2 * i / n, -1.0))
    for i in range(n): L.append((1.0, -1 + 2 * i / n))
    for i in range(n): L.append((1 - 2 * i / n, 1.0))
    for i in range(n): L.append((-1.0, 1 - 2 * i / n))
    return L

def circle_loop(m):
    return [(math.cos(2 * math.pi * k / m), math.sin(2 * math.pi * k / m)) for k in range(m)]

def shell(rings, n=48, circle=False, cap_first=True, cap_last=True, share_caps=False):
    """같은 둘레 매개변수로 이어 붙인 고리들 — 틀·팬의 벽. rings=[(a,b,rc,z)…]"""
    n = lod(n, 12)
    loop = circle_loop(4 * n) if circle else square_loop(n)
    M = len(loop); V = []; F = []
    pt = (lambda u, v, a, b, rc: (a * u, b * v)) if circle else rr
    for (a, b, rc, z) in rings:
        V += [Vector((*pt(u, v, a, b, rc), z)) for u, v in loop]
    for k in range(len(rings) - 1):
        for i in range(M):
            i2 = (i + 1) % M
            F.append((k * M + i, k * M + i2, (k + 1) * M + i2, (k + 1) * M + i))
    for flag, ring, ki in ((cap_first, rings[0], 0), (cap_last, rings[-1], len(rings) - 1)):
        if not flag: continue
        if share_caps:
            F.append(tuple(range(ki * M, ki * M + M)))
        else:
            off = len(V); a, b, rc, z = ring
            V += [Vector((*pt(u, v, a, b, rc), z)) for u, v in loop]
            F.append(tuple(range(off, off + M)))
    return V, F

def grid_solid(n, top, rings, bottom, top_fn, warp=None):
    """윗면 높이장 + 옆면 고리 + 평평한 바닥으로 닫힌 덩어리 — 틀에 담긴 빵, 납작한 빵.
    top=(a,b,rc,z): 윗면 경계, rings: 경계 아래 옆면 고리(위→아래), bottom=(a,b,rc,z).
    top_fn(u,v,x,y) -> (h, feat): 경계에서 h가 0이어야 옆면과 매끈하게 이어진다."""
    n = lod(n, 24)
    N = n + 1; V = []; feat = []; topm = []
    a, b, rc, zt = top
    def W(x, y):
        if not warp: return x, y
        k = warp(math.atan2(y, x)); return x * k, y * k
    for i in range(N):
        u = -1 + 2 * i / n
        for j in range(N):
            v = -1 + 2 * j / n
            x, y = rr(u, v, a, b, rc)
            h, f = top_fn(u, v, x, y)
            x, y = W(x, y)
            V.append(Vector((x, y, zt + h))); feat.append(f); topm.append(1.0)
    F = quads(N, N)
    bidx = []; buv = []
    for i in range(n): bidx.append(i * N); buv.append((-1 + 2 * i / n, -1.0))
    for j in range(n): bidx.append(n * N + j); buv.append((1.0, -1 + 2 * j / n))
    for i in range(n, 0, -1): bidx.append(i * N + n); buv.append((-1 + 2 * i / n, 1.0))
    for j in range(n, 0, -1): bidx.append(j); buv.append((-1.0, -1 + 2 * j / n))
    loops = [bidx]
    for (ra, rb_, rrc, rz) in rings:
        off = len(V)
        for (u, v) in buv:
            x, y = W(*rr(u, v, ra, rb_, rrc)); V.append(Vector((x, y, rz))); feat.append(0.0); topm.append(0.0)
        loops.append(list(range(off, off + len(buv))))
    off = len(V); ba, bb, brc, bz = bottom
    for i in range(N):
        u = -1 + 2 * i / n
        for j in range(N):
            v = -1 + 2 * j / n
            x, y = W(*rr(u, v, ba, bb, brc)); V.append(Vector((x, y, bz))); feat.append(0.0); topm.append(0.0)
    F += [tuple(reversed(f)) for f in quads(N, N, off=off)]
    loops.append([off + k for k in bidx])
    M = len(bidx)
    for k in range(len(loops) - 1):
        A, B = loops[k], loops[k + 1]
        for i in range(M):
            i2 = (i + 1) % M
            F.append((A[i], A[i2], B[i2], B[i]))
    return V, F, {'feat': feat, 'topm': topm}

def tube(C, R, nseg=96, closed=False, section=None, floor=None, disp=None):
    """중심선 C(Vector 목록)를 따라가는 관 — 크루아상·프레첼·바게트·베이글·파이 격자.
    section(th)->(sx,sz) 단면, disp(i,t,th,P,radial)->(d,feat)"""
    M0 = len(C)
    nseg = lod(nseg, 12)
    st = max(1, int(round(1 / LOD[0]))) if LOD[0] < 1 else 1
    I = list(range(0, M0, st))
    if not closed and I[-1] != M0 - 1: I.append(M0 - 1)
    M = len(I); V = []; feat = []; tpar = []; th_a = []
    up = Vector((0, 0, 1))
    for ii, i in enumerate(I):
        if closed: T = C[I[(ii + 1) % M]] - C[I[ii - 1]]
        else: T = C[I[min(ii + 1, M - 1)]] - C[I[max(ii - 1, 0)]]
        T = T.normalized()
        side = T.cross(up)
        if side.length < 1e-6: side = Vector((1, 0, 0))
        side.normalize(); upv = side.cross(T).normalized()
        t = i / (M0 if closed else M0 - 1)
        for k in range(nseg):
            th = 2 * math.pi * k / nseg
            sx, sz = section(th) if section else (math.cos(th), math.sin(th))
            radial = side * sx + upv * sz
            P = C[i] + radial * R[i]
            f = 0.0
            if disp:
                d, f = disp(i, t, th, P, radial.normalized())
                P = P + radial.normalized() * d
            if floor is not None and P.z < floor: P.z = floor + (P.z - floor) * 0.04
            V.append(P); feat.append(f); tpar.append(t); th_a.append(th)
    F = quads(M, nseg, wu=closed, wv=True)
    if not closed:
        for ci, ring0, rev in ((0, 0, True), (M0 - 1, (M - 1) * nseg, False)):
            c = len(V); P = C[ci].copy()
            if floor is not None and P.z < floor: P.z = floor
            V.append(P); feat.append(0.0); tpar.append(ci / (M0 - 1)); th_a.append(0.0)
            for k in range(nseg):
                f = (c, ring0 + (k + 1) % nseg, ring0 + k)
                F.append(f if rev else tuple(reversed(f)))
    return V, F, {'feat': feat, 't': tpar, 'th': th_a}

def lathe(prof, nseg=128, rmod=None):
    nseg = lod(nseg, 24)
    V = []
    for k in range(nseg):
        th = 2 * math.pi * k / nseg
        for idx, (r, z) in enumerate(prof):
            rr_ = rmod(th, r, z, idx) if rmod else r
            V.append(Vector((rr_ * math.cos(th), rr_ * math.sin(th), z)))
    return V, quads(nseg, len(prof), wu=True)

def arc_pts(cx, cz, r, a0, a1, steps):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / steps), cz + r * math.sin(a0 + (a1 - a0) * i / steps)) for i in range(steps + 1)]

def catmull(pts, per):
    out = []
    for i in range(len(pts) - 1):
        p0 = pts[max(i - 1, 0)]; p1 = pts[i]; p2 = pts[i + 1]; p3 = pts[min(i + 2, len(pts) - 1)]
        for s in range(per):
            t = s / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1].copy())
    return out

# ---------------------------------------------------------------- 재질
def node_tools(nt):
    N = nt.nodes; L = nt.links
    def link(a, sock):
        if isinstance(a, (int, float)): sock.default_value = a
        elif isinstance(a, tuple): sock.default_value = a
        else: L.new(a, sock)
    def M(op, a, b=0.0, c=None, clamp=False):
        n = N.new('ShaderNodeMath'); n.operation = op; n.use_clamp = clamp
        link(a, n.inputs[0]); link(b, n.inputs[1])
        if c is not None: link(c, n.inputs[2])
        return n.outputs[0]
    def noise_tex(vec, scale, detail=4.0, rough=0.55, dist=0.0):
        n = N.new('ShaderNodeTexNoise'); L.new(vec, n.inputs['Vector'])
        n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail
        n.inputs['Roughness'].default_value = rough; n.inputs['Distortion'].default_value = dist
        return n.outputs['Fac']
    def mixc(fac, a, b):
        n = N.new('ShaderNodeMix'); n.data_type = 'RGBA'
        link(fac, n.inputs[0]); link(a, n.inputs[6]); link(b, n.inputs[7])
        return n.outputs[2]
    def ramp(fac, stops):
        n = N.new('ShaderNodeValToRGB'); link(fac, n.inputs[0])
        el = n.color_ramp.elements
        while len(el) < len(stops): el.new(0.5)
        for e, (p, c) in zip(el, stops): e.position = p; e.color = (*c, 1.0)
        return n.outputs['Color']
    return N, L, link, M, noise_tex, mixc, ramp

import colorsys
def toon(h, sat=1.3, val=1.08, hue=0.0):
    """카툰 색 — 채도를 올리고 조금 밝게 (참고 이미지의 선명한 주황). hue는 주황 쪽으로 미는 양"""
    r, g, b = hexrgb(h)
    hh, ss, vv = colorsys.rgb_to_hsv(r, g, b)
    r, g, b = colorsys.hsv_to_rgb((hh + hue) % 1.0, clamp(ss * sat), clamp(vv * val))
    return tuple(srgb2lin(c) for c in (r, g, b))

def crust_mat(name, dough, gold, brown, dark=None, rough=0.55, coat=0.0, coat_rough=0.25,
              mottle=0.16, sss=0.25, flour=0.0, bump=1.0, sheen=0.0, dust=0.0):
    """카툰 빵 껍질 — toast(0~1.6)를 매끈한 색 곡선으로. 광택(코트)은 쓰지 않고 거칠기를 높여 무광에 가깝게,
    잔 얼룩·기공은 거의 지우고 서브서피스로 말랑하게 빛나는 느낌만 남긴다"""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; N, L, link, M, noise_tex, mixc, ramp = node_tools(nt)
    bsdf = N['Principled BSDF']
    tc = N.new('ShaderNodeTexCoord').outputs['Object']
    at = N.new('ShaderNodeAttribute'); at.attribute_name = 'toast'
    tm = N.new('ShaderNodeAttribute'); tm.attribute_name = 'topm'
    big = noise_tex(tc, 10, 2)
    t = M('ADD', M('MULTIPLY', at.outputs['Fac'], BROWN[0]), M('MULTIPLY', M('SUBTRACT', big, 0.5), mottle * 0.5))
    ao = N.new('ShaderNodeAmbientOcclusion'); ao.samples = 8; ao.inputs['Distance'].default_value = 0.006
    t = M('MULTIPLY', t, M('MULTIPLY_ADD', ao.outputs['AO'], 0.2, 0.8))
    v = M('DIVIDE', t, 1.6, clamp=True)
    d_, g_, b_ = toon(dough, 1.15, 1.04), toon(gold, 1.3, 1.1, 0.008), toon(brown, 1.2, 1.45, 0.016)
    k_ = toon(dark, 1.15, 1.5, 0.016) if dark else tuple(c * 0.5 for c in b_)
    col = ramp(v, [(0.0, d_), (0.22, lerp3(d_, g_, 0.55)), (0.42, g_), (0.7, b_), (1.0, k_)])
    if flour > 0:   # 밀가루는 큼직한 얼룩으로만
        fm = N.new('ShaderNodeMapRange'); link(noise_tex(tc, 7, 3, 0.5), fm.inputs['Value'])
        fm.inputs['From Min'].default_value = 0.56; fm.inputs['From Max'].default_value = 0.7
        f = M('MULTIPLY', M('MULTIPLY', fm.outputs['Result'], flour * 0.8), tm.outputs['Fac'], clamp=True)
        col = mixc(f, col, (0.95, 0.92, 0.86, 1.0))
    if dust > 0:   # 슈가파우더 — 위를 향한 윗면에만 얼룩덜룩 하얗게 쌓인다
        # 큼직한 얼룩(어디에 많이 쌓였나) × 잘게 흩어진 가루 알갱이
        fm = N.new('ShaderNodeMapRange'); link(noise_tex(tc, 22, 3, 0.5), fm.inputs['Value'])
        fm.inputs['From Min'].default_value = 0.4; fm.inputs['From Max'].default_value = 0.66
        gr = N.new('ShaderNodeMapRange'); link(noise_tex(tc, 420, 2, 0.5), gr.inputs['Value'])
        gr.inputs['From Min'].default_value = 0.32; gr.inputs['From Max'].default_value = 0.6
        sep = N.new('ShaderNodeSeparateXYZ'); L.new(N.new('ShaderNodeNewGeometry').outputs['Normal'], sep.inputs[0])
        up = N.new('ShaderNodeMapRange'); L.new(sep.outputs['Z'], up.inputs['Value'])
        up.inputs['From Min'].default_value = 0.35; up.inputs['From Max'].default_value = 0.8
        f = M('MULTIPLY', M('MULTIPLY', fm.outputs['Result'], up.outputs['Result']), tm.outputs['Fac'])
        f = M('MULTIPLY', f, M('MULTIPLY_ADD', gr.outputs['Result'], 0.6, 0.4))
        col = mixc(M('MULTIPLY', f, dust * 0.85, clamp=True), col, (0.97, 0.96, 0.94, 1.0))
    link(col, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = max(rough, 0.62) + 0.08
    bsdf.inputs['Specular IOR Level'].default_value = 0.35
    bsdf.inputs['Subsurface Weight'].default_value = 0.45
    bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.6, 0.35)
    bsdf.inputs['Subsurface Scale'].default_value = 0.006
    bsdf.inputs['Sheen Weight'].default_value = 0.15
    return m

def pmat(name, color, metal=0.0, rough=0.5, **kw):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1.0) if len(color) == 3 else color
    b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    for k, v in kw.items(): b.inputs[k].default_value = v
    return m

def metal_mat(name, base, rough, aniso=0.0, patina=None, speck=0.0, coat=0.0, metal=1.0):
    """카툰 금속 — 얼룩·긁힘 없이 매끈한 단색, 반사는 부드럽게"""
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Metallic'].default_value = metal * 0.8
    b.inputs['Roughness'].default_value = max(rough, 0.3) + 0.08
    return m

def wood_mat():
    m = bpy.data.materials.new('나무_테이블'); m.use_nodes = True
    nt = m.node_tree; N, L, link, M, noise_tex, mixc, ramp = node_tools(nt)
    b = N['Principled BSDF']; tc = N.new('ShaderNodeTexCoord').outputs['Object']
    mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (0.6, 14.0, 1.0)
    L.new(tc, mp.inputs['Vector'])
    grain = noise_tex(mp.outputs['Vector'], 6, 10, 0.62, 2.5)
    col = ramp(grain, [(0.3, hexlin('#5b3a22')), (0.55, hexlin('#8a603d')), (0.75, hexlin('#a87a52'))])
    link(col, b.inputs['Base Color'])
    link(M('MULTIPLY_ADD', grain, 0.15, 0.38), b.inputs['Roughness'])
    bp = N.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.15; bp.inputs['Distance'].default_value = 0.0005
    L.new(grain, bp.inputs['Height']); L.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m

def handle_wood_mat():
    return pmat('손잡이_나무', hexlin('#5a3820'), rough=0.55, **{'Coat Weight': 0.3})

# ---------------------------------------------------------------- 그릇
T_SHEET = 0.0009

def pan_rings(a, b, rc, h, flare, t, rb, steps=10):
    """둥근 사각(또는 원) 팬: 안쪽 바닥 → 안쪽 벽 → 말린 테두리 → 바깥 벽 → 바깥 바닥"""
    R = [(a - flare, b - flare, max(rc - flare, 0.002), t)]
    for k in range(1, 4):   # 안쪽 바닥 모서리를 둥글게
        p = k / 4 * math.pi / 2; o = 0.004 * (1 - math.cos(p))
        R.append((a - flare + o * 0.6, b - flare + o * 0.6, max(rc - flare + o * 0.6, 0.002), t + 0.004 * math.sin(p) * 0.8))
    R.append((a, b, rc, h))
    for k in range(1, steps + 1):
        phi = 1.6 * math.pi * k / steps
        o = rb - rb * math.cos(phi)
        R.append((a + o, b + o, rc + o, h + rb * math.sin(phi)))
    R.append((a + t, b + t, rc + t, h - rb * 1.25))
    R.append((a - flare + t, b - flare + t, max(rc - flare, 0.002) + t, 0.0))
    return R

def build_sheet_pan():
    a, b = 0.165, 0.115
    V, F = shell(pan_rings(a, b, 0.016, 0.02, 0.006, T_SHEET, 0.0028), n=64)
    m = metal_mat('알루미늄_시트팬', (0.6, 0.61, 0.62), 0.45, aniso=0.3, patina=(0.55, 0.47, 0.36))
    o = add('시트팬', make_mesh('시트팬', V, F), m)
    return [o], T_SHEET

def build_loaf_tin():
    V, F = shell(pan_rings(0.1, 0.05, 0.009, 0.1, 0.006, 0.0008, 0.003), n=64)
    m = metal_mat('논스틱_식빵틀', (0.045, 0.045, 0.05), 0.42, coat=0.25, speck=0.05, metal=0.6)
    return [add('식빵틀', make_mesh('식빵틀', V, F), m)]

def build_cake_tin():
    V, F = shell(pan_rings(0.09, 0.09, 0.09, 0.07, 0.0, 0.0008, 0.0026), n=48, circle=True)
    m = metal_mat('알루미늄_케이크틀', (0.84, 0.84, 0.83), 0.26, aniso=0.6, patina=(0.62, 0.57, 0.5))
    return [add('케이크틀', make_mesh('케이크틀', V, F), m)]

def build_frying_pan(rot_z=-0.75):
    prof = [(0.0, 0.004), (0.09, 0.004)] + arc_pts(0.09, 0.028, 0.024, -math.pi / 2, -math.pi / 6, 8)[1:]
    prof += [(0.123, 0.041), (0.1255, 0.0435), (0.1275, 0.0425), (0.1265, 0.039)]
    prof += [(0.121, 0.026)] + [(0.0915 + 0.0005, 0.001), (0.0, 0.001)]
    V, F = lathe(prof, 160)
    m = metal_mat('논스틱_프라이팬', (0.035, 0.035, 0.04), 0.35, coat=0.35, speck=0.04, metal=0.4)
    rot = Matrix.Rotation(rot_z, 4, 'Z')
    objs = [add('프라이팬', make_mesh('프라이팬', V, F, merge=True), m, matrix=rot)]
    # 리벳 달린 금속 목 + 나무 손잡이
    C = [Vector((0.118 + 0.07 * i / 20, 0, 0.034 + 0.012 * i / 20)) for i in range(21)]
    V, F, _ = tube(C, [0.0075] * 21, 32, section=lambda th: (math.cos(th) * 1.4, math.sin(th) * 0.7))
    objs.append(add('손잡이_목', make_mesh('손잡이_목', V, F), metal_mat('스테인리스', (0.75, 0.74, 0.72), 0.3), matrix=rot))
    C = [Vector((0.18 + 0.15 * i / 40, 0, 0.044 + 0.022 * i / 40)) for i in range(41)]
    R = [0.012 * (0.35 + 0.65 * math.sin(math.pi * clamp(i / 40 * 1.0, 0, 1)) ** 0.25) for i in range(41)]
    V, F, _ = tube(C, R, 48, section=lambda th: (math.cos(th) * 1.25, math.sin(th) * 0.85))
    objs.append(add('손잡이_나무', make_mesh('손잡이_나무', V, F), handle_wood_mat(), matrix=rot))
    return objs

def plate_with_holes(name, a, b, rc, z_top, holes, hole_r, mat):
    """구멍 뚫린 판(머핀틀·도넛틀) — 판을 만들고 원기둥으로 불리언 차집합"""
    V, F = shell([(a, b, rc, z_top), (a, b, rc, z_top - 0.0016)], n=64, share_caps=True)
    plate = add(name, make_mesh(name, V, F, smooth_shade=False), mat)
    col = bpy.data.collections.new(name + '_구멍'); SC[0].collection.children.link(col)
    for (x, y) in holes:
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=96, radius1=hole_r, radius2=hole_r, depth=0.02)
        me = bpy.data.meshes.new('구멍'); bm.to_mesh(me); bm.free()
        c = bpy.data.objects.new('구멍', me); c.location = (x, y, z_top); col.objects.link(c)
        c.hide_render = True
    md = plate.modifiers.new('구멍', 'BOOLEAN'); md.operation = 'DIFFERENCE'
    md.operand_type = 'COLLECTION'; md.collection = col; md.solver = 'EXACT'
    # 말린 테두리
    loop = square_loop(64)
    Cc = [Vector((*rr(u, v, a + 0.002, b + 0.002, rc + 0.002), z_top - 0.0008)) for u, v in loop]
    V, F, _ = tube(Cc, [0.0028] * len(Cc), 24, closed=True)
    rim = add(name + '_테두리', make_mesh(name + '_테두리', V, F), mat)
    return [plate, rim]

MUFFIN_CUPS = [(x, y) for y in (-0.042, 0.042) for x in (-0.08, 0.0, 0.08)]
MUFFIN_TOP = 0.031
def build_muffin_tin():
    m = metal_mat('논스틱_머핀틀', (0.05, 0.05, 0.055), 0.4, coat=0.2, speck=0.05, metal=0.6)
    objs = plate_with_holes('머핀틀', 0.125, 0.087, 0.02, MUFFIN_TOP, MUFFIN_CUPS, 0.0346, m)
    prof = [(0.0352, MUFFIN_TOP + 0.0002), (0.0346, MUFFIN_TOP - 0.0008), (0.0278, 0.0035)]
    prof += arc_pts(0.0248, 0.0035, 0.003, 0.0, -math.pi / 2, 4)[1:] + [(0.0, 0.0005)]
    V, F = lathe(prof, 96)
    me = make_mesh('머핀컵', V, F, merge=True)
    for (x, y) in MUFFIN_CUPS: objs.append(add('머핀컵', me, m if not me.materials else None, loc=(x, y, 0)))
    return objs

DONUT_HOLES = [(x, y) for y in (-0.047, 0.047) for x in (-0.09, 0.0, 0.09)]
DONUT_TOP, DONUT_RP, DONUT_RO, DONUT_D = 0.02, 0.0115, 0.041, 0.016
def build_donut_pan():
    m = metal_mat('논스틱_도넛틀', (0.05, 0.05, 0.055), 0.4, coat=0.2, speck=0.05, metal=0.6)
    objs = plate_with_holes('도넛틀', 0.14, 0.097, 0.02, DONUT_TOP, DONUT_HOLES, DONUT_RO - 0.0004, m)
    rc, w = (DONUT_RP + DONUT_RO) / 2, (DONUT_RO - DONUT_RP) / 2
    prof = [(0.0, DONUT_TOP), (DONUT_RP * 0.9, DONUT_TOP)]
    prof += [(rc + w * math.cos(p), DONUT_TOP + DONUT_D * math.sin(p))
             for p in [math.pi + math.pi * k / 24 for k in range(25)]]
    prof += [(DONUT_RO + 0.0006, DONUT_TOP + 0.0002)]
    V, F = lathe(prof, 112)
    me = make_mesh('도넛홈', V, F, merge=True)
    for (x, y) in DONUT_HOLES: objs.append(add('도넛홈', me, m if not me.materials else None, loc=(x, y, 0)))
    return objs

WAF_HALF, WAF_PITCH, WAF_POCKET = 0.0655, 0.0262, 0.0094
def waffle_cell(x, y, half):
    """격자 칸 안쪽이면 1 — 칸 가장자리는 부드럽게"""
    lx = ((x + WAF_HALF) % WAF_PITCH) - WAF_PITCH / 2
    ly = ((y + WAF_HALF) % WAF_PITCH) - WAF_PITCH / 2
    e = 0.0014
    return smooth(half + e, half - e, abs(lx)) * smooth(half + e, half - e, abs(ly))

def build_waffle_iron():
    iron = metal_mat('무쇠', (0.035, 0.034, 0.033), 0.72, speck=0.35, metal=0.55)
    A = 0.082
    def top_fn(u, v, x, y):
        m = max(abs(x), abs(y))
        rim = smooth(WAF_HALF - 0.001, WAF_HALF + 0.0015, m)
        stud = waffle_cell(x, y, WAF_POCKET) if m < WAF_HALF else 0.0
        edge = smooth(1.0, 0.985, max(abs(u), abs(v)))
        return (0.009 * rim + 0.0075 * stud * (1 - rim)) * edge, 0.0
    V, F, at = grid_solid(260, (A, A, 0.012, 0.012), [(A, A, 0.012, 0.0)], (A - 0.001, A - 0.001, 0.011, 0.0), top_fn)
    me = make_mesh('와플틀_판', V, F, at)
    objs = [add('와플틀_아래판', me, iron)]
    # 뚜껑 — 경첩(뒤쪽)을 축으로 72° 열려 격자가 앞을 본다
    hy, hz = A + 0.008, 0.016
    lid_center = Matrix.Translation((0, hy + A + 0.008, 0))
    hinge = Matrix.Translation((0, hy, hz)) @ Matrix.Rotation(math.radians(74), 4, 'X') @ Matrix.Translation((0, -hy, -hz))
    objs.append(add('와플틀_뚜껑', me, None, matrix=hinge @ lid_center))
    for sx in (-1, 1):
        C = [Vector((sx * (0.03 + 0.05 * i / 10), hy, hz)) for i in range(11)]
        V, F, _ = tube(C, [0.0055] * 11, 24)
        objs.append(add('경첩', make_mesh('경첩', V, F), iron))
    wood = handle_wood_mat()
    for M_ in (Matrix.Identity(4), hinge @ lid_center @ Matrix.Scale(-1, 4, Vector((0, 1, 0)))):
        C = [Vector((0, -A - 0.06 * i / 10, 0.008)) for i in range(11)]
        V, F, _ = tube(C, [0.005] * 11, 24)
        objs.append(add('손잡이_쇠', make_mesh('손잡이_쇠', V, F), iron, matrix=M_.copy()))
        C = [Vector((0, -A - 0.055 - 0.09 * i / 30, 0.008)) for i in range(31)]
        R = [0.0105 * (0.45 + 0.55 * math.sin(math.pi * i / 30) ** 0.3) for i in range(31)]
        V, F, _ = tube(C, R, 40)
        objs.append(add('손잡이_나무', make_mesh('손잡이_나무', V, F), wood, matrix=M_.copy()))
    return objs

PIE_FLUTES = 28
def build_pie_dish():
    prof = [(0.0, 0.006), (0.085, 0.006)] + arc_pts(0.085, 0.014, 0.008, -math.pi / 2, -math.pi / 4, 4)[1:]
    prof += [(0.108, 0.038), (0.111, 0.0405), (0.124, 0.041)] + arc_pts(0.124, 0.038, 0.003, math.pi / 2, -math.pi / 2, 6)[1:]
    prof += [(0.116, 0.034), (0.104, 0.012), (0.094, 0.003), (0.09, 0.0), (0.0, 0.0)]
    n_inner = 6   # 안쪽 면 점 수 — 바깥쪽에만 물결 주름
    def rmod(th, r, z, idx):
        if idx >= 8 and idx <= len(prof) - 3:
            k = 0.0045 if idx <= 15 else 0.0035
            return r + k * math.cos(PIE_FLUTES * th)
        return r
    V, F = lathe(prof, 448, rmod)
    m = pmat('유약_도자기', hexlin('#9db8c9'), rough=0.08, **{'Coat Weight': 0.6, 'Coat Roughness': 0.03})
    return [add('파이접시', make_mesh('파이접시', V, F, merge=True), m)]

TART_FLUTES, TART_H = 34, 0.026
def tart_r(th, r):
    return r + 0.0032 * math.cos(TART_FLUTES * th)

def build_tart_pan():
    """주름진 옆벽의 검은 논스틱 타르트팬 (참고 이미지 2)"""
    prof = [(0.0, 0.0022), (0.098, 0.0022)] + arc_pts(0.098, 0.0062, 0.004, -math.pi / 2, 0.0, 4)[1:]
    prof += [(0.104, 0.012), (0.108, TART_H - 0.001)] + arc_pts(0.1095, TART_H - 0.0005, 0.0015, math.pi, 0.0, 5)[1:]
    prof += [(0.1104, TART_H - 0.004), (0.104, 0.004), (0.1, 0.0), (0.0, 0.0)]
    def rmod(th, r, z, idx):
        return tart_r(th, r) if (r > 0.099 and z > 0.003) else r
    V, F = lathe(prof, 544, rmod)
    m = metal_mat('논스틱_타르트팬', (0.045, 0.045, 0.05), 0.45, metal=0.5)
    return [add('타르트팬', make_mesh('타르트팬', V, F, merge=True), m)]

SKILLET_FLOOR = 0.0065
def build_skillet(rot_z=-0.75):
    """두꺼운 무쇠 스킬렛 — 일체형 손잡이 끝에 거는 구멍 (참고 이미지 3)"""
    prof = [(0.0, SKILLET_FLOOR), (0.082, SKILLET_FLOOR)] + arc_pts(0.082, SKILLET_FLOOR + 0.008, 0.008, -math.pi / 2, -math.pi * 0.42, 4)[1:]
    prof += [(0.101, 0.036)] + arc_pts(0.1045, 0.036, 0.0035, math.pi, 0.0, 6)[1:]
    prof += [(0.1078, 0.032), (0.1035, 0.01), (0.096, 0.0), (0.0, 0.0)]
    V, F = lathe(prof, 192)
    iron = metal_mat('무쇠_스킬렛', (0.032, 0.031, 0.033), 0.55, metal=0.4)
    rot = Matrix.Rotation(rot_z, 4, 'Z')
    objs = [add('스킬렛', make_mesh('스킬렛', V, F, merge=True), iron, matrix=rot)]
    # 손잡이 — 한 덩어리 판이 끝으로 갈수록 가늘어지고, 끝쪽에 길쭉한 구멍. 구멍 가장자리는 둥글게 말린다
    x0, L, w0, w1, t0, z0, slope = 0.097, 0.13, 0.0185, 0.0125, 0.0068, 0.031, 0.09
    hc, ha, hb = 0.193, 0.019, 0.0056
    nu, nv = lod(360, 48), lod(72, 16)
    V = []; ein = []
    for side in (1, -1):
        for i in range(nu + 1):
            s_ = i / nu; x = x0 + L * s_
            w = lerp(w0, w1, s_) * (math.sqrt(max(0.0, 1 - ((s_ - 0.75) / 0.25) ** 2)) if s_ > 0.75 else 1.0)
            for j in range(nv + 1):
                v = -1 + 2 * j / nv; y = v * w
                e = ((x - hc) / ha) ** 2 + (y / hb) ** 2
                hole = 0.0 if e < 1 else math.sqrt(clamp((e - 1) / 0.7))
                th = t0 * (1 - 0.3 * s_) * (1 - abs(v) ** 4) ** 0.5 * hole
                V.append(Vector((x, y, z0 + slope * (x - x0) + side * th))); ein.append(e < 1)
    F = []
    for k in range(2):
        for f in quads(nu + 1, nv + 1, off=k * (nu + 1) * (nv + 1)):
            if not all(ein[q] for q in f): F.append(f)
    objs.append(add('스킬렛_손잡이', make_mesh('스킬렛_손잡이', V, F, merge=True), iron, matrix=rot))
    return objs

WMOLD_C, WMOLD_HALF, WMOLD_TOP, WMOLD_FLOOR = 0.07, 0.0648, 0.022, 0.004
WMOLD_CENTERS = [(sx * WMOLD_C, sy * WMOLD_C) for sy in (-1, 1) for sx in (-1, 1)]
def build_waffle_mold():
    """4칸 와플 몰드 (참고 이미지 4) — 색은 기존 와플틀의 검은 무쇠색 그대로, 재질은 말랑한 실리콘"""
    A, rc = WMOLD_C + WMOLD_HALF + 0.013, 0.02
    def top_fn(u, v, x, y):
        lx, ly = x - math.copysign(WMOLD_C, x), y - math.copysign(WMOLD_C, y)
        qx, qy = abs(lx) - (WMOLD_HALF - 0.007), abs(ly) - (WMOLD_HALF - 0.007)
        sdf = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - 0.007
        inside = smooth(0.0016, -0.0016, sdf)
        floor = WMOLD_FLOOR + 0.0075 * waffle_cell(lx, ly, WAF_POCKET) * smooth(0.0, -0.004, sdf)
        rim = 0.0018 * smooth(A - 0.012, A - 0.006, max(abs(x), abs(y)))
        return lerp(WMOLD_TOP + rim, floor, inside), 0.0
    V, F, at = grid_solid(440, (A - 0.002, A - 0.002, rc - 0.002, 0.0), [(A, A, rc, WMOLD_TOP - 0.0015), (A, A, rc, 0.0015)],
                          (A - 0.0015, A - 0.0015, rc - 0.0015, 0.0), top_fn)
    m = pmat('실리콘_와플몰드', (0.035, 0.034, 0.033), rough=0.55, **{'Sheen Weight': 0.25, 'Specular IOR Level': 0.4})
    return [add('와플몰드', make_mesh('와플몰드', V, F, at), m)]

# ---------------------------------------------------------------- 빵
def build_shokupan():
    """식빵 한 덩이 — 틀 안에서 반죽이 하나의 둥근 지붕처럼 부풀어 올라온 모양 (참고 사진).
    가장자리는 모두 둥글다(2026-10 사용자 요청): 위에서 보면 모서리가 둥근 사각형이고, 옆면이 위로 올라가며
    사분원처럼 둥글게 말려 윗면 지붕으로 이어진다 — 옆면과 윗면 사이에 각진 모서리·턱이 없다"""
    a, b, rc, H, fl = 0.1 - 0.0006, 0.05 - 0.0006, 0.022, 0.1, 0.006
    Z0 = H - 0.02   # 옆면이 끝나고 둥근 어깨가 시작하는 높이 — 틀 위가 아니라 안쪽에서 시작한다
    RS = 0.016      # 어깨의 둥근 반지름
    HD = 0.05       # 지붕 꼭대기가 어깨 시작보다 높은 양 (틀보다 약 3cm 위)
    def top_fn(u, v, x, y):
        # 높이는 실제 위치(x,y)로 계산한다 — 격자 매개변수로 계산하면 둥근 사각 매핑이 꺾이는 대각선에 선이 생긴다.
        # 어깨: 둥근 사각형 경계까지의 거리로 사분원 — 경계에서 기울기가 세로라 옆면과 매끈하게 이어진다.
        # 모서리 반지름(rc)이 어깨 반지름(RS)보다 커서 어깨 띠 안에서는 거리장이 꺾이지 않는다
        qx, qy = abs(x) - (a - rc), abs(y) - (b - rc)
        k = 0.003   # 안쪽의 max(qx, qy)는 대각선에서 꺾인다 — 부드러운 최댓값으로
        mx = max(qx, qy) + k * math.log1p(math.exp(-abs(qx - qy) / k))
        d = math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(mx, 0.0) - rc
        t = clamp(-d / RS)
        shoulder = math.sqrt(max(0.0, 1 - (1 - t) ** 2))
        # 지붕: 길이·폭 방향의 매끈한 함수의 곱 — 거리장의 능선(가운데 선)이 지붕에 생기지 않는다
        fx = max(0.0, 1 - min(1.0, abs(x) / a) ** 4) ** 0.6
        fy = max(0.0, 1 - min(1.0, abs(y) / b) ** 2) ** 0.7
        dome = fx * fy
        return RS * 0.85 * shoulder + (HD - RS * 0.85) * dome, dome
    rings = [(a, b, rc, Z0 - 0.004), (a - fl * 0.5, b - fl * 0.5, rc - 0.002, H * 0.5)]
    V, F, at = grid_solid(260, (a, b, rc, Z0), rings, (a - fl, b - fl, rc - 0.003, 0.0012), top_fn)
    me = make_mesh('식빵', V, F, at)
    def toast(P, N, A):
        if P.z > Z0 - 0.002:   # 부풀어 오른 윗면 — 꼭대기가 진하고 어깨로 갈수록 옅게
            return 0.62 + 0.55 * smooth(0.05, 0.8, A['feat'])
        return 0.55 + 0.15 * smooth(0.0, 0.02, -P.z + 0.02)
    finalize_toast(me, toast)
    mat = crust_mat('식빵_껍질', '#efe2c4', '#d9a45b', '#8a4b26', '#4a2210', rough=0.6)
    return [add('식빵', me, mat)]

def flat_slab(name, R, H, edge_k, n=200, rings=None, warp=None, extra=None, ellipse=(1.0, 1.0)):
    """납작한 빵(쿠키·팬케이크·플랫브레드) — 둥근 어깨 + 평평한 바닥"""
    ex, ey = ellipse
    def top_fn(u, v, x, y):
        s = min(math.hypot(x / (R * ex), y / (R * ey)), 1.0)
        h = H * (1 - s ** edge_k) ** 0.5
        f = 0.0
        if extra:
            dh, f = extra(x, y, s); h += dh * (1 - s ** 8)
        return h, f
    rr_ = rings or [(R * ex, R * ey, R * min(ex, ey), H * 0.25)]
    V, F, at = grid_solid(n, (R * ex, R * ey, R * min(ex, ey), H * 0.3), rr_,
                          (R * ex * 0.965, R * ey * 0.965, R * min(ex, ey) * 0.965, 0.0), top_fn, warp=warp)
    at['s'] = [min(math.hypot(p.x / (R * ex), p.y / (R * ey)), 1.2) for p in V]
    return V, F, at

def build_cookie(colors=('#e3c592', '#c68f4e', '#7a4a20'), dust=0.0):
    R, H = 0.041, 0.0075
    warp = lambda th: 1 + 0.03 * pn(math.cos(th) * 1.6, math.sin(th) * 1.6, 0, 2.1) + 0.012 * pn(math.cos(th) * 5, math.sin(th) * 5, 0, 4)
    def extra(x, y, s):   # 오돌토돌한 윗면 (갈라짐 없이 완만한 요철만)
        return 0.0009 * pn(x * 60, y * 60, 0, 3), 0.0
    V, F, at = flat_slab('쿠키', R, H, 2.4, 220, warp=warp, extra=extra,
                         rings=[(R * 1.0, R, R, H * 0.18), (R * 0.99, R * 0.99, R * 0.99, H * 0.06)])
    me = make_mesh('쿠키', V, F, at)
    def toast(P, N, A):
        s = A['s']
        if A['topm'] > 0.5: return 0.72 + 0.6 * smooth(0.35, 1.0, s) + 0.14 * pn(P.x * 50, P.y * 50, 0, 9)
        return 1.05
    finalize_toast(me, toast)
    mat = crust_mat('쿠키_반죽', *colors, rough=0.7, mottle=0.16, sss=0.12, bump=2.2, dust=dust)
    return [add('쿠키', me, mat)]

COOKIE_SPOTS = [(x, y) for y in (0.055, -0.055) for x in (-0.1, 0.0, 0.1)]
def build_cookie_tray():
    """시트팬에 쿠키 여럿 — 큰 반죽에서 떼어 낸 작은 반죽을 납작하게 눌러 올린 모습 (게임 모양 빚기와 같은 자리)"""
    pan = build_sheet_pan()[0]
    one = build_cookie()[0]
    rnd = random.Random(21)
    objs = [one]
    one.location = (*COOKIE_SPOTS[0], T_SHEET); one.rotation_euler.z = rnd.uniform(0, 6.3)
    for (x, y) in COOKIE_SPOTS[1:]:
        objs.append(add('쿠키', one.data, None, loc=(x, y, T_SHEET), rot=(0, 0, rnd.uniform(0, 6.3))))
    return pan, objs

def cro_layers(a, soft=0.011):
    """겹겹이 만 크루아상의 겹 수(1~4) — 게임 formShapes.ts의 croLayers와 같다(soft = 겹 가장자리의 너비)"""
    L = 4.0
    for k in (1, 2, 3): L -= smooth(0.25 * k - soft, 0.25 * k + soft, a)
    return L

def build_croissant():
    """게임의 모양 빚기에서 빚은 초승달(formShapes.ts의 croCrescent)을 바탕으로 — 같은 중심선(croissantLine)·굵기 곡선·계단처럼
    또렷한 겹(가운데가 가장 바깥 겹, 겹 가장자리는 둘레를 따라 비스듬히 돈다). 오븐에서 부푼 만큼만 크다(사용자 요청: 빚은 모양 그대로 구워진다).
    게임 반죽은 이 크기의 0.92배(트레이 배율 1.45 × 0.92), 굵기는 그보다 0.9배"""
    a0, a1, M_ = math.radians(-38), math.radians(218), 360
    C = []; R = []
    for i in range(M_ + 1):
        t = i / M_; a = lerp(a0, a1, t)
        Rc = 0.05 * (1 - 0.28 * (2 * t - 1) ** 2)          # 끝으로 갈수록 반지름이 줄어 안쪽으로 말린다
        r = 0.0055 + 0.03 * math.sin(math.pi * t) ** 0.7
        C.append(Vector((Rc * math.cos(a), Rc * math.sin(a) - 0.012, r * 0.78)))
        R.append(r)
    # 구우면 겹 가장자리가 부풀어 둥글고 부드러워진다(참고 사진, 사용자 요청) — 빚은 반죽(게임)은 또렷한 계단 그대로
    stair = lambda a: 0.4 + 0.15 * cro_layers(a, 0.07)
    env = lambda v: max(0.5, 0.94 - 0.5 * v)
    def disp(i, t, th, P, radial):
        v = abs(2 * t - 1)
        tn = ((1.5 * math.pi - th) % (2 * math.pi)) / (2 * math.pi)
        a = v + 0.25 * (1 - tn)
        edge = min(abs(a - 0.25 * k) for k in (1, 2, 3))
        return R[i] * (stair(a) / env(v) - 1), max(0.0, 1 - edge / 0.06) ** 1.5
    V, F, at = tube(C, R, 160, section=lambda th: (math.cos(th), math.sin(th) * 0.92), floor=0.0, disp=disp)
    at['topm'] = [1.0] * len(V)
    me = make_mesh('크루아상', V, F, at)
    def toast(P, N, A):
        groove = A['feat']          # 겹 가장자리 사이는 덜 구워져 옅은 황금색
        return 0.98 + 0.3 * clamp(N.z) - 0.45 * groove - 0.3 * smooth(0.005, 0.0, P.z)
    finalize_toast(me, toast)
    mat = crust_mat('크루아상_껍질', '#f1dcb0', '#d59a44', '#8f4f1e', '#4f260c', rough=0.6)
    return [add('크루아상', me, mat)]

def build_pancake():
    """스킬렛에 구운 두툼한 팬케이크 — 팬 안쪽 벽을 따라 차오르고 테두리 위로 둥근 돔이 넘친다"""
    z0 = SKILLET_FLOOR + 0.0004
    wall = lambda z: 0.084 + (z - 0.0067) / 0.0293 * 0.017 - 0.0006   # 스킬렛 안쪽 벽 반지름
    R0 = 0.1036
    rot = math.radians(28)
    def cross(x, y):
        # 십자 칼집 — 가운데가 가장 넓고 깊게 벌어지고 끝으로 갈수록 닫힌다. 벌어진 가장자리는 살짝 들린다
        xr = x * math.cos(rot) + y * math.sin(rot); yr = -x * math.sin(rot) + y * math.cos(rot)
        h, cut = 0.0, 0.0
        for along, across, Wm in ((xr, yr, 0.017), (yr, xr, 0.0125)):
            L = 0.086
            if abs(along) >= L: continue
            env = (1 - (along / L) ** 2) ** 0.75
            W = Wm * env + 0.0008
            q = abs(across) / W
            bowl = max(0.0, 1 - q * q) ** 2                       # 가장자리에서 기울기 0 — 둥글고 완만하게 꺼진다
            lip = math.exp(-((q - 1.1) / 0.45) ** 2) * env          # 벌어진 가장자리는 낮고 넓게 둥글게 들린다
            h += -0.0095 * env * bowl + 0.0012 * lip
            cut = max(cut, max(0.0, 1 - (q / 0.85) ** 2) ** 1.5 * env ** 0.5)
        return h, cut
    def top_fn(u, v, x, y):
        s = min(math.hypot(x, y) / R0, 1.0)
        dh, cut = cross(x, y)
        return 0.05 * (1 - s ** 2) ** 0.6 + dh, cut
    rings = [(0.1049,) * 3 + (0.0435,), (0.1036,) * 3 + (0.0402,), (wall(0.0355),) * 3 + (0.0355,),
             (wall(0.02),) * 3 + (0.02,)]
    V, F, at = grid_solid(320, (R0,) * 3 + (0.0472,), rings, (wall(z0) - 0.0006,) * 3 + (z0,), top_fn)
    # 칼집이 만든 높이 변위 — 게임 오븐은 굽는 중간에 칼집을 내기 전까지 이걸 되돌려 둔다(_score)
    at['score'] = [cross(p.x, p.y)[0] if at['topm'][i] > 0.5 else 0.0 for i, p in enumerate(V)]
    me = make_mesh('팬케이크', V, F, at)
    def toast(P, N, A):
        if A['topm'] > 0.5:
            s_ = min(math.hypot(P.x, P.y) / R0, 1.0)
            c = A['feat']   # 칼집 속은 연한 노란 속살, 벌어진 가장자리는 노릇하게
            return (0.98 + 0.12 * s_ ** 3) * (1 - c) + 0.04 * c + 0.7 * c * (1 - c)
        return 0.95 if P.z < 0.036 else 0.8
    finalize_toast(me, toast)
    mat = crust_mat('팬케이크', '#f2dfb4', '#d9a352', '#8a5424', rough=0.65)
    return [add('팬케이크', me, mat)]

# 게임의 모양 빚기에서 다 감싸 이은 고리(formShapes.ts의 BAGEL_RING_R·BAGEL_TUBE_R)와 같은 모양 — 트레이 배율(TRAY_SCALE 1.45)로 나눈 값.
# 굵기만 오븐에서 부푼 만큼(1.1배) 굵다(사용자 요청: 빚은 모양 그대로 구워진다). 감싼 이음매(고리 뒤쪽, +y)는 튀어나오지 않고
# 덜 구워진 옅은 선으로만 남는다(사용자 요청)
BAGEL_RING = 0.040502 / 1.45
BAGEL_TUBE = 0.022524 * 1.1 / 1.45
BAGEL_OVERLAP = 0.16
BAGEL_LIP = 0.035
def bagel_seam_d(th, s_):
    """이음매에서 잰 각 거리 — 게임 좌표의 고리 각 th(= atan2(-y, x)), 관의 높이 비율 s_. formShapes.ts bagelSeamD와 같다"""
    edge = -math.pi / 2 - math.pi * BAGEL_OVERLAP - 0.16 * max(0.0, s_) ** 0.8 + 0.05
    d = th - edge
    return math.atan2(math.sin(d), math.cos(d))

def build_bagel():
    """감싼 끝의 가장자리가 관을 둘러 옅은 접힌 선(살짝 덮인 턱 + 골)으로 남는다 — 게임의 bagelRing과 같은 식(참고 사진, 사용자 요청)"""
    Rc, r, M_ = BAGEL_RING, BAGEL_TUBE, 260
    C = [Vector((Rc * math.cos(2 * math.pi * i / M_), Rc * math.sin(2 * math.pi * i / M_), r * 0.78)) for i in range(M_)]
    R = [r] * M_
    def disp(i, t, th, P, radial):
        s_ = max(-1.0, min(1.0, (P.z - r * 0.78) / (r * 0.92)))
        d = bagel_seam_d(math.atan2(-P.y, P.x), s_)
        lip = BAGEL_LIP * smooth(0, 0.04, d) * (1 - smooth(0.6, 1.1, d)) if d > 0 else 0.0
        groove = math.exp(-(d / 0.035) ** 2)
        return r * (lip - 0.05 * groove), groove
    V, F, at = tube(C, R, 120, closed=True, section=lambda th: (math.cos(th), math.sin(th) * 0.92), floor=0.0, disp=disp)
    at['topm'] = [1.0] * len(V)
    me = make_mesh('베이글', V, F, at)
    def toast(P, N, A):
        base = 0.82 + 0.45 * clamp(N.z) ** 0.7 - 0.2 * smooth(0.25, -0.1, N.z) + 0.25 * smooth(0.003, 0.0, P.z)
        return base * (1 - 0.3 * A['feat'])   # 골은 덜 구워져 옅은 선
    finalize_toast(me, toast)
    mat = crust_mat('베이글_껍질', '#e8d4a6', '#cf9a4d', '#81451c', rough=0.28, coat=0.65, coat_rough=0.18, mottle=0.12)
    return [add('베이글', me, mat)]

def build_flatbread(R=0.076, H=0.0092, nb=40, seed=11):
    """동그란 피타 — 도톰하고 둥근 가장자리, 윗면에 군데군데 주황빛으로 구워진 반점"""
    rnd = random.Random(seed)
    bubbles = []
    for _ in range(nb):
        ang = rnd.uniform(0, 2 * math.pi); d = rnd.uniform(0, 0.88) ** 0.6 * R * 0.95
        bubbles.append((math.cos(ang) * d, math.sin(ang) * d, rnd.uniform(0.004, 0.012) * (R / 0.076) ** 0.5, rnd.uniform(0.0015, 0.0048) * (R / 0.076) ** 0.5))
    def extra(x, y, s):
        # 처음 버전처럼 솟아오른 기포 — 꼭대기가 구워져 반점이 된다
        h = 0.0; peak = 0.0
        for (bx, by, br, bh) in bubbles:
            d = math.hypot(x - bx, y - by)
            br2 = br * 1.35   # 밑단을 넓게 — 같은 크기로 보이면서 바닥과 매끈하게 이어진다
            if d < br2:
                k = (1 - (d / br2) ** 2) ** 2.2
                h += bh * k; peak = max(peak, k * bh / 0.0048)
        return h, peak
    warp = lambda th: 1 + 0.012 * pn(math.cos(th) * 1.5, math.sin(th) * 1.5, 0, 5.2)
    V, F, at = flat_slab('플랫브레드', R, H, 3.0, 240, warp=warp, extra=extra,
                         rings=[(R, R, R, H * 0.22), (R * 0.99, R * 0.99, R * 0.99, H * 0.07)])
    me = make_mesh('플랫브레드', V, F, at)
    def toast(P, N, A):
        if A['topm'] < 0.5: return 0.55
        spot = smooth(0.2, 0.95, A['feat'])
        return 0.42 + 0.25 * smooth(0.7, 1.0, A['s']) + 1.2 * spot ** 1.1
    finalize_toast(me, toast)
    mat = crust_mat('플랫브레드', '#f4e8ca', '#e2ac62', '#b8692c', '#8a4a1c', rough=0.7)
    return [add('플랫브레드', me, mat)]

# 플랫브레드 넷 — 반죽을 방사형으로 넷으로 나눠 하나씩 빚은 것 (게임 모양 빚기 formShapes.ts의 FLAT_SPOTS와 같은 자리)
FLAT_SPOTS = [(x, y) for y in (0.05, -0.05) for x in (-0.072, 0.072)]
FLAT_R = 0.046
def build_flatbread_tray():
    pan = build_sheet_pan()[0]
    objs = []
    for i, (x, y) in enumerate(FLAT_SPOTS):
        o = build_flatbread(FLAT_R, 0.0085, 14, 11 + i)[0]
        o.location = (x, y, T_SHEET)
        objs.append(o)
    return pan, objs

def build_baguette():
    L, r0, M_ = 0.36, 0.029, 420
    C = []; R = []
    for i in range(M_ + 1):
        t = i / M_; x = (t - 0.5) * L
        C.append(Vector((x, 0.0015 * math.sin(t * 5), r0 * 0.7)))
        R.append(r0 * max(1 - abs(2 * t - 1) ** 3.5, 0.0) ** 0.5 + 0.0015)
    # 칼집 셋 — 게임 모양 빚기(formShapes.ts의 BAGUETTE_SCORES)와 같은 자리·각도
    scores = [L * u for u in (-0.22, 0.0, 0.22)]
    al, Ls, Wm = math.radians(14), 0.072, 0.0075
    score_d = []   # 정점마다 칼집이 벌어지며 생긴 변위 — 게임 오븐이 이걸 되돌렸다가 서서히 벌린다(_score)
    def disp(i, t, th, P, radial):
        d, f = disp0(i, t, th, P, radial)
        score_d.append(d)
        return d, f
    def disp0(i, t, th, P, radial):
        if radial.z < 0.25: return 0.0, 0.0
        d = 0.0; f = 0.0
        for xk in scores:
            s = (P.x - xk) * math.cos(al) + P.y * math.sin(al)
            w = -(P.x - xk) * math.sin(al) + P.y * math.cos(al)
            if abs(s) >= Ls / 2: continue
            env = (1 - (2 * s / Ls) ** 2) ** 0.5
            Wd = Wm * env
            if Wd < 1e-5: continue
            q = w / Wd
            inside = smooth(1.0, 0.8, abs(q))
            ear = math.exp(-((q + 1.05) / 0.3) ** 2) * env   # 칼집 한쪽이 들려 '귀'가 된다
            d += -0.0045 * inside * (1 - q * q * 0.6) * env + 0.0032 * ear
            f = max(f, inside * env, -ear * 0.0)
        return d, f
    V, F, at = tube(C, R, 160, section=lambda th: (math.cos(th) * 1.05, math.sin(th) * 0.82), floor=0.0, disp=disp)
    at['topm'] = [clamp((p.z - 0.015) / 0.02) for p in V]
    at['score'] = score_d + [0.0] * (len(V) - len(score_d))   # 양 끝 마개 정점은 칼집 밖
    me = make_mesh('바게트', V, F, at)
    def toast(P, N, A):
        base = 1.1 + 0.2 * clamp(N.z) + 0.2 * smooth(0.13, 0.18, abs(P.x))
        return base - 0.75 * A['feat']   # 칼집 속은 크림빛
    finalize_toast(me, toast)
    mat = crust_mat('바게트_껍질', '#efe0bd', '#cf9647', '#7d4318', '#3e1d08', rough=0.6, mottle=0.2, flour=0.45, bump=1.4)
    return [add('바게트', me, mat, rot=(0, 0, math.radians(32)))]

def build_cupcakes():
    # 주름 종이컵 — 머핀틀 컵 안쪽에 맞는다
    zb, zt, rb, rt = 0.0011, MUFFIN_TOP + 0.0045, 0.0242, 0.0352
    prof = [(0.0, zb)] + [(lerp(rb, rt, k / 40), lerp(zb + 0.0015, zt, k / 40)) for k in range(41)]
    prof.insert(1, (rb - 0.001, zb))
    def pleat(th, r, z, idx):
        if idx < 2: return r
        tri = abs(((th * 36 / (2 * math.pi)) % 1) - 0.5) * 2
        return r * (1 - 0.035 * tri)
    V, F = lathe(prof, 360, pleat)
    liner_me = make_mesh('컵받침', V, F, merge=True, smooth_shade=False)
    liner_m = pmat('종이컵', hexlin('#e7a7b3'), rough=0.65, **{'Sheen Weight': 0.4, 'Subsurface Weight': 0.15})
    rl = lambda z: lerp(rb, rt, (z - zb) / (zt - zb)) * (1 - 0.035)
    R0 = 0.0335
    def top_fn(u, v, x, y):
        s = min(math.hypot(x, y) / R0, 1.0)
        h = 0.0145 * (1 - s ** 2.2) ** 0.62
        return h, s
    rings = [(R0, R0, R0, zt - 0.0002), (rl(zt - 0.002) * 0.985,) * 3 + (zt - 0.0025,),
             (rl(0.016) * 0.99,) * 3 + (0.016,)]
    V, F, at = grid_solid(150, (R0 + 0.0002, R0 + 0.0002, R0 + 0.0002, zt + 0.0012), rings,
                          (rl(zb) * 0.98,) * 3 + (zb + 0.0012,), top_fn)
    me = make_mesh('컵케이크', V, F, at)
    def toast(P, N, A):
        if A['topm'] < 0.5: return 0.45
        return 0.82 + 0.4 * A['feat'] ** 2 + 0.08 * pn(P.x * 80, P.y * 80, 0, 2)
    finalize_toast(me, toast)
    mat = crust_mat('컵케이크', '#f3e2b8', '#dfaa5a', '#93582a', rough=0.65, mottle=0.12, sss=0.25, bump=1.2)
    rnd = random.Random(5); objs = []
    for (x, y) in MUFFIN_CUPS:
        r = rnd.uniform(0, 6.28)
        objs.append(add('컵케이크', me, mat if not me.materials else None, loc=(x, y, 0), rot=(0, 0, r)))
        objs.append(add('컵받침', liner_me, liner_m if not liner_me.materials else None, loc=(x, y, 0), rot=(0, 0, r)))
    return objs

def build_pretzel():
    """통통한 프레첼 — 가운데에서 두 팔이 한 바퀴 반 서로 감겨 꼬이고, 끝은 아래쪽 배 위에 얹힌다 (참고 사진)"""
    S = 0.08
    R_tw, y0, y1, turns = 0.13, -0.42, 0.2, 1.0
    def twist(phi0, upward, n=16):
        # 꼬임 축(y0→y1)을 따라 두 팔이 반대편에서 서로를 감고 돈다 — 한 팔이 위로 지날 때 다른 팔은 아래로
        out = []
        for k in range(n + 1):
            t = k / n if upward else 1 - k / n
            ph = phi0 + turns * 2 * math.pi * t
            out.append((R_tw * math.cos(ph), lerp(y0, y1, t), R_tw * S * math.sin(ph) * 0.95, 0.11))
        return out
    belly_z = 0.17 * S * 1.35
    P = [(0.56, -0.62, belly_z, 0.1), (0.36, -0.52, 0.006, 0.11)] + twist(0.0, True) + [
         (0.34, 0.38, 0, 0.13), (0.68, 0.6, 0, 0.14), (1.04, 0.47, 0, 0.15), (1.18, 0.06, 0, 0.155),
         (1.03, -0.38, 0, 0.165), (0.63, -0.69, 0, 0.17), (0.0, -0.81, 0, 0.175), (-0.63, -0.69, 0, 0.17),
         (-1.03, -0.38, 0, 0.165), (-1.18, 0.06, 0, 0.155), (-1.04, 0.47, 0, 0.15), (-0.68, 0.6, 0, 0.14),
         (-0.34, 0.38, 0, 0.13)] + twist(math.pi, False) + [(-0.36, -0.52, 0.006, 0.11), (-0.56, -0.62, belly_z, 0.1)]
    pts = [Vector((x * S, y * S, zo, r * S)) for x, y, zo, r in P]
    Cs = catmull(pts, 12)
    C = []; R = []
    n = len(Cs)
    for i, q in enumerate(Cs):
        t = i / (n - 1)
        r = q[3] * (0.8 + 0.2 * smooth(0.0, 0.03, t) * smooth(1.0, 0.97, t))
        C.append(Vector((q[0], q[1], r * 0.78 + q[2]))); R.append(r)
    V, F, at = tube(C, R, 72, section=lambda th: (math.cos(th) * 1.05, math.sin(th) * 0.8), floor=0.0)
    at['topm'] = [1.0] * len(V)
    me = make_mesh('프레첼', V, F, at)
    def toast(P_, N, A):
        return 0.95 + 0.32 * clamp(N.z) - 0.3 * smooth(0.003, 0.0, P_.z)
    finalize_toast(me, toast)
    mat = crust_mat('프레첼_껍질', '#e8c690', '#d08a3c', '#9a5220', '#6a3414', rough=0.6)
    objs = [add('프레첼', me, mat)]
    # 굵은 소금 알갱이
    rnd = random.Random(3); Vs = []; Fs = []
    cand = [v for v in me.vertices if v.normal.z > 0.55]
    for v in rnd.sample(cand, min(80, len(cand))):
        s = rnd.uniform(0.0011, 0.0022)
        Mx = Matrix.Translation(v.co + v.normal * s * 0.25) @ Matrix.Rotation(rnd.uniform(0, 6.3), 4, 'Z') \
            @ Matrix.Rotation(rnd.uniform(0, 6.3), 4, 'X') @ Matrix.Diagonal((s * rnd.uniform(0.7, 1.2), s, s * rnd.uniform(0.5, 0.9), 1))
        off = len(Vs)
        for c in [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]:
            Vs.append(Mx @ Vector(c) * 1.0)
        Fs += [(off + a, off + b, off + c, off + d) for a, b, c, d in
               ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7))]
    salt = pmat('굵은소금', (0.93, 0.93, 0.92), rough=0.25, **{'Transmission Weight': 0.55, 'IOR': 1.54})
    objs.append(add('소금', make_mesh('소금', [v.to_3d() if len(v) == 4 else v for v in Vs], Fs, smooth_shade=False), salt))
    return objs

def build_doughnuts():
    rc, w = (DONUT_RP + DONUT_RO) / 2, (DONUT_RO - DONUT_RP) / 2
    M_ = 200
    C = [Vector((rc * math.cos(2 * math.pi * i / M_), rc * math.sin(2 * math.pi * i / M_), DONUT_TOP)) for i in range(M_)]
    R = [w * 0.975] * M_
    def section(th):
        s = math.sin(th)
        return math.cos(th), s * (DONUT_D / w * 0.97 if s < 0 else 0.95)
    def disp(i, t, th, P, radial):
        return 0.0, 0.0
    V, F, at = tube(C, R, 120, closed=True, section=section, disp=disp)
    at['topm'] = [1.0] * len(V)
    me = make_mesh('도넛', V, F, at)
    def toast(P, N, A):
        if P.z > DONUT_TOP: return 0.85 + 0.35 * (1 - clamp(N.z)) + 0.08 * pn(P.x * 60, P.y * 60, 0, 1)
        return 0.95
    finalize_toast(me, toast)
    mat = crust_mat('도넛', '#f1ddb0', '#d49a4e', '#8a4f22', rough=0.55, mottle=0.12, sss=0.25)
    rnd = random.Random(8)
    return [add('도넛', me, mat if i == 0 else None, loc=(x, y, 0), rot=(0, 0, rnd.uniform(0, 6.3)))
            for i, (x, y) in enumerate(DONUT_HOLES)]

WAFFLE_SMOOTH = [False]   # 오븐 속 와플 — 윗면에 격자가 없다(격자는 몰드에 닿는 아랫면). 도감 그림은 격자가 보이는 쪽
def build_waffle():
    A, zb, Hh = 0.0632, 0.0125, 0.0215
    def top_fn(u, v, x, y):
        edge = (1 - abs(u) ** 14) ** 0.35 * (1 - abs(v) ** 14) ** 0.35
        if WAFFLE_SMOOTH[0]:
            return Hh * edge * (0.86 + 0.14 * (1 - (u * u + v * v) / 2)), 0.0
        pocket = waffle_cell(x, y, WAF_POCKET * 0.98)
        return Hh * edge - 0.0095 * pocket * edge ** 3, pocket
    V, F, at = grid_solid(320, (A, A, 0.007, zb + 0.004), [(A, A, 0.007, zb + 0.002)], (A - 0.0005, A - 0.0005, 0.0065, zb), top_fn)
    me = make_mesh('와플', V, F, at)
    def toast(P, N, A_):
        if A_['topm'] < 0.5: return 0.85
        return 1.2 - 0.45 * A_['feat'] + 0.12 * pn(P.x * 50, P.y * 50, 0, 3)
    finalize_toast(me, toast)
    mat = crust_mat('와플', '#f1dca8', '#dba350', '#8e5620', rough=0.5, mottle=0.12, sss=0.2, coat=0.15)
    return [add('와플', me, mat)]

PIE_EMPTY = [False]   # 토핑 없는 파이 — 필링 없이 속이 빈 크러스트(도감 그림)
def build_pie():
    """타르트팬에 담긴 격자 파이 — 바닥 크러스트(판) + 사과 필링 + 위 크러스트(엮은 격자·테두리).
    테두리 크러스트가 팬의 주름을 따라간다"""
    objs = []
    Rf = 0.101
    def top_fn(u, v, x, y):
        s = min(math.hypot(x, y) / Rf, 1)
        return 0.006 * (1 - s ** 2) + 0.0012 * max(0, pn(x * 55, y * 55, 0, 5)) * (1 - s ** 6), 0.0
    # 바닥 크러스트 — 타르트팬 안쪽(바닥·주름진 옆벽)을 따라 깔린 얇은 반죽 판. 필링은 그 안에 담긴다
    crust_prof = [(0.0, 0.0026), (0.0968, 0.0026)] + arc_pts(0.0968, 0.0066, 0.004, -math.pi / 2, 0.0, 4)[1:]
    crust_prof += [(0.1022, 0.012), (0.1062, TART_H + 0.0004)] + arc_pts(0.1042, TART_H + 0.0004, 0.002, 0.0, math.pi, 5)[1:]
    crust_prof += [(0.0985, 0.012), (0.094, 0.0071), (0.0, 0.0071)]
    def crust_rmod(th, r, z, idx):
        return tart_r(th, r) - 0.0006 if (r > 0.097 and z > 0.004) else r
    V, F = lathe(crust_prof, 544, crust_rmod)
    bme = make_mesh('파이_바닥', V, F, merge=True)
    finalize_toast(bme, lambda P, N, A: 0.9 + 0.2 * smooth(0.012, TART_H, P.z))
    Rf = 0.0965
    V, F, at = grid_solid(160, (Rf, Rf, Rf, 0.019), [(0.095, 0.095, 0.095, 0.012)], (0.092, 0.092, 0.092, 0.0075), top_fn)
    fill = bpy.data.materials.new('사과필링'); fill.use_nodes = True
    N, L, link, M, noise_tex, mixc, ramp = node_tools(fill.node_tree)
    b = N['Principled BSDF']; tc = N.new('ShaderNodeTexCoord').outputs['Object']
    link(ramp(noise_tex(tc, 40, 2), [(0.35, toon('#b8661c', 1.2, 1.1)), (0.7, toon('#e0a03c', 1.25, 1.1))]), b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.4; b.inputs['Subsurface Weight'].default_value = 0.4
    b.inputs['Subsurface Radius'].default_value = (1.0, 0.6, 0.2); b.inputs['Subsurface Scale'].default_value = 0.004
    if not PIE_EMPTY[0]: objs.append(add('필링', make_mesh('필링', V, F, at), fill))
    crust = crust_mat('파이_껍질', '#f0dcae', '#d99f4f', '#8c4f1f', rough=0.6)
    objs.append(add('파이_바닥', bme, crust))
    # 엮은 격자
    pos = [-0.079, -0.0474, -0.0158, 0.0158, 0.0474, 0.079]
    Rl, sp, amp = 0.1, 0.0316, 0.0029
    Vs, Fs = [], []
    for axis in (0, 1):
        for k, c in enumerate(pos):
            Lh = math.sqrt(max(Rl ** 2 - c ** 2, 0))
            C = []
            for i in range(121):
                s_ = -Lh + 2 * Lh * i / 120
                x, y = (s_, c) if axis == 0 else (c, s_)
                rr2 = (x * x + y * y) / 0.104 ** 2
                weave = math.cos(math.pi * (s_ - pos[0]) / sp) * (-1) ** k * (1 if axis == 0 else -1)
                C.append(Vector((x, y, 0.0215 + 0.007 * (1 - rr2) + amp * weave)))
            V, F, at = tube(C, [0.0094] * len(C), 40, section=lambda th: (
                math.copysign(abs(math.cos(th)) ** 0.33, math.cos(th)), math.copysign(abs(math.sin(th)) ** 0.33, math.sin(th)) * 0.25))
            off = len(Vs); Vs += V; Fs += [tuple(i + off for i in f) for f in F]
    me = make_mesh('파이_격자', Vs, Fs, {'topm': [1.0] * len(Vs)})
    finalize_toast(me, lambda P, N, A: 0.98 + 0.35 * (1 - clamp(N.z)))
    objs.append(add('파이_격자', me, crust))
    # 테두리 크러스트 — 타르트팬 주름 안쪽을 따라 물결친다
    M_ = 680; C = []
    for i in range(M_):
        a = 2 * math.pi * i / M_
        r_ = tart_r(a, 0.1032)
        C.append(Vector((r_ * math.cos(a), r_ * math.sin(a), TART_H + 0.0012)))
    V, F, at = tube(C, [0.0074] * M_, 56, closed=True, section=lambda th: (math.cos(th) * 1.05, math.sin(th) * 0.9))
    at['topm'] = [1.0] * len(V)
    me = make_mesh('파이_테두리', V, F, at)
    crest_of = lambda P: 0.5 + 0.5 * math.cos(TART_FLUTES * math.atan2(P.y, P.x))
    finalize_toast(me, lambda P, N, A: 1.0 + 0.25 * crest_of(P) + 0.25 * clamp(N.z))
    objs.append(add('파이_테두리', me, crust))
    return objs

def build_waffles_in_mold():
    """와플 4장 — 몰드 칸마다 하나씩, 칸 바닥의 격자 돌기 위에 앉는다"""
    w = build_waffle()[0]
    objs = [w]
    w.location = (*WMOLD_CENTERS[0], -0.0062)
    for (x, y) in WMOLD_CENTERS[1:]:
        objs.append(add('와플', w.data, None, loc=(x, y, -0.0062)))
    return objs

def build_cake():
    R, zr = 0.0893, 0.058
    def top_fn(u, v, x, y):
        s = min(math.hypot(x, y) / 0.086, 1)
        return 0.0105 * (1 - s ** 2) ** 0.85, s
    rings = [(0.0878,) * 3 + (zr + 0.0035,), (R,) * 3 + (zr,), (R,) * 3 + (0.02,)]
    V, F, at = grid_solid(200, (0.086,) * 3 + (zr + 0.006,), rings, (R - 0.0003,) * 3 + (0.0009,), top_fn)
    me = make_mesh('케이크', V, F, at)
    def toast(P, N, A):
        if A['topm'] > 0.5: return 1.06 + 0.25 * A['feat'] ** 3
        return 0.55 if P.z < zr else 0.95
    finalize_toast(me, toast)
    mat = crust_mat('케이크', '#f4e3b8', '#dea85a', '#915a2c', rough=0.62, mottle=0.14, sss=0.25, bump=1.1)
    return [add('케이크', me, mat)]

# ---------------------------------------------------------------- 장면
def enable_gpu():
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for t in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI', 'METAL'):
            try:
                prefs.compute_device_type = t; prefs.get_devices()
                devs = [d for d in prefs.devices if d.type == t]
                if devs:
                    for d in prefs.devices: d.use = d.type == t
                    log('GPU', t, [d.name for d in devs]); return True
            except Exception: pass
    except Exception as e: log('gpu err', e)
    log('CPU 렌더'); return False
GPU = enable_gpu()

HDRI = None
try:
    wdir = bpy.utils.system_resource('DATAFILES', path='studiolights/world')
    names = sorted(os.listdir(wdir)) if wdir and os.path.isdir(wdir) else []
    pick = next((n for n in names if 'interior' in n), names[0] if names else None)
    if pick: HDRI = os.path.join(wdir, pick)
except Exception as e: log('hdri err', e)
log('HDRI', HDRI)

MINT = '#b4cdbf'
def setup_scene(sc):
    """카툰 스타일 — 민트색 이음매 없는 배경(사이클로라마), 부드러운 주변광, 낮은 대비"""
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
    try: sc.cycles.device = 'GPU' if GPU else 'CPU'
    except Exception: pass
    sc.render.resolution_x = sc.render.resolution_y = RES
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    w = bpy.data.worlds.new('민트'); w.use_nodes = True; sc.world = w
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (*hexlin(MINT), 1); bg.inputs['Strength'].default_value = 0.9
    # 바닥에서 뒤로 부드럽게 휘어 올라가는 배경
    prof = [(-3.0, 0.0), (0.6, 0.0)] + [(0.6 + 0.8 * math.sin(a), 0.8 - 0.8 * math.cos(a))
                                        for a in [math.pi / 2 * k / 16 for k in range(1, 17)]] + [(1.4, 3.0)]
    V = []; F = []
    for (y, z) in prof:
        V += [Vector((-4, y, z)), Vector((4, y, z))]
    for i in range(len(prof) - 1):
        F.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
    add('배경', make_mesh('배경', V, F), pmat('민트_배경', hexlin(MINT), rough=0.95, **{'Specular IOR Level': 0.2}), loc=(0, 0, -0.0002))

def light(name, kind, loc, target, size, power, color=(1, 1, 1)):
    l = bpy.data.lights.new(name, kind); l.energy = power; l.color = color
    if kind == 'AREA': l.size = size
    else: l.shadow_soft_size = size
    o = add(name, l, None, loc=loc)
    d = Vector(target) - Vector(loc)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return o

def frame_camera(sc, objs, el=32, az=-22, lens=70, fstop=6.3, margin=1.1, lift=0.0):
    pts = []
    for o in objs:
        if o.type != 'MESH': continue
        # matrix_world·bound_box는 depsgraph 갱신 전이라 믿을 수 없다 — 정점과 matrix_basis로 직접 계산
        mw = o.matrix_basis; vs = o.data.vertices
        step = max(1, len(vs) // 4000)
        pts += [mw @ vs[i].co for i in range(0, len(vs), step)]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    tgt = (lo + hi) / 2; tgt.z = lo.z + (hi.z - lo.z) * (0.45 + lift)
    e, a = math.radians(el), math.radians(az)
    back = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    fwd = -back
    right = fwd.cross(Vector((0, 0, 1))).normalized(); up = right.cross(fwd).normalized()
    cam = bpy.data.cameras.new('카메라'); cam.lens = lens; cam.sensor_width = 36
    half = math.atan(18 / lens)
    d = 0.0
    for p in pts:
        q = p - tgt
        d = max(d, q.dot(fwd) + max(abs(q.dot(right)), abs(q.dot(up))) / math.tan(half))
    d *= margin
    co = add('카메라', cam, None, loc=tgt + back * d)
    co.rotation_euler = fwd.to_track_quat('-Z', 'Y').to_euler()
    cam.dof.use_dof = False
    sc.camera = co
    # 조명: 왼쪽 뒤 큰 창문빛(키) + 오른쪽 앞 반사판(채움) + 뒤쪽 림
    s = max(d, 0.25)
    light('키', 'AREA', tgt + Vector((-0.8, 0.45, 1.0)) * s, tgt, 1.8 * s, 42 * s * s, (1.0, 0.93, 0.82))
    light('채움', 'AREA', tgt + Vector((0.9, -0.8, 0.5)) * s, tgt, 1.6 * s, 7 * s * s, (0.95, 0.98, 1.0))
    return co


# ================================================================ 스테이지 에셋 (반죽·토핑 단계)
from mathutils.bvhtree import BVHTree

def sharp_by_angle(me, deg=35):
    """각진 모서리만 날카롭게 — 평평한 면과 둥근 모서리가 함께 있는 물체의 매끈한 셰이딩"""
    bm = bmesh.new(); bm.from_mesh(me)
    lim = math.radians(deg)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > lim: e.smooth = False
    for f in bm.faces: f.smooth = True
    bm.to_mesh(me); bm.free()

def soft_mat(name, hexc, rough=0.5, sss=0.0, sheen=0.0, sat=1.15, val=1.04, **kw):
    m = pmat(name, toon(hexc, sat, val), rough=rough, **kw)
    b = m.node_tree.nodes['Principled BSDF']
    if sss:
        b.inputs['Subsurface Weight'].default_value = sss
        b.inputs['Subsurface Radius'].default_value = (1.0, 0.65, 0.4)
        b.inputs['Subsurface Scale'].default_value = 0.005
    if sheen: b.inputs['Sheen Weight'].default_value = sheen
    return m

# ---- 볼 — 게임 반죽 화면의 갈색 볼 (굽 → 둥근 몸통 → 둥근 입술 → 안쪽)
BOWL_RT, BOWL_H, BOWL_HD, BOWL_T = 0.12, 0.085, 0.08, 0.008
BOWL_FLOOR = BOWL_H - (BOWL_HD - BOWL_T)   # 안쪽 바닥 높이
def bowl_inner_r(z):
    hi = BOWL_HD - BOWL_T
    c = clamp((BOWL_H - z) / hi, 0.0, 1.0)
    return (BOWL_RT - BOWL_T) * math.sqrt(max(0.0, 1 - c * c))

def build_bowl():
    a0 = math.asin(0.045 / BOWL_RT)
    prof = [(0.0, 0.0), (0.043, 0.0)] + arc_pts(0.043, 0.003, 0.003, -math.pi / 2, 0.0, 4)[1:] + [(0.046, 0.008)]
    prof += [(BOWL_RT * math.sin(a), BOWL_H - BOWL_HD * math.cos(a)) for a in [a0 + (math.pi / 2 - a0) * k / 24 for k in range(25)]]
    prof += arc_pts(BOWL_RT - BOWL_T / 2, BOWL_H, BOWL_T / 2, 0.0, math.pi, 8)[1:]
    hi = BOWL_HD - BOWL_T
    prof += [((BOWL_RT - BOWL_T) * math.sin(a), BOWL_H - hi * math.cos(a)) for a in [math.pi / 2 * (1 - k / 24) for k in range(1, 25)]]
    V, F = lathe(prof, 192)
    m = soft_mat('볼_유약', '#7b5236', rough=0.32, sat=1.05, val=1.0)
    return [add('볼', make_mesh('볼', V, F, merge=True), m)]

# ---- 반죽 덩어리 — 재료를 막 섞은 거친 반죽(울퉁불퉁 + 밀가루 얼룩)과 다 치댄 매끈한 반죽
def dough_mat(name, hexc, flour):
    m = bpy.data.materials.new(name); m.use_nodes = True
    N, L, link, M, noise_tex, mixc, ramp = node_tools(m.node_tree)
    b = N['Principled BSDF']; tc = N.new('ShaderNodeTexCoord').outputs['Object']
    col = (*toon(hexc, 1.1, 1.05), 1.0)
    if flour > 0:
        fm = N.new('ShaderNodeMapRange'); link(noise_tex(tc, 45, 4, 0.55), fm.inputs['Value'])
        fm.inputs['From Min'].default_value = 0.55; fm.inputs['From Max'].default_value = 0.68
        col = mixc(M('MULTIPLY', fm.outputs['Result'], flour), col, (0.97, 0.96, 0.93, 1.0))
    link(col, b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.6
    b.inputs['Subsurface Weight'].default_value = 0.5
    b.inputs['Subsurface Radius'].default_value = (1.0, 0.8, 0.55)
    b.inputs['Subsurface Scale'].default_value = 0.008
    b.inputs['Sheen Weight'].default_value = 0.3
    return m

def build_dough(rough, base_z, R=(0.068, 0.062, 0.04)):
    nu, nv = 120, 80
    seed = 4.2 if rough else 1.3
    V = []
    for i in range(nu):
        ph = 2 * math.pi * i / nu
        for j in range(nv + 1):
            th = math.pi * j / nv
            p = Vector((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)))
            if rough:   # 덜 섞인 반죽 — 큼직한 덩어리와 접힌 자국
                k = 1 + 0.17 * pn(p.x * 2.4, p.y * 2.4, p.z * 2.4, seed) + 0.06 * pn(p.x * 6, p.y * 6, p.z * 6, seed + 3)
            else:       # 매끈하게 치댄 반죽 — 아주 완만한 출렁임만
                k = 1 + 0.025 * pn(p.x * 1.8, p.y * 1.8, p.z * 1.8, seed)
            q = Vector((p.x * R[0] * k, p.y * R[1] * k, p.z * R[2] * k))
            if q.z < -R[2] * 0.55: q.z = -R[2] * 0.55 + (q.z + R[2] * 0.55) * 0.08   # 바닥에 닿아 눌린 밑면
            V.append(q)
    F = quads(nu, nv + 1, wu=True)
    me = make_mesh('반죽', V, F, merge=True)
    m = dough_mat('반죽', '#d9c8a4' if rough else '#e8d9b8', 0.45 if rough else 0.0)
    return [add('반죽', me, m, loc=(0, 0, base_z + R[2] * 0.55 - 0.002))]

# ---- 묽은 반죽 — 볼 안을 채운 반들반들한 반죽과, 위에 막 부어 리본처럼 쌓인 줄기
def build_batter(fill=0.058):
    zb = BOWL_FLOOR + 0.0004
    prof = [(0.0, zb)] + [(bowl_inner_r(z) - 0.0006, z) for z in [zb + (fill - zb) * k / 30 for k in range(1, 31)]] + [(0.0, fill)]
    V, F = lathe(prof, 192)
    m = soft_mat('묽은반죽', '#ecd7a8', rough=0.16, sss=0.5, sat=1.1, val=1.05)
    objs = [add('묽은반죽', make_mesh('묽은반죽', V, F, merge=True), m)]
    C = []; Rr = []
    for i in range(301):
        t = i / 300; a = t * 2 * math.pi * 2.6
        rad = 0.012 + 0.055 * t
        C.append(Vector((rad * math.cos(a), rad * math.sin(a), fill + 0.0012 * (1 - t) + 0.0004)))
        Rr.append(0.0055 * (1 - 0.35 * t))
    V, F, _ = tube(C, Rr, 32, section=lambda th: (math.cos(th), math.sin(th) * 0.45))
    objs.append(add('묽은반죽_줄기', make_mesh('묽은반죽_줄기', V, F), m))
    return objs

# ---- 반죽 판 — 둥근 모서리의 밝은 나무 판, 한쪽 끝에 손잡이 (참고 이미지의 카툰 도마)
BOARD_A, BOARD_B, BOARD_T = 0.17, 0.12, 0.022
def board_rings(a, b, rc, t, e=0.005):
    R = [(a - e, b - e, rc - e, t)]
    for k in range(1, 6):
        ph = math.pi / 2 * k / 5
        o = e * (1 - math.cos(ph)); z = t - e * (1 - math.sin(ph))
        R.append((a - e + e * math.sin(ph), b - e + e * math.sin(ph), rc - e + e * math.sin(ph), t - e + e * math.cos(ph)))
    R.append((a, b, rc, e))
    for k in range(1, 6):
        ph = math.pi / 2 * k / 5
        R.append((a - e * (1 - math.cos(ph)), b - e * (1 - math.cos(ph)), rc - e * (1 - math.cos(ph)), e - e * math.sin(ph)))
    return R

def wood_cartoon_mat(name='나무_반죽판', flour=False, k=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    N, L, link, M, noise_tex, mixc, ramp = node_tools(m.node_tree)
    b = N['Principled BSDF']; tc = N.new('ShaderNodeTexCoord').outputs['Object']
    mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1.0, 12.0, 1.0); L.new(tc, mp.inputs['Vector'])
    grain = noise_tex(mp.outputs['Vector'], 5, 3, 0.5, 1.5)
    col = ramp(grain, [(0.35, toon('#d9a46e', 1.05, 1.02)), (0.65, toon('#ebc394', 1.05, 1.04))])
    if flour:   # 가운데 둘레로 흩뿌린 덧가루
        g = N.new('ShaderNodeSeparateXYZ'); L.new(tc, g.inputs[0])
        d = M('SQRT', M('ADD', M('MULTIPLY', g.outputs['X'], g.outputs['X']), M('MULTIPLY', g.outputs['Y'], g.outputs['Y'])))
        ring = N.new('ShaderNodeMapRange'); link(d, ring.inputs['Value'])
        ring.inputs['From Min'].default_value = 0.11 * k; ring.inputs['From Max'].default_value = 0.06 * k
        fm = N.new('ShaderNodeMapRange'); link(noise_tex(tc, 40, 4, 0.6), fm.inputs['Value'])
        fm.inputs['From Min'].default_value = 0.42; fm.inputs['From Max'].default_value = 0.55
        col = mixc(M('MULTIPLY', M('MULTIPLY', ring.outputs['Result'], fm.outputs['Result']), 0.9, clamp=True), col, (0.97, 0.96, 0.93, 1.0))
    link(col, b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.6
    return m

def build_board(flour=False, k=1.0):
    """k = 판 크기 배율 — 모양 빚기 무대는 1.5배 큰 판(손잡이는 그대로)"""
    m = wood_cartoon_mat(flour=flour, k=k)
    V, F = shell(board_rings(BOARD_A * k, BOARD_B * k, 0.028, BOARD_T), n=64, share_caps=True)
    me = make_mesh('반죽판', V, F); sharp_by_angle(me)
    board = add('반죽판', me, m)
    # 손잡이 — 판과 같은 두께의 둥근 혀를 불리언 합집합으로 붙인다(맞닿는 윗면이 겹쳐 깜박이지 않게)
    V, F = shell(board_rings(0.052, 0.034, 0.03, BOARD_T), n=48, share_caps=True)
    hme = make_mesh('손잡이', V, F)
    col = bpy.data.collections.new('반죽판_손잡이'); SC[0].collection.children.link(col)
    h = bpy.data.objects.new('손잡이', hme); h.location = (BOARD_A * k + 0.03, 0, 0); col.objects.link(h); h.hide_render = True
    md = board.modifiers.new('손잡이', 'BOOLEAN'); md.operation = 'UNION'; md.operand_type = 'OBJECT'
    md.object = h; md.solver = 'EXACT'
    return [board, h]

# ================================================================ 토핑 33종 — 게임 content/toppings.ts와 같은 순서·색·밀도·크기
# (id, 이름, 색, 밀도, 크기, (물들이는 색, 양) 또는 None, 알갱이 모양)
TOPPING_DEFS = [
    ('matcha', '녹차', '#5f7d3a', 0.0, 1.0, ('#8fae5c', 0.55), None),
    ('blackTea', '홍차', '#3d2414', 0.22, 0.45, ('#b07a4c', 0.4), 'speck'),
    ('coffee', '커피', '#3a2416', 0.0, 1.0, ('#7a5232', 0.55), None),
    ('cinnamon', '시나몬', '#6e3a1c', 0.25, 0.55, ('#a8683a', 0.3), 'speck'),
    ('ginger', '생강', '#c9a24e', 0.0, 1.0, ('#dcc077', 0.3), None),
    ('mintChoco', '민트초코', '#3a2012', 0.45, 1.0, ('#9adbc1', 0.6), 'chip'),
    ('almond', '아몬드', '#c9a875', 0.45, 1.0, None, 'flake'),
    ('chestnut', '밤', '#b8894a', 0.4, 1.5, None, 'chunk'),
    ('redBean', '팥앙금', '#5a2630', 0.42, 1.6, None, 'paste'),
    ('greenPea', '완두앙금', '#9cbf5a', 0.42, 1.6, None, 'paste'),
    ('choco', '초코칩', '#4a2412', 0.55, 1.0, None, 'chip'),
    ('corn', '옥수수', '#f2c84b', 0.5, 0.8, None, 'kernel'),
    ('carrot', '당근', '#e8792b', 0.42, 0.8, None, 'dice'),
    ('pumpkin', '단호박', '#e9a23b', 0.42, 1.3, None, 'dice'),
    ('potato', '감자', '#e6cf8f', 0.42, 1.4, None, 'dice'),
    ('sweetPotato', '고구마', '#e3a64a', 0.42, 1.4, None, 'dice'),
    ('cheese', '치즈', '#e8b445', 0.6, 1.0, None, 'melt'),
    ('apple', '사과', '#e8c27a', 0.42, 1.3, None, 'dice'),
    ('pear', '배', '#efe2a8', 0.4, 1.3, None, 'dice'),
    ('banana', '바나나', '#f3e08a', 0.45, 1.3, None, 'slice'),
    ('cherry', '체리', '#8e1b2c', 0.38, 1.1, None, 'half'),
    ('strawberry', '딸기', '#d8344a', 0.42, 1.2, None, 'half'),
    ('kiwi', '키위', '#7fae3a', 0.42, 1.2, None, 'dice'),
    ('shineMuscat', '샤인머스캣', '#b7d66a', 0.4, 1.3, None, 'berry'),
    ('melon', '멜론', '#b9dc8a', 0.42, 1.3, None, 'dice'),
    ('mango', '망고', '#f2a93b', 0.42, 1.3, None, 'dice'),
    ('coconut', '코코넛', '#f4efe4', 0.55, 0.7, None, 'shred'),
    ('orange', '오렌지', '#f28c28', 0.38, 1.0, None, 'zest'),
    ('lemon', '레몬', '#f2d83b', 0.32, 0.8, None, 'zest'),
    ('lime', '라임', '#8cc63f', 0.32, 0.8, None, 'zest'),
    ('olive', '올리브', '#4a5a2a', 0.38, 1.1, None, 'ring'),
    ('blueberry', '블루베리', '#4a3a72', 0.4, 1.0, None, 'berry'),
    ('sugar', '슈가파우더', '#fbf3e4', 0.7, 1.0, None, 'powder'),
]

def mix_hex(a, b, t):
    ca, cb = hexrgb(a), hexrgb(b)
    return '#' + ''.join(f'{round(clamp(x + (y - x) * t) * 255):02x}' for x, y in zip(ca, cb))

def tinted(colors, tint):
    """게임의 tintedBread()를 따르되 구운 색에도 더 섞는다 — 게임 비율(노릇 0.55배, 진한 0.3배)로는
    겉면이 대부분 구운 색인 쿠키에서 녹차·커피 빛이 거의 안 보인다"""
    if not tint: return colors
    c, a = tint
    d, g, b = colors
    return (mix_hex(d, c, min(1.0, a * 1.5)), mix_hex(g, c, min(1.0, a * 1.3)), mix_hex(b, c, a * 0.8))

def unit_sphere(nu=22, nv=12):
    V = []
    for i in range(nu):
        ph = 2 * math.pi * i / nu
        for j in range(nv + 1):
            th = math.pi * j / nv
            V.append(Vector((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th))))
    return V, quads(nu, nv + 1, wu=True)

def piece(kind, rnd):
    """토핑 알갱이 하나 — 크기 1 기준, 밑면이 z≈0. (정점, 면, 파묻힐 비율, 기울기 최대)"""
    sd = rnd.uniform(0, 50)
    nz = lambda p, f, a: 1 + a * pn(p.x * f, p.y * f, p.z * f, sd)
    if kind == 'chip':        # 초코칩 — 끝이 살짝 뾰족한 물방울
        prof = [(0.0, 0.0), (0.44, 0.0)] + arc_pts(0.44, 0.05, 0.05, -math.pi / 2, 0.0, 3)[1:]
        prof += [(0.49 * (1 - t) ** 1.35, 0.05 + 0.66 * t) for t in [k / 10 for k in range(1, 11)]]
        V, F = lathe(prof, 20); return V, F, 0.3, 0.25
    if kind in ('slice',):    # 바나나 — 둥근 슬라이스
        e = 0.05
        prof = [(0.0, 0.0), (0.5 - e, 0.0)] + arc_pts(0.5 - e, e, e, -math.pi / 2, math.pi / 2, 6)[1:] + [(0.0, 2 * e + 0.06)]
        V, F = lathe(prof, 28); return V, F, 0.15, 0.35
    if kind == 'ring':        # 올리브 — 가운데가 뚫린 고리 슬라이스
        prof = [(0.33 + 0.13 * math.cos(a), 0.1 + 0.1 * math.sin(a)) for a in [2 * math.pi * k / 16 for k in range(17)]]
        V, F = lathe(prof, 28); return V, F, 0.1, 0.35
    if kind == 'half':        # 체리·딸기 — 반으로 잘라 엎어 놓은 알
        prof = [(0.0, 0.0), (0.45, 0.0)] + [(0.45 * math.cos(a), 0.4 * math.sin(a)) for a in [math.pi / 2 * k / 10 for k in range(1, 11)]]
        V, F = lathe(prof, 24); return V, F, 0.2, 0.3
    V, F = unit_sphere()
    out = []
    for p in V:
        if kind == 'berry':   q = p * 0.36 + Vector((0, 0, 0.36))
        elif kind == 'flake': q = Vector((p.x * 0.6, p.y * 0.36 * (1 - 0.3 * p.x), p.z * 0.06 + 0.06))
        elif kind == 'speck': q = Vector((p.x * 0.3, p.y * 0.2, p.z * 0.04 + 0.04)) * nz(p, 2, 0.3)
        elif kind in ('zest', 'shred'):
            ln = 0.55 if kind == 'zest' else 0.5
            q = Vector((p.x * ln, p.y * 0.08, p.z * 0.05 + 0.06 + 0.5 * (p.x * ln) ** 2))
        elif kind == 'chunk':
            q = Vector((p.x * 0.5, p.y * 0.45, p.z * 0.38)) * nz(p, 1.5, 0.25)
            q.z = max(q.z, -0.12) + 0.12
        elif kind == 'paste':
            q = Vector((p.x * 0.55, p.y * 0.5, p.z * 0.3)) * nz(p, 1.3, 0.15)
            q.z = max(q.z, -0.08) + 0.08
        elif kind == 'kernel':
            n_ = (abs(p.x) ** 3 + abs(p.y) ** 3 + abs(p.z) ** 3) ** (1 / 3)
            q = Vector((p.x / n_ * 0.32, p.y / n_ * 0.26, p.z / n_ * 0.3 + 0.3))
        elif kind == 'dice':
            n_ = (abs(p.x) ** 6 + abs(p.y) ** 6 + abs(p.z) ** 6) ** (1 / 6)
            q = Vector((p.x / n_ * 0.42, p.y / n_ * 0.4, p.z / n_ * 0.36 + 0.36)) * nz(p, 1.2, 0.06)
        elif kind == 'melt':  # 치즈 — 녹아서 납작하게 퍼진 조각
            ang = math.atan2(p.y, p.x)
            k = 0.7 * (1 + 0.28 * pn(math.cos(ang) * 1.4, math.sin(ang) * 1.4, 0, sd))
            q = Vector((p.x * k, p.y * k, p.z * 0.09 + 0.05))
        else: q = p * 0.4
        out.append(q)
    embed = {'berry': 0.45, 'flake': 0.0, 'speck': 0.0, 'zest': 0.0, 'shred': 0.0, 'chunk': 0.35,
             'paste': 0.25, 'kernel': 0.45, 'dice': 0.42, 'melt': 0.35}.get(kind, 0.3)
    tilt = {'chunk': 0.6, 'dice': 0.5, 'kernel': 0.4, 'flake': 0.15, 'speck': 0.1, 'melt': 0.05}.get(kind, 0.3)
    return out, F, embed, tilt

def topping_mat(name, hexc, kind):
    # 빵과 같이 구워져 조금 진해진 색 (게임 toppingColor: 갈변 1에서 약 0.83배)
    r_, g_, b_ = hexrgb(hexc)
    k = 1 - smooth(0.5, 1.6, 1.0) * 0.35
    hexb = '#' + ''.join(f'{round(c * k * 255):02x}' for c in (r_, g_, b_))
    rough = {'berry': 0.3, 'half': 0.3, 'chip': 0.45, 'melt': 0.4, 'shred': 0.7, 'paste': 0.5}.get(kind, 0.55)
    sss = {'berry': 0.3, 'half': 0.3, 'melt': 0.4, 'dice': 0.25, 'slice': 0.3, 'paste': 0.2}.get(kind, 0.0)
    return soft_mat(name, hexb, rough=rough, sss=sss, sat=1.12, val=1.04)

def scatter_toppings(td, bread, R_surface, seed=7):
    tid, name, color, density, size, tint, kind = td
    if not kind or kind == 'powder' or density <= 0: return []
    me = bread.data; mw = bread.matrix_basis
    bvh = BVHTree.FromPolygons([mw @ v.co for v in me.vertices], [tuple(p.vertices) for p in me.polygons])
    rnd = random.Random(seed + len(tid))
    n = max(6, round(70 * density / size ** 1.3))
    s0 = 0.0058 * size
    pts = []
    tries = 0
    while len(pts) < n and tries < n * 60:   # 겹치지 않게 흩뿌린다
        tries += 1
        rr_ = R_surface * math.sqrt(rnd.random()); a = rnd.uniform(0, 2 * math.pi)
        x, y = rr_ * math.cos(a), rr_ * math.sin(a)
        if all((x - px) ** 2 + (y - py) ** 2 > (s0 * 0.85) ** 2 for px, py in pts): pts.append((x, y))
    Vs, Fs = [], []
    for (x, y) in pts:
        hit = bvh.ray_cast(Vector((x, y, 0.3)), Vector((0, 0, -1)))
        if hit[0] is None: continue
        loc, nrm = hit[0], hit[1]
        if nrm.z < 0: nrm = -nrm
        V, F, embed, tilt = piece(kind, rnd)
        hgt = max(v.z for v in V)
        sc = s0 * rnd.uniform(0.8, 1.2)
        rot = nrm.to_track_quat('Z', 'Y').to_matrix().to_4x4() @ Matrix.Rotation(rnd.uniform(0, 6.283), 4, 'Z') \
            @ Matrix.Rotation(rnd.uniform(-tilt, tilt), 4, 'X')
        Mx = Matrix.Translation(loc - nrm * hgt * sc * embed) @ rot @ Matrix.Scale(sc, 4)
        off = len(Vs); Vs += [Mx @ v for v in V]; Fs += [tuple(i + off for i in f) for f in F]
    if not Vs: return []
    tme = make_mesh('토핑_' + tid, Vs, Fs, merge=True)
    return [add('토핑_' + name, tme, topping_mat('토핑_' + tid, color, kind))]

def build_topped_cookie(td):
    tid, name, color, density, size, tint, kind = td
    colors = tinted(('#e3c592', '#c68f4e', '#7a4a20'), tint)
    cookie = build_cookie(colors, dust=0.95 if kind == 'powder' else 0.0)
    return cookie + scatter_toppings(td, cookie[0], 0.041 * 0.8)

STAGE_JOBS = [
    ('stage_bowl', '볼', lambda: (build_bowl(), []), dict(el=42, az=-20, lens=60)),
    ('stage_dough_rough', '볼 속 거친 반죽', lambda: (build_bowl(), build_dough(True, BOWL_FLOOR)), dict(el=48, az=-20, lens=60)),
    ('stage_dough_smooth', '볼 속 매끈한 반죽', lambda: (build_bowl(), build_dough(False, BOWL_FLOOR)), dict(el=48, az=-20, lens=60)),
    ('stage_batter', '볼 속 묽은 반죽', lambda: (build_bowl(), build_batter()), dict(el=52, az=-20, lens=60)),
    ('stage_board', '반죽 판', lambda: (build_board(), []), dict(el=44, az=-22, lens=60)),
    ('stage_dough_board', '판 위 반죽', lambda: (build_board(flour=True), build_dough(False, BOARD_T)), dict(el=40, az=-22, lens=60)),
]
TOPPING_JOBS = [(f'topping_{i + 1:02d}_{td[0]}', td[1] + ' 쿠키', (lambda td=td: (build_sheet_pan()[0], place(build_topped_cookie(td), T_SHEET))),
                 dict(el=50, az=-16, lens=85)) for i, td in enumerate(TOPPING_DEFS)]

# 빵 → (그릇, 카메라 보기)
JOBS = [
    ('shokupan', '식빵', lambda: (build_loaf_tin(), build_shokupan()), dict(el=32, az=-30, lens=60)),
    ('cookie', '쿠키', lambda: (build_sheet_pan()[0], place(build_cookie(), T_SHEET)), dict(el=46, az=-18, lens=85, fstop=4.5)),
    ('croissant', '크루아상', lambda: (build_sheet_pan()[0], place(build_croissant(), T_SHEET)), dict(el=52, az=-14, lens=85, fstop=5)),
    ('pancake', '팬케이크', lambda: (build_skillet(), build_pancake()), dict(el=36, az=-12, lens=60)),
    ('bagel', '베이글', lambda: (build_sheet_pan()[0], place(build_bagel(), T_SHEET)), dict(el=42, az=-16, lens=85, fstop=4.5)),
    ('flatbread', '플랫브레드', lambda: (build_sheet_pan()[0], place(build_flatbread(), T_SHEET)), dict(el=48, az=-14, lens=70)),
    ('baguette', '바게트', lambda: (build_sheet_pan()[0], place(build_baguette(), T_SHEET)), dict(el=38, az=-24, lens=60)),
    ('cupcake', '컵케이크', lambda: (build_muffin_tin(), build_cupcakes()), dict(el=48, az=-18, lens=60)),
    ('pretzel', '프레첼', lambda: (build_sheet_pan()[0], place(build_pretzel(), T_SHEET)), dict(el=50, az=-12, lens=85, fstop=5)),
    ('doughnut', '도넛', lambda: (build_donut_pan(), build_doughnuts()), dict(el=50, az=-18, lens=60)),
    ('waffle', '와플', lambda: (build_waffle_mold(), build_waffles_in_mold()), dict(el=50, az=-18, lens=60)),
    ('pie', '파이', lambda: (build_tart_pan(), build_pie()), dict(el=50, az=-16, lens=60)),
    ('cake', '케이크', lambda: (build_cake_tin(), build_cake()), dict(el=38, az=-20, lens=60)),
]
VESSEL_JOBS = [
    ('vessel_tray', '트레이(시트팬)', lambda: build_sheet_pan()[0]),
    ('vessel_loafTin', '식빵틀', build_loaf_tin),
    ('vessel_muffinTin', '머핀틀', build_muffin_tin),
    ('vessel_doughnutPan', '도넛틀', build_donut_pan),
    ('vessel_waffleMold', '와플 몰드', build_waffle_mold),
    ('vessel_waffleIron', '와플틀(기존)', build_waffle_iron),
    ('vessel_tartPan', '타르트팬', build_tart_pan),
    ('vessel_cakeTin', '케이크틀', build_cake_tin),
    ('vessel_skillet', '무쇠 스킬렛', build_skillet),
]

def place(objs, z):
    for o in objs: o.location.z += z
    return objs

first = bpy.context.scene
def run(key, title, build, view, bread_focus):
    sc = bpy.data.scenes.new(title); SC[0] = sc
    setup_scene(sc)
    res = build()
    if isinstance(res, tuple): vessel, bread = res
    else: vessel, bread = res, []
    focus = bread if (bread_focus and bread) else vessel + bread
    frame_camera(sc, focus, **view)
    sc.render.filepath = os.path.join(OUT, key + '.png')
    if os.environ.get('NORENDER') != '1':   # NORENDER=1: 장면만 만들어 .blend로 저장
        bpy.ops.render.render(write_still=True, scene=sc.name)

GROUP = os.environ.get('GROUP', 'main')
def wanted(key):
    return not ONLY or any(o == key or o in key for o in ONLY)

def main():
    global JOBS, VESSEL_JOBS
    if GROUP == 'assets':
        JOBS = []; VESSEL_JOBS = []
        for key, title, build, view in STAGE_JOBS + TOPPING_JOBS:
            if not wanted(key): continue
            try:
                run(key, title, build, view, bread_focus=key.startswith('topping_')); log('ok', key)
            except Exception: log('FAIL', key, traceback.format_exc())

    for i, (key, title, build, view) in enumerate(JOBS):
        if ONLY and key not in ONLY: continue
        try:
            run(f'{i + 1:02d}_{key}', title, build, view, bread_focus=key not in ('cupcake', 'doughnut', 'pie', 'cake', 'shokupan', 'pancake', 'waffle'))
            log('ok', key)
        except Exception: log('FAIL', key, traceback.format_exc())
    for key, title, build in VESSEL_JOBS:
        if ONLY and key not in ONLY: continue
        try:
            run(key, title, build, dict(el=50, az=-24, lens=60), bread_focus=False); log('ok', key)
        except Exception: log('FAIL', key, traceback.format_exc())

    if SAVE:
        bpy.data.scenes.remove(first)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'oven_mung_assets.blend' if GROUP == 'assets' else 'oven_mung_cartoon.blend'), compress=True)
    log('done')

# render_game.py가 import할 때는 빌더만 쓰고 이 렌더 작업은 돌리지 않는다
if __name__ == '__main__':
    main()
