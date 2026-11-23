# 오븐 멍 — Blender 렌더 작업 노트

게임 에셋(빵 13종 · 굽는 그릇 · 반죽/토핑 단계 소품 · 토핑 33종)을 Blender로 렌더한 작업의 기록.
다음 작업에서 **같은 스타일·같은 규칙을 이어 가기 위한 문서**다. 결정의 이유와 이미 겪은 함정을 함께 적는다.

> 기준은 **카툰 버전**(`blender_cartoon/`) 하나다. 이전 단계(`blender/` 게임 메시 이식, `blender_real/` 실사)는
> 2026-10-14에 정리했다(휴지통). 게임 화면의 그림과 오븐 3D는 모두 이 카툰 에셋에서 나온다 — 7절 참고.

---

## 1. 폴더 구조

| 경로 | 내용 | 상태 |
|---|---|---|
| `blender_cartoon/` | **카툰 스타일 (기준)** (`render_cartoon.py`, `run.ps1`) | **현행** |
| `blender_cartoon/render_game.py`, `game.ps1` | **게임용 출력** — 투명 배경 그림·프레임·좌표(meta.json)·GLB (7절) | 현행 |
| `blender_cartoon/game/` | 게임용 출력 원본 (PNG·GLB·meta.json) | 생성물 |
| `blender_cartoon/export_game.py` | `game/` → 게임 `public/assets`(WebP·GLB) + `src/assets/sprites.json` (시스템 Python·Pillow) | 도구 |
| `blender_cartoon/final/` | 빵 13종 + 그릇 9종 PNG, `breads_sheet.png`, `vessels_sheet.png`, `oven_mung_cartoon.blend` | 현행 |
| `blender_cartoon/assets/` | 반죽·토핑 단계 소품 6장 + 토핑 33종 쿠키, `stage_sheet.png`, `toppings_sheet.png`, `oven_mung_assets.blend` | 현행 |
| `blender_cartoon/test/` | 시험 렌더 출력(저해상도). 지워도 됨 | 임시 |
| `sheet.py` | PNG들을 한글 이름표와 함께 격자 시트로 묶는 PIL 스크립트 | 도구 |

---

## 2. 실행 환경 (중요)

- **Blender 5.2.2 LTS** (Microsoft Store 설치판). `blender.exe`를 직접 실행하면 *Access denied* —
  반드시 실행 별칭 **`%LOCALAPPDATA%\Microsoft\WindowsApps\blender-launcher.exe`** 로 실행한다.
- 백그라운드 실행 시 **stdout이 잘 안 잡힌다** → 스크립트가 출력 폴더의 `_log.txt`에 진행을 기록한다(`ok <key>` / `FAIL` / `done`).
- Blender MCP 애드온 서버(localhost:9876)는 꺼져 있었고, `*_for_cli` 도구는 `BLENDER_PATH`가 없어 실패 → **MCP 대신 launcher를 직접 호출**했다.
- **GPU 없음 → CPU Cycles.** 1080px·96샘플 기준 한 장 약 2~3.5분. 22장 전체 ≈ 70분, 토핑 33장 ≈ 1시간 반.
- 백그라운드 Python에는 `bpy.context.window`가 없다 → 씬 전환 대신 전역 `SC[0]`에 현재 씬을 두고 `sc.collection`에 링크,
  렌더는 `bpy.ops.render.render(write_still=True, scene=sc.name)`.
- 시트 만들기는 시스템 Python(Pillow 11)으로 `python renders/sheet.py <dir> <out.png> <cols> <cell> file:라벨 ...`.

### 실행 방법 (`blender_cartoon/run.ps1`)

```powershell
# 시험 렌더 (기본 640px·32샘플 → test/)
& renders\blender_cartoon\run.ps1 -only 'shokupan,pancake'
# 본 렌더
& renders\blender_cartoon\run.ps1 -only 'shokupan' -samples 96 -res 1080 -out final
# .blend만 다시 저장 (렌더 없이 22개 장면 생성, 1~2분)
$env:NORENDER='1'; & renders\blender_cartoon\run.ps1 -only '' -out final; $env:NORENDER=''
# 반죽·토핑 단계 에셋 묶음
$env:GROUP='assets'; & renders\blender_cartoon\run.ps1 -samples 64 -res 1080 -out assets; $env:GROUP=''
```

