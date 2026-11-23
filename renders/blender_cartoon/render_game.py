# 오븐 멍 — 카툰 에셋을 게임에 쓰는 형태로 렌더·내보내기한다.
# render_cartoon.py의 빌더·재질·카메라·조명을 그대로 쓴다(같은 스타일). 게임은 모션을 실시간으로 그리므로
# 여기서는 '움직이지 않는 것'만 만든다:
#   stage  — 단계마다의 무대 배경 그림(볼·반죽 판·틀·트레이, 투명 배경 + 그림자) + 같은 카메라·같은 그릇 메시의 GLB.
#            게임은 GLB의 카메라로 three.js 층을 배경 그림 위에 겹치고, 그릇 메시를 그림자만 받는 투명 가림막으로
#            써서 실시간 반죽이 그릇 '안에' 보이게 한다. 그릇 안쪽 모양(벽 반지름 등)은 meta.json에 적는다.
#   tool   — 도구(계량컵·컵·달걀·버터·거품기·밀대·빵칼)·붓는 볼 그림. 무대와 같은 카메라라 같은 크기로 보인다
#   bread  — 그릇에서 빼낸 빵 × 굽기 4단계 (빵 고르기·도감)
#   glb    — 오븐 속 3D (그릇 + 빵 껍질, 정점 속성 _toast·_score). 꺼내기(자르기) 단계도 이 메시를 실시간으로 자른다
# 그릇·트레이·도구는 가로로 반듯하게(카메라 방위 0) — 비스듬히 놓지 않는다(사용자 요청).
#
# 실행: game.ps1 (blender-launcher.exe --background --python render_game.py -- <출력 폴더>)
#   GROUPS=stage,tool,bread,glb  ONLY=stage/knead,models/cookie  SAMPLES=32  NORENDER=1  RESK=0.5
# 출력은 PNG/GLB 원본이고, export_game.py가 WebP로 바꿔 게임의 public/assets로 옮긴다.
import bpy, bmesh, math, os, sys, json, random, traceback
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import render_cartoon as rc
from render_cartoon import (SC, log, add, make_mesh, quads, tube, lathe, arc_pts, grid_solid, rr,
                            setup_scene, frame_camera, smooth, clamp, lerp, pn, hexlin, toon, pmat, soft_mat,
                            dough_mat, node_tools, metal_mat, handle_wood_mat, build_bowl, bowl_inner_r,
                            BOWL_H, BOWL_FLOOR, BOWL_RT, BOWL_T, build_board, BOARD_T, BOARD_A, BOARD_B,
                            build_sheet_pan, T_SHEET, build_loaf_tin, build_cake_tin, build_muffin_tin,
                            build_donut_pan, build_waffle_mold, build_tart_pan, build_skillet, MUFFIN_CUPS,
                            MUFFIN_TOP, DONUT_HOLES, DONUT_TOP, DONUT_RP, DONUT_RO, DONUT_D, WMOLD_CENTERS,
                            WMOLD_HALF, WMOLD_FLOOR, WMOLD_TOP, tart_r, TART_H, SKILLET_FLOOR, JOBS,
                            COOKIE_SPOTS, build_cookie_tray, build_flatbread_tray)

OUT = rc.OUT
SAMPLES = int(os.environ.get('SAMPLES', '32'))
ONLY = [k for k in os.environ.get('ONLY', '').split(',') if k]
NORENDER = os.environ.get('NORENDER') == '1'
RESK = float(os.environ.get('RESK', '1'))   # 시험 렌더용 해상도 배율
GLB_LOD = float(os.environ.get('GLB_LOD', '0.4'))   # GLB 메시 분할 배율
META_PATH = os.path.join(OUT, 'meta.json')
META = json.load(open(META_PATH, encoding='utf-8')) if os.path.exists(META_PATH) else {}

def wanted(key):
    return not ONLY or any(key == o or key.startswith(o) for o in ONLY)