환경 변수: `ONLY`(쉼표 목록, assets 묶음은 부분 문자열 일치) · `SAMPLES` · `RES` · `SAVE`(기본 1, `ONLY`가 있으면 저장 안 함) ·
`NORENDER=1` · `GROUP=assets`.
**`ONLY`로 일부만 렌더하면 .blend가 저장되지 않으니**, 끝나고 `NORENDER=1`로 .blend를 따로 다시 저장한다.

---

## 3. 카툰 스타일 규칙 (사용자가 정한 방향)

참고: 민트 배경 위 도마에 빵이 놓인 3D 카툰 일러스트(사용자 제공 이미지).

- **배경**: 민트 `#b4cdbf` 이음매 없는 사이클로라마 + 월드도 민트. 테이블·벽 없음.
- **조명**: 왼쪽 뒤 위 큰 키 라이트(따뜻한 흰색) + 오른쪽 앞 약한 채움. 그림자는 부드럽게.
- **색관리**: `Standard`(AgX를 쓰면 주황이 분홍빛으로 틀어졌다). 피사계 심도 **끔**. 카메라는 위에서 내려다보는 구도(el 40~50°).
- **빵 재질 (`crust_mat`)**: 정점 속성 `toast`(0~1.6, 게임 `browning`과 같은 범위)를 색 곡선 반죽→황금→갈색→진갈색으로.
  - **광택 없음**: 클리어코트 쓰지 않음, roughness ≥ 0.7 (사용자 요청 "광택 줄이기").
  - **크랙 없음** (사용자 요청). 잔 얼룩·기공 bump도 지웠다. 서브서피스 0.45로 말랑하게 빛나는 느낌.
  - `toon()`이 채도·명도를 올리고 갈색 계열을 주황 쪽으로 민다(진한 갈색이 빨갛게 뜨지 않게 `brown` 채도 1.2·hue +0.016).
- **금속·그릇**: 얼룩·긁힘 없는 단색, 무광에 가깝게. 논스틱/무쇠는 짙은 회색, 알루미늄은 밝은 회색.

---

## 4. 에셋별 확정 사항 (사용자 피드백으로 정해진 것)

### 빵 13종 (`final/01_*.png` ~ `13_*.png`)
| 빵 | 그릇 | 확정된 모양 |
|---|---|---|
| 식빵 | 식빵틀(논스틱) | **크라운 없는 한 덩이 둥근 지붕**. 2026-10-21 수정: **가장자리가 모두 둥글다** — 위에서 보면 모서리 반지름 2.2cm의 둥근 사각형, 옆면이 위로 올라가며 반지름 1.6cm 사분원 어깨로 지붕에 이어진다(옆면·윗면 사이에 턱·각 없음). 지붕은 길이·폭 방향 매끈한 함수의 곱(거리장 능선 없음). 틀 벽보다 2cm 아래에서 어깨가 시작하고 꼭대기 ≈ 틀+3cm |
| 쿠키 | 시트팬 | 납작한 원판, 가장자리부터 노릇 |
| 크루아상 | 시트팬 | 크게 휜 초승달(끝이 안쪽으로 말림), 대각선 반죽 결 7개 + 결 사이 옅은 골 |
| 팬케이크 | **무쇠 스킬렛** | 스킬렛을 가득 채우고 테두리 위로 넘친 높은 돔 + **십자 칼집**(얕고 완만한 그릇 단면, 둥근 가장자리, 속은 노란 속살) |
| 베이글 | 시트팬 | 통통한 고리 |
| 플랫브레드 | 시트팬 | **원형**(타원 아님) 피타. 반점은 **솟아오른 기포**(밑단이 바닥과 매끈하게 이어짐, 기포끼리는 높이를 더해 이음선 없음), 반점은 조금 진한 갈색 |
| 바게트 | 시트팬 | 칼집 5개(크랙이 아니라 의도된 칼집이라 유지) |
| 컵케이크 | 6구 머핀틀 | 분홍 주름 종이컵이 틀 위로 보이게 |
| 프레첼 | 시트팬 | 통통한 팔, 가운데에서 **두 팔이 한 바퀴 서로 감긴 나선 꼬임**, 끝은 아래 배 위에 얹힘, 황금빛 |
| 도넛 | 6구 도넛틀 | 칸마다 하나 |
| 와플 | **4칸 와플 몰드**(실리콘, 색은 기존 와플틀의 검정) | 칸마다 하나 |
| 파이 | **주름 타르트팬**(검은 논스틱) | **바닥 크러스트(판) + 사과 필링 + 엮은 격자 크러스트**(2026-10-21) — 바닥 판이 팬 주름을 따라 깔리고, 격자 + 팬 주름을 따라 물결치는 테두리 |
| 케이크 | 케이크틀 | 봉긋한 윗면 |

### 그릇 (`final/vessel_*.png`)
시트팬(트레이) · 식빵틀 · 머핀틀 · 도넛틀 · **와플 몰드(새)** · **와플틀(기존 무쇠, 에셋 유지 요청)** · **타르트팬(새)** ·
케이크틀 · **무쇠 스킬렛(새 — 일체형 손잡이가 끝으로 가늘어지고 끝쪽에 길쭉한 구멍)**.
`build_pie_dish`(도자기 파이접시)·`build_frying_pan`은 코드에 남아 있지만 현행 렌더에서는 쓰지 않는다.

### 반죽·토핑 단계 소품 (`assets/stage_*.png`)
볼(게임 반죽 화면의 갈색 볼) · 볼 속 거친 반죽(`#d9c8a4`, 밀가루 얼룩) · 볼 속 매끈한 반죽(`#e8d9b8`) · 볼 속 묽은 반죽(위에 부은 리본) ·
반죽 판(손잡이 달린 밝은 나무, 게임 코드에는 아직 없음) · 판 위 반죽(덧가루).

### 토핑 33종 (`assets/topping_NN_<id>.png`)
- 기준 빵은 **쿠키**(윗면이 넓어 토핑이 잘 보임). 다른 빵으로 바꾸려면 `build_topped_cookie`만 바꾸면 된다.
- 순서·색·밀도·크기는 게임 `src/content/toppings.ts`와 같다 (`TOPPING_DEFS`). **게임에서 토핑을 추가·변경하면 이 표도 같이 고칠 것.**
- 알갱이 수 `≈ 70 × density / size^1.3`, 색은 게임 `toppingColor`처럼 갈변 1에서 약 0.83배로 진하게.
- 모양: chip(초코) · flake(아몬드) · chunk(밤) · paste(앙금) · kernel(옥수수) · dice(채소·과일) · melt(치즈) · slice(바나나) ·
  half(체리·딸기) · berry(블루베리·샤인머스캣) · shred(코코넛) · zest(오렌지·레몬·라임) · speck(홍차·시나몬) · ring(올리브) · powder(슈가파우더=재질의 dust).
- 가루 재료(녹차·커피·생강·민트초코·홍차·시나몬)는 반죽을 물들인다. **렌더에서는 게임 `tintedBread()`보다 강하게 섞는다**
  (반죽 1.5×, 노릇 1.3×, 진한 0.8× — 게임 비율로는 구운 겉면에 녹차 빛이 안 보였다). 게임 화면은 이보다 옅다.

---

## 5. 기법 메모 — 이미 겪은 함정

- **높이는 격자 매개변수(u,v)가 아니라 실제 위치(x,y)로 계산할 것.** `grid_solid`의 둥근 사각형 매핑(`rr`)은 가운데→모서리 대각선을 따라
  꺾이므로, u,v로 높이를 정하면 그 대각선에 **선(이음선)이 생긴다**. 식빵에서 여러 번 겪었다.
- **여러 봉우리 합치기**: `max`·p-노름·√ 반구를 직접 합치면 가장자리 곡률이 끊겨 선이 보인다. 매끈한 포물면들을 **log-sum-exp(부드러운 최댓값)**로 먼저 합친 뒤
  `sqrt(softplus(...))`로 둥글게 만들면 이음선이 없다. 둥근 사각 SDF의 `max(qx,qy)`도 대각선에서 꺾이니 부드러운 최댓값으로.