def save_meta():
    json.dump(META, open(META_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

def to3(v):
    """Blender(Z 위) → three.js(Y 위) 좌표. glTF 내보내기와 같은 변환"""
    return [round(v[0], 5), round(v[2], 5), round(-v[1], 5)]

# ---------------------------------------------------------------- 장면 · 카메라 · 화면 좌표
def new_scene(title, catcher=True):
    sc = bpy.data.scenes.new(title); SC[0] = sc
    setup_scene(sc)
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = 'RGBA'
    sc.cycles.max_bounces = 6
    for o in sc.objects:
        if o.name.startswith('배경'):
            if catcher: o.is_shadow_catcher = True
            else: o.hide_render = True
    return sc

def drop_scene(sc):
    for o in list(sc.objects): bpy.data.objects.remove(o, do_unlink=True)
    for c in list(sc.collection.children): bpy.data.collections.remove(c)
    bpy.data.scenes.remove(sc)
    try: bpy.data.orphans_purge(do_recursive=True)
    except Exception: pass

def projector(cam):
    """카메라 → 정규화 화면 좌표 (0~1, 왼쪽 위가 원점). 정사각 렌더 기준"""
    V = cam.matrix_basis.inverted()
    f = cam.data.lens / cam.data.sensor_width
    def proj(P):
        q = V @ Vector(P)
        return [round(0.5 + f * q.x / -q.z, 4), round(0.5 - f * q.y / -q.z, 4)]
    return proj

def hull(pts):
    pts = sorted(set((round(p[0], 4), round(p[1], 4)) for p in pts))
    if len(pts) < 3: return [list(p) for p in pts]
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return [list(p) for p in lo[:-1] + up[:-1]]

def shoot(sc, key, res, samples=None):
    res = int(res * RESK)
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.cycles.samples = samples or SAMPLES
    path = os.path.join(OUT, key + '.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc.render.filepath = path
    if not NORENDER: bpy.ops.render.render(write_still=True, scene=sc.name)
    log('ok', key)

def job(key, fn):
    if not wanted(key): return
    try: fn()
    except Exception: log('FAIL', key, traceback.format_exc())

def clear_context():
    sc = bpy.context.scene
    for o in list(sc.objects): bpy.data.objects.remove(o, do_unlink=True)
    for c in list(sc.collection.children): bpy.data.collections.remove(c)
    try: bpy.data.orphans_purge(do_recursive=True)
    except Exception: pass
    return sc

def export_glb(path, objs, with_camera=None):
    """컨텍스트 장면에서 내보낸다 — 다른 장면을 temp_override로 내보내면 불리언 커터가 있는 그릇
    (머핀·도넛틀)에서 depsgraph가 죽는다(EXCEPTION_ACCESS_VIOLATION)"""
    sc = bpy.context.scene
    keep = set(id(o) for o in objs)
    if with_camera: keep.add(id(with_camera))
    for o in sc.objects: o.select_set(id(o) in keep)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_attributes=True, export_yup=True, export_materials='EXPORT',
                              export_texcoords=False, export_cameras=with_camera is not None, export_lights=False)
    log('ok', os.path.relpath(path, OUT), os.path.getsize(path))

def visible_meshes(objs):
    return [o for o in objs if o.type == 'MESH' and not o.hide_render]

def as_list(res):
    return res if isinstance(res, list) else list(res)

# ================================================================ 1. 무대 — 배경 그림 + 카메라·가림막 GLB
STAGE_RES = 720
VIEW_BOWL = dict(el=48, az=0, lens=60)
VIEW_BOARD = dict(el=56, az=0, lens=60)
VIEW_MOLD = dict(el=50, az=0, lens=60)
PIE_MARGIN = 1.5   # 다른 무대는 1.1 — game의 PIE_KNIFE_SCALE(mold.ts)이 이 비율을 따른다

def walls(fn, z0, z1, n=24):
    """벽 반지름 표 — [[높이(three y), 반지름]] (바닥 → 위)"""
    return [[round(lerp(z0, z1, k / n), 5), round(fn(lerp(z0, z1, k / n)), 5)] for k in range(n + 1)]

def cake_wall(z): return 0.09 - 0.0008
def muffin_wall(z):
    zb, zt, rb, rt = 0.0011, MUFFIN_TOP + 0.0045, 0.0242, 0.0352
    return lerp(rb, rt, clamp((z - zb) / (zt - zb))) * (1 - 0.035) - 0.0006
def skillet_wall(z): return 0.084 + (z - 0.0067) / 0.0293 * 0.017 - 0.0006
def tart_wall(z): return 0.098 + (0.104 - 0.098) * clamp((z - 0.0022) / 0.01) + (0.108 - 0.104) * clamp((z - 0.012) / 0.013)
def tart_crust_wall(z): return tart_wall(z) - 0.0048   # 바닥 크러스트를 깐 뒤의 안쪽 — 필링이 차는 곳
DONUT_RC, DONUT_W = (DONUT_RP + DONUT_RO) / 2, (DONUT_RO - DONUT_RP) / 2
def donut_rout(z):
    k = clamp((DONUT_TOP - z) / DONUT_D); return DONUT_RC + DONUT_W * math.sqrt(max(0.0, 1 - k * k))
def donut_rin(z):
    k = clamp((DONUT_TOP - z) / DONUT_D); return DONUT_RC - DONUT_W * math.sqrt(max(0.0, 1 - k * k))

def muffin_liners():
    """머핀틀에 미리 깔아 둔 분홍 종이컵 (render_cartoon.build_cupcakes와 같은 모양)"""
    zb, zt, rb, rt = 0.0011, MUFFIN_TOP + 0.0045, 0.0242, 0.0352
    prof = [(0.0, zb)] + [(lerp(rb, rt, k / 40), lerp(zb + 0.0015, zt, k / 40)) for k in range(41)]
    prof.insert(1, (rb - 0.001, zb))
    def pleat(th, r, z, idx):
        if idx < 2: return r
        tri = abs(((th * 36 / (2 * math.pi)) % 1) - 0.5) * 2
        return r * (1 - 0.035 * tri)
    V, F = lathe(prof, 360, pleat)
    me = make_mesh('컵받침', V, F, merge=True, smooth_shade=False)
    m = pmat('종이컵', hexlin('#e7a7b3'), rough=0.65, **{'Sheen Weight': 0.4, 'Subsurface Weight': 0.15})
    return [add('컵받침', me, m if i == 0 else None, loc=(x, y, 0)) for i, (x, y) in enumerate(MUFFIN_CUPS)]

def pour_cells(kind, centers, z0, zf, wall, inner=None, half=None):
    """붓는 칸들 — 게임이 반죽 메시를 만들 정보 (three 좌표: center는 [x, z])"""
    out = []
    for (cx, cy) in centers:
        p = to3((cx, cy, 0))
        c = {'kind': kind, 'center': [p[0], p[2]], 'floorY': round(z0, 5), 'fullY': round(zf, 5)}
        if wall: c['wall'] = walls(wall, z0, zf + 0.012)
        if inner: c['inner'] = walls(inner, z0, zf + 0.012)
        if half: c['half'] = round(half, 5)
        out.append(c)
    return out

def m_knead():
    return {'floorY': BOWL_FLOOR, 'rimY': BOWL_H, 'wall': walls(bowl_inner_r, BOWL_FLOOR, BOWL_H - 0.002, 32),
            'above': to3((0, 0, BOWL_H + 0.07))}
# 모양 빚기 판은 1.5배 크다 — 세로로 길게 민 반죽이 넉넉히 올라간다(사용자 요청)
FORM_K = 1.5
def m_form():
    return {'topY': BOARD_T, 'half': [BOARD_A * FORM_K, BOARD_B * FORM_K]}
# 트레이 무대 — 뒤에 트레이, 앞에 반죽 판. 빚은 반죽(토핑까지 올린)을 판에서 트레이로 하나씩 옮긴다
TRAY_Y, BOARD_Y = 0.122, -0.128
def build_tray_board():
    pan = build_sheet_pan()[0][0]; pan.location.y = TRAY_Y
    board = build_board(flour=True)   # [판, 손잡이 불리언 커터] — 커터도 같이 옮긴다
    for o in board: o.location.y += BOARD_Y
    return [pan] + board
# 쿠키 무대 — 뒤에 큰 반죽이 든 볼, 앞에 반죽 판. 볼 속 반죽에서 하나씩 뜯어 판에 줄 맞춰 놓는다
BOWL_Y = 0.138
def build_bowl_board():
    bowl = as_list(build_bowl())
    for o in bowl: o.location.y += BOWL_Y
    board = build_board(flour=True)
    for o in board: o.location.y += BOARD_Y
    return bowl + board
def m_form_cookie():
    return {'floorY': BOWL_FLOOR, 'rimY': BOWL_H, 'wall': walls(bowl_inner_r, BOWL_FLOOR, BOWL_H - 0.002, 32),
            'center': to3((0, BOWL_Y, 0))[0::2], 'boardTop': BOARD_T, 'boardCenter': to3((0, BOARD_Y, 0))[0::2],
            'boardHalf': [BOARD_A, BOARD_B]}
def m_cut():
    return {'topY': BOARD_T, 'half': [BOARD_A, BOARD_B]}

def m_tray():
    return {'topY': T_SHEET, 'half': [0.165, 0.115], 'center': to3((0, TRAY_Y, 0))[0::2],
            'spots': [to3((x, y + TRAY_Y, T_SHEET)) for x, y in COOKIE_SPOTS],
            'boardTop': BOARD_T, 'boardCenter': to3((0, BOARD_Y, 0))[0::2], 'boardHalf': [BOARD_A, BOARD_B]}

# 무대 이름 → (그릇 빌더, 카메라 보기, meta)
STAGES = {
    'knead': (build_bowl, VIEW_BOWL, m_knead),
    'form': (lambda: build_board(flour=True, k=FORM_K), VIEW_BOARD, m_form),
    'form_cookie': (build_bowl_board, VIEW_MOLD, m_form_cookie),
    # 자르기 — 같은 반죽 판, 같은 시점, 깨끗하게(밀가루 없이)
    'cut': (lambda: build_board(flour=False), VIEW_BOARD, m_cut),
    'mold_tray': (build_tray_board, VIEW_MOLD, m_tray),
    'mold_shokupan': (build_loaf_tin, VIEW_MOLD, lambda: {
        'floorY': 0.0008, 'rimY': 0.1, 'inner': [0.1 - 0.006, 0.05 - 0.006]}),
    # 파이 틀은 틀보다 큰 민 반죽을 덮어 깔아야 해서 조금 물러서서 본다(사용자 요청 — 반죽과 틀의 크기가 맞게)
    'mold_pie': (build_tart_pan, dict(VIEW_MOLD, margin=PIE_MARGIN), lambda: {
        'floorY': 0.0022, 'rimY': TART_H, 'wall': walls(tart_wall, 0.0022, TART_H),
        'cells': pour_cells('tart', [(0, 0)], 0.0072, 0.019, tart_crust_wall)}),
    'mold_cake': (build_cake_tin, VIEW_MOLD, lambda: {'cells': pour_cells('round', [(0, 0)], 0.0008, 0.036, cake_wall)}),
    'mold_cupcake': (lambda: build_muffin_tin() + muffin_liners(), VIEW_MOLD,
                     lambda: {'cells': pour_cells('round', MUFFIN_CUPS, 0.0026, 0.024, muffin_wall)}),
    'mold_doughnut': (build_donut_pan, VIEW_MOLD, lambda: {
        'cells': pour_cells('ring', DONUT_HOLES, DONUT_TOP - DONUT_D, 0.0185, donut_rout, inner=donut_rin)}),
    'mold_waffle': (build_waffle_mold, VIEW_MOLD, lambda: {
        'cells': pour_cells('square', WMOLD_CENTERS, WMOLD_FLOOR, 0.016, None, half=WMOLD_HALF - 0.0008)}),
    'mold_pancake': (build_skillet, VIEW_MOLD, lambda: {'cells': pour_cells('round', [(0, 0)], SKILLET_FLOOR, 0.022, skillet_wall)}),
}

def stage_jobs():
    for name, (build, view, meta_fn) in STAGES.items():
        key = f'stage/{name}'
        def f(name=name, build=build, view=view, meta_fn=meta_fn, key=key):
            # 배경 그림
            sc = new_scene(key)
            objs = as_list(build())
            cam = frame_camera(sc, objs, **view)
            META.setdefault('stage', {})[name] = meta_fn()
            save_meta()
            shoot(sc, key, STAGE_RES)
            drop_scene(sc)
            # 같은 카메라·같은 그릇의 GLB — 게임의 실시간 층이 이 카메라로 그리고, 그릇을 가림막으로 쓴다
            ctx = clear_context(); SC[0] = ctx
            ctx.render.resolution_x = ctx.render.resolution_y = STAGE_RES
            # 가림막·그림자 받는 면으로만 쓰니 가볍게 — 와플 몰드 격자는 그대로면 18MB가 넘는다.
            # 카메라는 원래 분할의 그릇으로 맞춰야 배경 그림과 같다(분할이 달라도 크기는 거의 같지만 혹시 몰라)
            objs_full = as_list(build())
            cam = frame_camera(ctx, objs_full, **view)
            for o in objs_full: bpy.data.objects.remove(o, do_unlink=True)
            for c in list(ctx.collection.children): bpy.data.collections.remove(c)
            rc.LOD[0] = GLB_LOD
            objs = as_list(build())
            rc.LOD[0] = 1.0
            export_glb(os.path.join(OUT, key + '.glb'), visible_meshes(objs), with_camera=cam)
            clear_context()
        job(key, f)

# ================================================================ 2. 도구 — 무대와 같은 카메라, 그릇은 숨긴다
def tool_scene(stage, title):
    build, view, _ = STAGES[stage]
    sc = new_scene(title, catcher=False)
    objs = as_list(build())
    cam = frame_camera(sc, objs, **view)
    for o in objs: o.hide_render = True
    return sc, cam

def tool_jobs():
    zc = BOWL_H + 0.07
    def scoop():
        prof = [(0.0, zc - 0.022)] + [(0.026 * math.sin(a), zc - 0.022 * math.cos(a)) for a in [math.pi / 2 * k / 16 for k in range(1, 17)]]
        prof += [(0.0262, zc + 0.0006), (0.0245, zc - 0.0002)] + [(0.0245 * math.sin(a), zc - 0.0205 * math.cos(a)) for a in [math.pi / 2 * (1 - k / 16) for k in range(1, 17)]]
        V, F = lathe(prof, 96)
        st = metal_mat('스테인리스', (0.75, 0.75, 0.74), 0.3)
        add('계량컵', make_mesh('계량컵', V, F, merge=True), st)
        C = [Vector((0.026 + 0.06 * i / 10, 0, zc + 0.003 * i / 10)) for i in range(11)]
        V, F, _ = tube(C, [0.0035] * 11, 16, section=lambda th: (math.cos(th) * 1.6, math.sin(th) * 0.6))
        add('손잡이', make_mesh('손잡이', V, F), st)
        prof = [(0.024 * k / 20, zc + 0.006 * (1 - (k / 20) ** 2)) for k in range(21)] + [(0.0, zc - 0.01)]
        V, F = lathe(prof, 64)
        add('가루', make_mesh('가루', V, F, merge=True), dough_mat('가루', '#ffffff', 0.0))
        return {'center': (0, 0, zc), 'lip': (-0.026, 0, zc)}
    def jug():
        prof = [(0.0, zc - 0.035), (0.026, zc - 0.035)] + arc_pts(0.026, zc - 0.031, 0.004, -math.pi / 2, 0, 4)[1:]
        prof += [(0.029, zc + 0.02), (0.0305, zc + 0.021), (0.0275, zc + 0.019), (0.0245, zc - 0.03), (0.0, zc - 0.03)]
        V, F = lathe(prof, 96)
        add('컵', make_mesh('컵', V, F, merge=True), soft_mat('컵', '#f5f2ec', rough=0.25))
        C = [Vector((0.028 + 0.016 * math.sin(math.pi * i / 20), 0, zc + 0.012 - 0.03 * i / 20)) for i in range(21)]
        V, F, _ = tube(C, [0.0035] * 21, 16)
        add('손잡이', make_mesh('손잡이', V, F), soft_mat('컵', '#f5f2ec', rough=0.25))
        return {'center': (0, 0, zc), 'lip': (-0.029, 0, zc + 0.02)}
    def egg_whole():
        prof = [(0.0, zc - 0.022)] + [(0.017 * math.sin(a) * (1 - 0.12 * math.cos(a)), zc - 0.022 * math.cos(a) * (1.0 if a < math.pi / 2 else 1.25))
                                      for a in [math.pi * k / 24 for k in range(1, 24)]] + [(0.0, zc + 0.027)]
        V, F = lathe(prof, 64)
        add('달걀', make_mesh('달걀', V, F, merge=True), soft_mat('달걀껍데기', '#efd9b8', rough=0.5, sss=0.1))
        return {'center': (0, 0, zc)}
    def butter_src():
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(0.03, 0.022, 0.017), verts=bm.verts)
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.0025, segments=4, affect='EDGES')
        me = bpy.data.meshes.new('버터'); bm.to_mesh(me); bm.free()
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
        add('버터', me, soft_mat('버터', '#f6dc78', rough=0.35, sss=0.2), loc=(0, 0, zc))
        return {'center': (0, 0, zc)}
    for key, build in (('tool/scoop', scoop), ('tool/jug', jug), ('tool/egg', egg_whole), ('tool/butter', butter_src)):
        def f(key=key, build=build):
            sc, cam = tool_scene('knead', key)
            pts = build()
            P = projector(cam)
            META.setdefault('tool', {})[key.split('/')[-1]] = {k: P(v) for k, v in pts.items()}
            save_meta()
            shoot(sc, key, STAGE_RES); drop_scene(sc)
        job(key, f)

    def whisk():
        """거품기 — 끝이 볼 바닥 가운데에 닿게, 손잡이는 오른쪽 위로. 게임은 끝(tip)을 손가락 자리에 맞춘다"""
        sc, cam = tool_scene('knead', '거품기')
        tip = Vector((0, 0, BOWL_FLOOR + 0.004))
        axis = Vector((0.55, 0.0, 1.0)).normalized()
        st = metal_mat('스테인리스', (0.78, 0.78, 0.77), 0.28)
        for k in range(6):
            ang = math.pi * k / 6
            side = Vector((math.cos(ang), math.sin(ang), 0))
            side = (side - axis * side.dot(axis)).normalized()
            C = [tip + axis * (0.075 * (1 - math.cos(math.pi * i / 40))) + side * (0.022 * math.sin(math.pi * i / 40) * (1 - 0.35 * i / 40)) for i in range(41)]
            V, F, _ = tube(C, [0.0011] * 41, 10)
            add('철사', make_mesh('철사', V, F), st)
        C = [tip + axis * (0.15 + 0.11 * i / 20) for i in range(21)]
        V, F, _ = tube(C, [0.007 * (0.75 + 0.25 * math.sin(math.pi * i / 20)) for i in range(21)], 24)
        add('손잡이', make_mesh('손잡이', V, F), handle_wood_mat())
        C = [tip + axis * (0.14 + 0.012 * i / 4) for i in range(5)]
        V, F, _ = tube(C, [0.006] * 5, 24)
        add('목', make_mesh('목', V, F), st)
        META.setdefault('tool', {})['whisk'] = {'tip': projector(cam)(tip)}; save_meta()
        shoot(sc, 'tool/whisk', STAGE_RES); drop_scene(sc)
    job('tool/whisk', whisk)

    def pin():
        """밀대 — 판 위에 가로로 반듯하게 눕힌다"""
        sc, cam = tool_scene('form', '밀대')
        z = BOARD_T + 0.03
        C = [Vector((-0.11 + 0.22 * i / 20, 0, z)) for i in range(21)]
        V, F, _ = tube(C, [0.016] * 21, 48)
        add('밀대', make_mesh('밀대', V, F), soft_mat('밀대', '#d9a46e', rough=0.45))
        for sx in (-1, 1):
            C = [Vector((sx * (0.11 + 0.05 * i / 10), 0, z)) for i in range(11)]
            V, F, _ = tube(C, [0.007 * (0.8 + 0.2 * math.sin(math.pi * i / 10)) for i in range(11)], 24)
            add('손잡이', make_mesh('손잡이', V, F), handle_wood_mat())
        META.setdefault('tool', {})['pin'] = {'center': projector(cam)((0, 0, z))}; save_meta()
        shoot(sc, 'tool/pin', STAGE_RES); drop_scene(sc)
    job('tool/pin', pin)

    def knife():
        """빵칼 — 칼끝이 왼쪽, 손잡이가 오른쪽으로 가로로 반듯하게"""
        sc, cam = tool_scene('form', '빵칼')
        z = BOARD_T + 0.02
        V = [Vector(p) for p in [(0, 0, z), (0.12, -0.004, z), (0.12, 0.014, z), (0.008, 0.006, z),
                                 (0, 0, z + 0.002), (0.12, -0.004, z + 0.002), (0.12, 0.014, z + 0.002), (0.008, 0.006, z + 0.002)]]
        F = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        add('칼날', make_mesh('칼날', V, F, smooth_shade=False), metal_mat('칼날', (0.8, 0.8, 0.8), 0.25))
        C = [Vector((0.12 + 0.07 * i / 10, 0.005, z + 0.001)) for i in range(11)]
        V, F, _ = tube(C, [0.007] * 11, 24, section=lambda th: (math.cos(th), math.sin(th) * 0.6))
        add('손잡이', make_mesh('손잡이', V, F), handle_wood_mat())
        META.setdefault('tool', {})['knife'] = {'tip': projector(cam)((0, 0, z))}; save_meta()
        shoot(sc, 'tool/knife', STAGE_RES); drop_scene(sc)
    job('tool/knife', knife)

    def pour_bowl():
        """틀에 붓는 볼 — 입구를 축으로 기울어 반죽이 흘러나온다. 게임은 입구(lip)를 줄기 시작점으로 쓴다"""
        sc = new_scene('붓는 볼', catcher=False)
        objs = build_bowl()
        prof = [(0.0, BOWL_FLOOR + 0.0004)] + [(bowl_inner_r(z) - 0.0006, z) for z in [lerp(BOWL_FLOOR + 0.0004, 0.05, k / 20) for k in range(1, 21)]] + [(0.0, 0.05)]
        V, F = lathe(prof, 128)
        objs.append(add('묽은반죽', make_mesh('묽은반죽', V, F, merge=True), soft_mat('묽은반죽', '#f6f1e8', rough=0.8)))
        lip = Vector((-BOWL_RT + BOWL_T / 2, 0, BOWL_H))
        Rm = Matrix.Translation(lip) @ Matrix.Rotation(math.radians(-62), 4, 'Y') @ Matrix.Translation(-lip)
        for o in objs: o.matrix_basis = Rm @ o.matrix_basis
        cam = frame_camera(sc, objs, el=20, az=0, lens=60, margin=1.15)
        META.setdefault('tool', {})['pourBowl'] = {'lip': projector(cam)(lip)}; save_meta()
        shoot(sc, 'tool/pour_bowl', 480); drop_scene(sc)
    job('tool/pour_bowl', pour_bowl)