- **끝을 둥글게 내릴 때**는 평평한 면과 만나는 곳에서 기울기·곡률이 0이 되는 함수(`ex^2.4` 같은 거듭제곱)를 쓰면 능선이 안 생긴다.
  폭 방향 × 길이 방향 계수를 **곱하면** 모서리가 상자처럼 접힌다 → 하나의 슈퍼타원 `S = ex^p + |v|^q`로 묶는다.
- 기포·혹 같은 돌출은 `(1-(d/r)^2)^0.7`처럼 지수 < 1이면 밑단이 꺾인다 → 지수 ≥ 2, 겹치면 `max` 대신 합.
- `lathe`는 축 위 점이 겹치므로 `make_mesh(..., merge=True)`. 원형 `shell`은 `rr` 대신 `(a·u, b·v)` 그대로(사각 매핑을 거치면 네 잎 모양으로 찌그러진다).
- 평평한 ngon 캡과 벽이 꼭짓점을 공유하면 스무스 셰이딩이 얼룩진다 → 캡 꼭짓점을 따로 두거나 `sharp_by_angle`.
- 구멍 뚫린 판(머핀·도넛틀)·손잡이 합치기는 불리언 모디파이어(EXACT). 커터는 `hide_render`만 켠다(`hide_viewport`를 켜면 평가가 안 될 수 있음).
- 카메라 프레이밍은 `matrix_world`/`bound_box`가 depsgraph 갱신 전이라 틀린다 → 정점 × `matrix_basis`로 직접 계산(`frame_camera`).
- 빵 셰이딩 색은 정점 속성 `toast`라 메시가 촘촘해야 한다(성긴 메시는 경계가 계단처럼 보임).

---

## 6. 작업 방식 (사용자와 합의된 흐름)

1. 요청을 받으면 **참고 이미지**(사용자 첨부 또는 Bing 이미지 검색)를 보고 특징을 정리한다.
2. 저해상도 시험 렌더(`-res 600~720 -samples 32`)로 확인 → 시트로 묶어 검토 → 고친 뒤 본 렌더.
3. 본 렌더는 백그라운드로 돌리고 `_log.txt`를 지켜본다. 바뀐 장면만 다시 렌더하고 `.blend`는 `NORENDER=1`로 다시 저장.
4. 결과는 바뀐 장면 시트 + 전체 시트로 보여주고, 게임과 다른 점(의도적 이탈)은 꼭 알린다.
5. 답변·주석·UI 문자열은 한국어.

---

## 7. 게임 적용 — `render_game.py` (2026-10-14~, 10-21 개편)

카툰 빌더·재질·카메라·조명을 그대로 가져다(`import render_cartoon` — 그래서 `render_cartoon.py`의 렌더 작업은
`main()` 안에 있고 import할 때는 돌지 않는다) 게임이 쓰는 형태로 다시 렌더한다.

**모션은 게임이 실시간으로 만든다**(사용자 요청: 프레임을 바꿔 끼우면 "프레임 캡처"처럼 보인다). 그래서 여기서는
움직이지 않는 것만 만든다:

- **stage** — 단계마다의 무대(반죽 볼·반죽 판·틀·트레이): 투명 배경 그림(배경판 = shadow catcher) +
  **같은 카메라·같은 그릇 메시의 GLB**(`export_cameras=True`). 게임은 GLB 카메라로 three.js 층을 그림 위에 겹치고
  그릇을 깊이만 쓰는 가림막 + 그림자 받는 면으로 쓴다 → 실시간 반죽이 그림 속 그릇 안에 보인다.
  그릇 안쪽 모양(벽 반지름 표·칸 위치·높이)은 meta.json `stage.<이름>`에 three 좌표(`to3`: x, z, -y)로.
  가림막 GLB는 `GLB_LOD`(0.4)로 가볍게 — 와플 몰드 격자는 그대로면 18MB가 넘는다.