# ================================================================ 3. 빵 (빵 고르기·도감) — 그릇에서 빼낸 빵만
BROWN_LEVELS = [0.0, 0.55, 1.0, 1.4]
BREAD_RES = 480

def bread_only(bid, build):
    """JOBS의 빌더에서 빵만 — 여러 개 구운 빵(컵케이크·도넛·와플)은 하나만 남겨 가운데로"""
    res = build()
    vessel, bread = res if isinstance(res, tuple) else (res, [])
    for o in vessel: bpy.data.objects.remove(o, do_unlink=True)
    for c in list(SC[0].collection.children): bpy.data.collections.remove(c)
    if bid == 'cupcake': keep = bread[:2]
    elif bid in ('doughnut', 'waffle'): keep = bread[:1]
    else: keep = bread
    for o in bread:
        if o not in keep: bpy.data.objects.remove(o, do_unlink=True)
    if bid in ('cupcake', 'doughnut', 'waffle'):
        for o in keep: o.location.x = 0; o.location.y = 0
    if bid == 'waffle':
        for o in keep: o.location.z = 0
    return keep

def top_hull(objs, proj, nz=0.55, shift=(0, 0, 0), side=0, cx=0.0):
    """위를 향한 면의 정점을 화면에 투영한 볼록 껍질 — 게임이 토핑을 흩뿌릴 영역"""
    pts = []
    for o in objs:
        if o.type != 'MESH' or o.hide_render: continue
        me = o.data; M = o.matrix_basis; R3 = M.to_3x3()
        step = max(1, len(me.vertices) // 3000)
        for i in range(0, len(me.vertices), step):
            v = me.vertices[i]
            P = M @ v.co
            if side and (P.x - cx) * side < 0: continue
            if (R3 @ v.normal).normalized().z > nz: pts.append(proj(P + Vector(shift)))
    return hull(pts)

def bread_jobs():
    for i, (bid, title, build, view) in enumerate(JOBS):
        for k, b in enumerate(BROWN_LEVELS):
            key = f'bread/{bid}_{k}'
            def f(bid=bid, build=build, view=view, b=b, k=k, key=key):
                rc.BROWN[0] = b
                sc = new_scene(key, catcher=False)
                objs = bread_only(bid, build)
                cam = frame_camera(sc, objs, el=view.get('el', 40), az=view.get('az', -20), lens=view.get('lens', 60), margin=1.12)
                if k == 2:
                    crust = [o for o in objs if o.type == 'MESH' and o.data.attributes.get('toast')]
                    META.setdefault('bread', {})[bid] = {'top': top_hull(crust, projector(cam))}
                    save_meta()
                shoot(sc, key, BREAD_RES)
                rc.BROWN[0] = 1.0
                drop_scene(sc)
            job(key, f)
        # 토핑 없는 파이는 필링 없이 속이 빈 채로 굽는다(사용자 요청) — 도감 그림도 따로
        if bid == 'pie':
            for k, b in enumerate(BROWN_LEVELS):
                key = f'bread/pie_empty_{k}'
                def f(build=build, view=view, b=b, key=key):
                    rc.BROWN[0] = b
                    rc.PIE_EMPTY[0] = True
                    sc = new_scene(key, catcher=False)
                    objs = bread_only('pie', build)
                    frame_camera(sc, objs, el=view.get('el', 40), az=view.get('az', -20), lens=view.get('lens', 60), margin=1.12)
                    shoot(sc, key, BREAD_RES)
                    rc.PIE_EMPTY[0] = False
                    rc.BROWN[0] = 1.0
                    drop_scene(sc)
                job(key, f)

# ================================================================ 5. 오븐 3D — 그릇과 빵 메시를 GLB로
TRAY_BREADS = ('croissant', 'bagel', 'baguette', 'pretzel')
# 트레이에 혼자 놓이는 빵은 트레이가 비어 보이지 않게 키운다 — 모양 빚기의 반죽(formShapes.ts) 크기와 짝이다
# 크루아상은 모양 빚기의 초승달(formShapes.ts croCrescent = 이 크기의 0.92배)보다 오븐에서 부푼 만큼 크다
TRAY_SCALE = {'croissant': 1.45, 'bagel': 1.45, 'pretzel': 1.4}
TRAY_IN = (0.165 - 0.02, 0.115 - 0.02)   # 시트팬 안쪽 반폭(테두리 안)

def world_bbox(objs):
    pts = []
    for o in objs:
        if o.type != 'MESH': continue
        M = o.matrix_basis; vs = o.data.vertices
        step = max(1, len(vs) // 3000)
        pts += [M @ vs[i].co for i in range(0, len(vs), step)]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi

def fit_on_tray(bread, scale=1.0):
    """트레이 빵은 트레이 위에 가로로 반듯하게, 다 부푼 모양(오븐의 끝 모습)이 트레이 안에 들어오게 줄인다.
    게임 오븐은 이 모양에서 시작 크기로 줄였다가 부풀린다 — 이게 트레이 밖으로 나가면 오븐 속 빵도 넘친다"""
    for o in bread: o.rotation_euler.z = 0.0
    lo, hi = world_bbox(bread)
    cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
    k = min(scale, TRAY_IN[0] / max((hi.x - lo.x) / 2, 1e-6), TRAY_IN[1] / max((hi.y - lo.y) / 2, 1e-6))
    for o in bread:
        o.location = Vector((cx + (o.location.x - cx) * k - cx, cy + (o.location.y - cy) * k - cy, lo.z + (o.location.z - lo.z) * k))
        o.scale = o.scale * k
    log('fit', [o.name for o in bread][:2], round(k, 3))

def glb_jobs():
    for i, (bid, title, build, view) in enumerate(JOBS):
        key = f'models/{bid}'
        if bid == 'cookie': build = build_cookie_tray   # 큰 반죽에서 떼어 낸 쿠키 여럿이 한 트레이에
        if bid == 'flatbread': build = build_flatbread_tray   # 넷으로 나눠 빚은 플랫브레드
        def f(bid=bid, build=build, key=key, smooth=bid == 'waffle'):
            sc = clear_context(); SC[0] = sc
            rc.LOD[0] = GLB_LOD
            rc.WAFFLE_SMOOTH[0] = smooth
            res = build()
            rc.WAFFLE_SMOOTH[0] = False
            rc.LOD[0] = 1.0
            vessel, bread = res if isinstance(res, tuple) else (res, [])
            if bid in TRAY_BREADS: fit_on_tray(bread, TRAY_SCALE.get(bid, 1.0))
            objs = [o for o in sc.objects if o.type == 'MESH' and not o.hide_render]
            names = set(id(o) for o in bread)
            for o in objs:
                me = o.data
                for a in ('toast', 'score'):
                    if me.attributes.get(a) and not me.attributes.get('_' + a):
                        me.attributes[a].name = '_' + a
                # 빵 껍질(정점 속성 _toast) = 게임 셰이더로 굽는 메시, 나머지는 그대로 재질을 쓴다
                if me.attributes.get('_toast'): o.name = 'bread_' + o.name
                elif id(o) in names: o.name = 'extra_' + o.name
                else: o.name = 'vessel_' + o.name
            export_glb(os.path.join(OUT, key + '.glb'), objs)
            clear_context()
        job(key, f)
        # 다 구운 와플은 격자가 있는 면을 보여 준다(꺼내기) — 오븐 속 메시는 윗면이 매끈하다
        if bid == 'waffle':
            job('models/waffle_grid', lambda f=f, build=build: f('waffle', build, 'models/waffle_grid', False))

# ================================================================ 실행
GROUPS = os.environ.get('GROUPS', 'stage,tool,bread,glb').split(',')
if 'stage' in GROUPS: stage_jobs()
if 'tool' in GROUPS: tool_jobs()
if 'bread' in GROUPS: bread_jobs()
if 'glb' in GROUPS: glb_jobs()
save_meta()
log('done')