- **tool** — 도구 그림(계량컵·컵·달걀·버터·거품기·밀대·빵칼·붓는 볼), 무대와 같은 카메라. 기준점은 `tool.<이름>`.
- **bread** — 그릇에서 빼낸 빵 × 굽기 4단계(`render_cartoon.BROWN[0]` — 빵 재질이 `toast`에 곱함).
- ~~cut~~ — 2026-10-28 없앴다. 꺼내기(자르기)는 게임이 오븐 GLB 빵을 실시간으로 잘라 3D로 보여준다(`src/render/cutScene.ts`)
  — 사용자 요청: 자르기 전엔 통째, 빵은 그림이 아니라 3D.
- **glb** — 오븐 속 그릇 + 빵 껍질(`_toast`, 바게트는 `_score` — 칼집이 벌어진 변위, 게임이 처음엔 닫았다가 굽는 동안
  연다). 빵 메시는 **다 구운 끝 모양이고 그릇·트레이 안에 꼭 들어가야 한다**(게임 오븐이 이 모양에서 시작 크기로 줄였다가
  부풀린다). 트레이 빵은 `fit_on_tray`가 가로로 반듯하게(회전 0) 놓고 트레이 안쪽에 맞게 줄인다(바게트 0.805배).
  쿠키는 `build_cookie_tray`(6개). 바게트 칼집은 셋(길이의 -0.22·0·+0.22, 14°) — 게임 `formShapes.ts`의
  `BAGUETTE_SCORES`와 같다.
- **mold_tray 무대** — 뒤에 시트팬, 앞에 반죽 판(`build_tray_board`). 트레이 빵은 판 위에서 토핑을 올리고 하나씩 트레이로
  옮긴다. meta: `center`(트레이 가운데), `spots`(쿠키 자리, 트레이 가운데 기준으로 옮김), `boardTop`·`boardCenter`·`boardHalf`.
- **form_cookie 무대** — 뒤에 볼, 앞에 반죽 판(`build_bowl_board`, 판 자리는 mold_tray와 같다). **cut 무대** — 밀가루 없는 판, form과 같은 시점.
- 오븐 GLB는 게임이 live 반죽 겉면에서 모핑한다(`breadModel.ts`의 `mapToDough`) — **빵 모양·크기를 바꾸면 `formShapes.ts`의 끝 모양과 어긋나지
  않는지** 볼 것. `TRAY_SCALE`(크루아상 1.45·베이글 1.45·플랫브레드 1.2·프레첼 1.4)이 live 크기와 짝이다. 와플은 GLB만 윗면 매끈(`WAFFLE_SMOOTH`).
- **그릇·트레이·도구는 가로로 반듯하게**(카메라 방위 0) — 사용자 요청.
- **손은 그리지 않는다** (사용자 요청) — 도구만.
- **GLB 내보내기는 컨텍스트 장면에서** — 다른 장면을 `temp_override`로 내보내면 불리언 커터가 있는 그릇(머핀·도넛틀)
  에서 depsgraph가 죽는다(EXCEPTION_ACCESS_VIOLATION, BKE_base_eval_flags).
- 2026-10-21 형태 변경: 식빵은 가장자리가 모두 둥글게(옆면이 사분원 어깨로 지붕에 이어짐, 위에서 보면 둥근 모서리 사각형),
  파이는 바닥 크러스트(판) + 필링 + 격자.
- 시간: CPU 32샘플 기준 전체(무대 10 + 도구 8 + 빵 52 + GLB 13) 약 25분.

```powershell
& renders\blender_cartoon\game.ps1                                      # 전부 → game/
& renders\blender_cartoon\game.ps1 -groups 'glb' -only 'models/pie'      # 일부만 (ONLY는 접두어 일치)
$env:NORENDER='1'; & renders\blender_cartoon\game.ps1 -groups 'stage'; $env:NORENDER=''   # 무대 GLB·meta만 다시
$env:RESK='0.4'; & renders\blender_cartoon\game.ps1 -out game_test -samples 10   # 시험 (해상도 배율)
python renders\blender_cartoon\export_game.py                           # → public/assets, src/assets/sprites.json
```
