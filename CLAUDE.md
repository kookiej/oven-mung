# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

「오븐 멍」 — 빵을 굽고 그 모습을 바라보는 웹 기반 모바일 게임. Vite + TypeScript + Three.js로 만들고 Capacitor로 감싸 스토어에 배포하는 구조. 프레임워크 없이 vanilla DOM만 사용한다.

코드 주석·UI 문자열·커밋 메시지는 모두 한국어로 작성한다.

## 명령어

```bash
npm run dev      # vite dev 서버 (0.0.0.0:5173, LAN 노출 — 폰 브라우저로 실기 확인)
npm run build    # tsc(타입 체크, noEmit) → vite build → dist/
npm run preview  # 빌드 결과 미리보기
npm run sync     # cap sync — dist/를 네이티브 프로젝트에 복사
```

테스트·린터·포매터 설정은 없다. 검증 수단은 `npm run build`의 타입 체크와 실기 확인뿐이다.

**`?fast=1` 쿼리로 굽기 시간이 1/20이 된다** (설정의 속도 배율이 먼저 곱해지고 그 뒤에 1/20 — 보통 속도 기준 식빵 6분 → 18초). 굽기 단계를 건드렸다면 `http://localhost:5173/?fast=1`로 한 사이클을 끝까지 돌려볼 것.

**개발자 모드**(설정 시트 맨 아래 토글)로 모든 기능을 바로 불러 확인할 수 있다 — 아래 "개발자 모드" 절 참고.

Capacitor 네이티브 플랫폼(`android/`, `ios/`)은 아직 추가되지 않았고 gitignore되어 있다. 필요 시 `npx cap add android|ios`.

## 아키텍처

### 스테이지 머신 ([src/main.ts](src/main.ts))

화면 전환은 라우터가 아니라 마운트 함수 테이블이다. 각 스테이지는
`(root, ctx, data?) => cleanup` 시그니처를 갖고, `ctx.go(name, data)`가 이전
cleanup 호출 → `root.innerHTML = ''` → 새 마운트를 수행한다.

- **cleanup 반환은 필수다.** rAF 루프, `window` 리스너, Three.js 리소스, 오디오 상태를 여기서 반드시 되돌린다 (`baking.ts`의 return 블록이 표준 예시).
- 스테이지 간 데이터는 `ctx.go`의 `data` 인자로만 넘어가고 `unknown`이다 — 받는 쪽에서 좁혀서 쓴다.
- 흐름: title → choose(빵 고르기) → **pick(토핑 고르기)** → kneading(그 빵의 재료 + 가루 토핑으로 반죽) → **forming(모양 빚기, 덩어리 반죽 빵만)** →
  **mold(틀에 붓기·담기)** → shaping(토핑 올리기 — 고르는 곳이 아니라 올리는 곳) → baking(굽기, 핵심) → finish(슈가파우더·자르기) → album(도감).
  **말거나 접거나 감싸 빚는 빵(식빵·크루아상·베이글·바게트·프레첼·플랫브레드)은 밀어 편 반죽에 토핑을 올리고 말거나 접거나 감싼다** — forming 안의 `toppings` 단계(`rollsIn`), shaping을 거치지 않는다.
  **쿠키는 토핑을 트레이에 옮기기 전에** — forming → shaping(반죽 판 위에서 토핑) → mold(토핑 올린 반죽을 하나씩 트레이로) →
  baking. 올릴 토핑이 없으면 shaping을 건너뛴다(`needsPutting`). **파이는 두 번 돈다** — forming(크게 밀기) → mold(깔기·테두리 자르기) →
  shaping(빈 크러스트에 필링 올리기) → forming `phase: 'lattice'`(잘라 낸 반죽을 밀어 띠로) → mold `phase: 'lattice'`(격자) → baking.
  오븐에 넣기는 `shaping.ts`의 `startBake()` 하나로 한다.
  album과 shop(상점)은 title에서 곧장 들어간다. **빵을 먼저 고르는 이유는
  반죽 재료·빚는 법·굽는 그릇이 빵마다 다르기 때문이다** — pick이 `toppingIds`·`seed`를 정하고, kneading은 `{ breadId, toppingIds, seed }`,
  forming·mold·shaping은 거기에 `roughness`를 더해 받는다(없으면 choose로 돌려보낸다).
  stage 이름 `shaping`은 역사적 이유로 토핑 단계를 가리킨다 — 반죽 모양을 빚는 건 `forming`이다.
- 스테이지는 마운트 도중 `ctx.go()`로 다른 곳에 보낼 수 있다(데이터 없음 → choose, 빚는 법 없는 빵 → mold).
  main.ts가 `navToken`으로 이걸 감지해 보낸 쪽의 빈 cleanup이 받은 쪽 cleanup을 덮어쓰지 않게 한다.
- `ctx.refresh()`는 지금 화면을 같은 데이터로 다시 그린다(개발자 모드에서 저장 데이터를 바꾼 뒤).
- 부팅 시 `save.activeBake`가 있으면 title을 건너뛰고 바로 baking으로 간다.
- **뒤로 버튼 규칙**: 모든 스테이지 헤더 왼쪽은 `data-back` + `←` 하나뿐이고, 목적지는 어느
  단계에서든 **항상 title**이다(이전 단계로 한 칸 돌아가지 않는다). 잃는 게 있을 때만
  `ui.ts`의 `confirmSheet()`로 묻는다 — 반죽(재료를 넣은 뒤)·모양 빚기·틀에 넣기·토핑·굽기·꺼내기.
  빵 고르기·도감·상점은 묻지 않는다.

### 시간과 저장 상태

**굽기 진행도는 wall-clock 기준이다.** `activeBake`에 `startedAt`/`durationMs`만 저장하고
매 프레임 `(Date.now() - startedAt) / durationMs`로 진행도를 다시 계산한다. 앱을 껐다 켜도,
탭이 백그라운드로 가도 진행이 이어진다 — 이 불변식을 깨는 누적 타이머를 도입하지 말 것.

[src/state/save.ts](src/state/save.ts)는 Capacitor Preferences 위의 단일 캐시다.
`getSave()`가 돌려주는 객체를 **직접 변형한 뒤 `persist()`를 호출**하는 게 이 코드베이스의 방식이다
(setter나 불변 업데이트 없음). 저장 키는 `oven-mung-save-v1`이고, 로드 시 기본값과 얕게 병합하므로
`SaveData`/`Settings`에 필드를 추가할 때는 `defaultSave()`/`defaultSettings()`도 같이 채운다.

`loadSave()`는 얕은 병합 뒤에 `normalizeAlbum()`으로 **옛 저장본을 현재 모양으로 맞춘다** —
토핑이 없거나 하나뿐이던 시절의 단수 `toppingId`('none' 또는 토핑 하나)를 `toppingIds` 배열로
바꾸고, `id`를 조합 키로 다시 계산하고, 같은 조합이 여러 번 있으면 가장 최근 것만 남긴다.
`activeBake`도 같은 변환을 거친다. 저장 구조를 또 바꾼다면 키를 올리기보다 여기에 정규화를
더하는 쪽을 먼저 고려할 것 — 사용자의 도감을 버리지 않기 위한 선택이다.

### 도감과 해금 — 게임의 진행 루프

**도감은 기록장이 아니라 수집 도감이다.** `BakeRecord.id`는 `albumKey()`가 만드는 조합 키
(`shokupan:none`, `cookie:choco`, `cookie:almond+choco`)이고, 이 조합 하나가 도감의 한 칸이다.
토핑이 하나뿐이던 시절의 키와 모양이 같아서 옛 도감 칸이 그대로 이어진다. 기록은 반드시
[src/state/album.ts](src/state/album.ts)의 `upsertRecord()`를 통해서만 하며, 이미 있는 조합이면
새 칸을 만들지 않고 기존 칸을 최신 기록으로 갱신한다. `album`에 직접 `push`하지 말 것.

- `sortedAlbum()` — 빵 순서 → 토핑 개수 → 토핑 순서로 정렬해 돌려준다 (도감은 종류별로 늘어놓는다)
- `isNew`는 새로 발견한 조합에만 붙고 상세를 열면(`markViewed`) 꺼진다. 타이틀의 도감 버튼
  옆 점(`.new-dot`)이 이걸 본다. 이미 발견한 조합을 다시 구워도 `isNew`는 되살아나지 않는다.

**해금은 `album.length` 하나에서 파생된다** — 저장하지 않고 매번 계산한다
(`isBreadUnlocked` / `isToppingUnlocked`). 빵이나 토핑을 추가할 때는 `unlockAt`이 실제로
도달 가능한지 확인할 것: 어떤 해금 시점에서든 그때까지 만들 수 있는 조합 수가 다음 기준치보다
많아야 사다리가 끊기지 않는다. `BREADS` 배열은 해금 순서로 늘어놓는다 — 빵 고르기 화면과 도감
정렬이 이 순서를 따른다.

상점([stages/shop.ts](src/stages/shop.ts))은 열람 전용 진열장이다 — 화폐도 구매도 없고,
토핑을 실제로 고르는 곳은 토핑 고르기 단계(pick)다. 선택 상태를 한 곳에만 두기 위한 구분이다.

### 아트 에셋 — Blender 카툰 ([renders/blender_cartoon/](renders/blender_cartoon/))

**게임 화면의 그림과 3D는 모두 Blender 카툰 에셋이다.** 기준 스타일·빌더는 `render_cartoon.py`(렌더 작업
노트는 [renders/README.md](renders/README.md)), 게임용 출력은 `render_game.py`가 만든다:

```bash
renders\blender_cartoon\game.ps1                       # 전부 (CPU 약 40분) → renders/blender_cartoon/game/
renders\blender_cartoon\game.ps1 -groups glb -only models/pie   # 일부만 (-groups stage,tool,bread,glb)
python renders/blender_cartoon/export_game.py           # game/ → public/assets/*.webp·*.glb + src/assets/sprites.json
```

**모션은 실시간이다 — 미리 렌더한 프레임을 바꿔 끼우지 않는다**(사용자 요청: "프레임 캡처처럼 보이지 않게").
Blender는 움직이지 않는 것만 만들고, 움직이는 반죽은 게임이 three.js로 매 프레임 만든다:

- **무대(`stage/<이름>`)** — 반죽 볼(`knead`)·반죽 판(`form`)·쿠키(`form_cookie` — 뒤에 큰 반죽이 든 볼, 앞에 판)·틀(`mold_<빵>`)·
  **모양 빚기 판(`form`)은 다른 무대의 판보다 1.5배 크다**(`render_game.py`의 `FORM_K`, 사용자 요청 — 세로로 길게 민 반죽이 올라간다).
  forming은 이 무대를 화면보다 조금 크게 그린다(`StageView`의 `fit`·`cx` — 손잡이 쪽은 화면 밖). 밀대·빵칼 그림은 이 카메라로 렌더해서
  다른 무대(파이 테두리·팬케이크 칼집)에선 `KNIFE_SCALE`만큼 키워 그린다.
  트레이(`mold_tray` — **뒤에 트레이, 앞에 반죽 판**. 트레이 빵은 판 위에서 토핑을 올리고 판에서 트레이로 옮긴다.
  `stage.mold_tray`의 `center`·`boardCenter`·`boardTop`)·자르기(`cut` — 같은 판을 **깨끗하게**, 같은 시점)마다
  투명 배경 그림(.webp, 그림자는 shadow catcher) + **같은 카메라·같은 그릇 메시의 GLB**.
  [render/live/liveStage.ts](src/render/live/liveStage.ts)가 GLB의 카메라로 3D 층을 그림 위에 겹치고, 그릇 메시를
  **깊이만 쓰는 가림막 + 그림자만 받는 면**으로 써서 실시간 반죽이 그림 속 그릇 '안에' 보이고(앞 벽에 가려짐)
  그림자가 그릇에 진다. 세 겹 캔버스(bg 그림 · gl 3D · fg 2D 덧그림)는 [render/live/stageView.ts](src/render/live/stageView.ts).
  **그릇·트레이·도구는 가로로 반듯하게**(카메라 방위 0) — 비스듬히 놓지 않는다(사용자 요청).
  **파이 틀 무대(`mold_pie`)는 카메라를 물려 렌더했다**(`PIE_MARGIN` 1.5, 다른 무대 1.1) — 틀보다 큰 민 반죽이 화면에 들어오게(사용자 요청). 빵칼 그림도 그만큼 작게(mold.ts `PIE_KNIFE_SCALE`).
- **그릇 안쪽 모양**(벽 반지름 표·바닥·가득 높이·칸 위치)은 sprites.json의 `stage.<이름>`에 three.js 좌표(미터, Y 위)로
  있다. Blender 함수에서 계산한 값이라 손으로 고치지 말고 다시 렌더·export할 것.
- **도구(`tool/*`)** — 계량컵·컵·달걀·버터·거품기·밀대·빵칼·붓는 볼. 무대와 같은 카메라로 렌더한 2D 그림이라
  같은 상자 크기로 그리면 크기가 맞는다. 기준점(가운데·입구·끝)은 `tool.<이름>`.
- **빵 그림(`bread/<빵>_<0~3>`)** — 그릇에서 빼낸 빵 × 굽기 4단계(빵 고르기·도감). 자른 단면 그림은 없다 — 꺼내기는 3D.
- **오븐 3D(`models/<빵>.glb`)** — 그릇 + 빵 껍질(`bread_*`, 정점 속성 `_toast` = Blender의 굽기 분포, `_score` = 바게트
  칼집이 벌어진 변위) + 소품(`extra_*`). **빵 메시는 다 구운 끝 모양이고 그릇·트레이 안에 꼭 들어간다** — 트레이 빵은
  `fit_on_tray`가 가로로 반듯하게 놓고 트레이 안쪽에 맞게 크기를 맞춘다(`TRAY_SCALE`). 오븐 와플은 윗면 매끈(`WAFFLE_SMOOTH`) — 다 구운 와플은 격자 면을 보여 준다(도감 그림, 꺼내기는 `models/waffle_grid.glb`). [render/breadModel.ts](src/render/breadModel.ts)가 불러와 변환을 정점에 구워 넣고 **그릇·트레이째** 크기를
  맞춘다(트레이 전체가 오븐 창에 — 확대해 넘치게 하지 않는다). 못 불러오면 예전 절차적 메시(breadMesh.ts·vessel.ts).
  꺼내기(자르기)도 이 GLB를 쓴다 — [render/cutScene.ts](src/render/cutScene.ts).
- **같은 반죽 오브젝트 — 반죽부터 자르기까지 하나로 이어진다**(사용자 요청). 끝 모양(`formFinal`)·놓은 자리(`layout.placed`)·
  부은 양(`layout.fills`)이 토핑 화면(`doughSpecs`)을 거쳐 `activeBake.layout`으로 저장되고, 오븐은 GLB 정점마다 **그 반죽 겉면의
  가까운 자리**(`bakeStartSurfaces` → `mapToDough` → 속성 `aDough`·`aDoughN`)를 찾아 그 모습에서 시작해 다 구운 모양으로 모핑한다
  (`uMorph`). 토핑 알갱이(`render/live/bits.ts`의 `scatterBits` — 프레첼 소금도)는 토핑 화면 그대로의 3D 알갱이가 시작 자리 →
  끝 자리로 따라가고(오븐 `makeBitMaterial`·인스턴싱), 꺼내기까지 간다. 모양을 바꾸면 **live 반죽과 GLB가 크게 어긋나지 않게**
  맞출 것(둘이 다르면 모핑에 거미줄이 생긴다 — `croissantLine`·`TRAY_SCALE`이 그래서 짝이다). **한 덩이 반죽은 상자 가운데를 원점에**(`formedPieces`) —
  GLB도 트레이 가운데에 상자 가운데를 맞춰 두어서, 어긋나면 정점이 엉뚱한 겉면에 붙어 굽기 시작할 때 반죽이 뭉개지고 트레이에 묻힌 듯 보인다(프레첼).
  `mapToDough`는 가장 가까운 겉면이 반대쪽을 보면 같은 쪽을 보는 겉면을 찾는다(꼬임·겹친 자리). 일찍 꺼낸 빵은 덜 부푼 모양으로
  자른다(`progress` → `settleAt`). 반죽 단계의 공도 모양 빚기 공과 크기·결이 같다(`DOUGH_R`, `BALL_SEED`).
- 실시간 반죽의 재료·모양은 Blender 빌더를 옮긴 것: [render/live/geo.ts](src/render/live/geo.ts)(덩어리 `Blob`, 줄
  `ropeGeometry`·`bent`, 판 `slabGeometry`, 그릇에 고인 반죽 `pooledGeometry`), [render/live/materials.ts](src/render/live/materials.ts)
  (Blender `toon()`과 같은 색 보정 `toonColor`, 무광 크림 질감의 묽은 반죽, 붓는 자리에서 번지는 퍼짐 마스크 `withSpread`).
  **render_game.py의 `DOUGH` 표(빵마다 반죽 색)는 content/breads.ts의 `doughColor`와 같아야 한다.**

### 반죽 · 모양 빚기 — 모션 단계들

**묽은 반죽(batter)과 덩어리 반죽(dough)이 갈린다** — `isBatter(def)`(틀에 붓는 빵, `vessels.ts`). **손은 그리지
않는다** — 도구(거품기·밀대·빵칼)만 손가락을 따라다니고, 손으로 하는 몸짓은 반죽만 움직인다.

- **kneading** ([stages/kneading.ts](src/stages/kneading.ts)) — 재료는 볼 어디에 놓아도 **볼 가운데로** 들어간다.
  가루는 계량컵에서 쏟아져 가운데에 원뿔로 쌓이고, 액체는 줄기로 흘러 **볼 바닥 전체로 번진 뒤**
  (퍼짐 마스크) 부피만큼 차오른다(`levelFor` — 볼 벽 표로 부피 → 높이).
  **쌓이는 재료(가루·달걀·버터)는 앞선 재료의 생김새를 따라 층층이 얹힌다** — `stack` 배열이 들어온 순서를 들고 있고, 층마다 아래층까지의
  윗면(`topOf`) 위에 앉는다(`render/live/drape.ts`의 `DrapedLayer` — 극좌표 격자의 정점을 다시 계산). 뒤에 온 가루는 둥근 층으로 비탈에 조금 비켜 앉고,
  작고 단단한 노른자·버터는 위층에 넓고 완만한 언덕(`softHill`)으로 넘긴다 — 제 크기 그대로면 덮는 재료가 첨탑처럼 뾰족해진다. 달걀·버터는 액체 위에 뜬다.
  **노른자는 아래 재료의 생김새대로 모양이 변한다**(`shapeYolk` — 평균 비탈로 눕고 `YOLK_TILT`, 세부 굴곡은 일부만 따른다 `YOLK_CONFORM`. 1로 두면 능선을 따라 나뭇잎처럼 가늘어진다).
  **버터는 쌓인 재료에 반쯤 묻힌다**(`shapeButter` — `BUTTER_BURY`만큼 가라앉으며 비탈을 따라 기울고, 둘레에 가루가 낮게 밀려 올라온다. 볼 바닥·액체 면에는 묻히지 않는다).
  달걀(앞 오른쪽)과 버터(앞 왼쪽)는 카메라 쪽 비탈에 서로 비켜 앉는다.
  **꿀은 끈적하다**(`kind: 'viscous'`, `shapeHoney`) — 천천히(`ADD_VISCOUS_SEC`) 가는 줄기로 곧게 늘어져(`PourStream.update`의 `viscous`) 끝에서 똬리를 틀며 봉긋이 쌓이고, 부피를 지키며 아주 천천히 퍼진다(`HONEY_TAU`·`HONEY_H`).
  액체처럼 번지거나 고인 면을 올리거나 들어오자마자 섞이지 않는다 — 앞선 재료를 덮고, 물에 떨어지면 가라앉고, 저어야 풀린다.
  **넣을 때마다 섞인다** — 쌓인 가루는 액체에
  서서히 녹아들고(`DISSOLVE`), 내용물 색은 넣은 재료들의 부피 가중 평균. **액체는 들어오자마자 섞인다** —
  제 색의 얼룩이 가운데서 소용돌이치며 번지다 옅어져 내용물 색이 된다(`withSpread`의 `incoming`). 줄기는 3D 관(`PourStream`).
  **번지기는 지수적**(처음엔 빠르고 점점 느리게 — `SPREAD_K`), **차오르기는 빠르고 일정한 속도**(`RISE_SPEED`, 부피가 아니라 높이 기준 —
  붓는 중이면 그 재료를 다 부은 높이를 향해 오른다)이고 붓는 동안 윗면이 **아주 살짝 출렁인다**(`withSpread`의 `slosh`, `SLOSH_AMP`).
  **달걀은 액체가 아니고 날달걀이다** — 깨져 떨어져도 노른자 + **맑은 흰자**(`rawEggWhiteMaterial` — 희지 않고 아래가 비친다)로 앞선 재료 위로 흘러내려 있다가 섞으면 풀어진다.
  **가루는 재료마다 제 결**(`render/live/powder.ts` — 밀가루·설탕·소금·이스트의 표면 무늬 + 흩어진 알갱이, `Ingredient.grain`).
  버터는 떨어져 튀어 얹힐 뿐 **내용물의 색도 부피도 바꾸지 않는다**(섞으면 그냥 녹아 사라진다).
  섞기: batter는 거품기로 빙글빙글(누적 각도 — 반죽 면의 결과 멍울이 같이 돈다), dough는 재료가 한 덩이로 뭉친 뒤
  **가운데에 묶이지 않고 손가락을 따라 볼 안을 자유롭게 굴러다닌다**(용수철로 따라가고, 놓으면 볼의 비탈을 따라
  흔들리며 미끄러지고, 벽에 부딪히면 튕긴다). 굴린 거리가 진행도 — 움직이는 쪽으로 늘어나고(`Blob.update`의
  stretch), 결은 굴러간 만큼 돈다(rot — 밑면은 늘 바닥에). 진행도 → `roughness`. **반죽은 볼 밖으로 나가지 않는다** —
  매 프레임 `conformToBowl`이 오목한 바닥 아래로 내려간 점은 바닥 위로, 벽 밖으로 나간 점은 벽 안으로 끌어들인다.
- **forming** ([stages/forming.ts](src/stages/forming.ts)) — 빵마다 빚는 법이 [content/forming.ts](src/content/forming.ts)의
  `FORMS`(없는 빵 = batter → 건너뜀). 몸짓: `rub` 빙글빙글 / `roll` 한 축으로(`dir`이면 한 방향만) / `press` 누르고
  있기 / `tear` 당겨 떼어 내기 / `pressEach` 조각을 하나씩 누르기 / `cut` 칼선 따라 긋기. 화면 진행도는 실제 값을
  부드럽게 따라가고, 그 값으로 [render/live/formShapes.ts](src/render/live/formShapes.ts)의 `formShape`가 반죽을 그 자리에서
  다시 만든다(모든 지오메트리에 정점 색 — 칼이 지나간 금은 어둡게, 재질은 `vertexColors`).
  **밀대로 민 반죽은 세로로 긴 타원이다**(`OVAL`, 사용자 요청 — 식빵·크루아상·베이글·바게트·프레첼). **긴 옆선은 거의(완전히는 아니게) 곧고**
  위아래 끝은 둥글다(`OVAL_P` 3.2 — `ovalProfile`·`ovalW`·`ovalR`, 사용자 요청). 접을 때는 외곽 점마다 폭을 따로 준다(`extrudeOutline`의 `widths`).
  **돌돌 마는 반죽은 정말로 말린다**(사용자 요청 — 다 만 통을 판 끝에 얹지 않는다): `rollSheet`가 판의 앞쪽을 들어 올려 위로 넘기며 감는
  나선(겹이 서로 닿는다, 길이 그대로)을 `sheetGeometry`(geo.ts — 단면 중심선을 따라 놓인 줄마다 폭 w로 펼친 판)로 만든다. 다 말면 뒤 끝이 통 밑에
  깔린다. 말아 빚는 판(식빵·베이글·프레첼)은 공의 부피만큼 두툼하다(`ROLL_H`). 크루아상 세모는 바깥 겹일수록 좁아 겹이 저절로 계단처럼 보인다.
  **안내선**(사용자 요청): 칼선과 접는 선은 fg 캔버스의 점선으로 보여 준다(`drawGuides` — `cutLines` + `foldGuides`). 그은 줄·접힌 선은 사라진다. 파이 테두리(mold)·팬케이크 칼집(baking)도 점선.
  **반죽에 굵은 외곽선이 생기지 않게**(사용자 요청): `LiveStage`의 바닥 쪽 빛을 밝게 했다. **판의 아랫면 가장자리도 윗면처럼 둥글다**(사용자 요청 — `slabGeometry`:
  가운데는 판에 닿아 평평하고 가장자리에서 둥글게 말려 올라가 윗면과 옆을 보며 만난다).
  가로로 길게 늘이는 굴리기(줄 굵기 맞추기, 바게트 늘이기·끝 가늘게)는 **위아래로** 문지른다(사용자 요청 — 줄과 직각).
  단계가 많은 빵(크루아상 12단계)은 지금 단계 앞뒤 칩만 보여 준다(`STEP_WINDOW`). 개발자 모드에선 `window.__formSkip()`이 지금 단계를 바로 끝내고,
  `window.__formSet(단계, 0~1)`이 화면의 단계·진행도를 바로 정한다(중간 모습 확인용).
  **쿠키**는 무대 `form_cookie`에서 — 볼 속 큰 반죽을 잡아 당기면 조각이 손가락을 따라 늘어나다 목이 끊어져 **손으로 뜯은 듯
  울퉁불퉁한 같은 크기**로 떨어져, 앞쪽 판의 **줄 맞춘 3×2 자리**(`COOKIE_SPOTS` — 트레이·오븐과 같은 격자)에 놓인다(6번, 마지막은 남은
  반죽 전부). 그 뒤 **하나씩** 누르고 있으면 그 조각만 납작해진다.
  **플랫브레드**는 판에 놓인 반죽을 스크레이퍼(3D — `makeScraper`)로 십자로 그어 넷으로 나누고(`FLAT_SPOTS` — 트레이·Blender `FLAT_SPOTS`와 같은 2×2),
  조각을 하나씩 문질러 **공처럼 굴려** 둥글리고(`rubEach` — 문지르는 쪽으로 반죽이 굴러가 결이 같이 돈다: forming.ts의 `rollQ`, formShapes.ts의 `roundingPiece`, 사용자 요청), 소가 있으면 밀어 › 소 올려 › 오므려 감싸고(`withToppings` 단계), 하나씩 눌러 편다. 하나씩 하는 몸짓의 진행은 단계마다 `pressBy`.
  **칼질**은 칼선(`cutLines` — 크루아상 세모, 플랫브레드 십자, 바게트 칼집 셋, 파이 띠 다섯 줄)을 따라 **칼날이 지나간 구간에만** 가는 금이 난다. 끝까지 그은 줄만
  잘린다. 바게트 칼집은 금만 — 벌어지는 건 오븐에서(아래 '렌더링'). 빵칼 그림은 칼선 방향으로 눕는다.
  **파이 격자 단계**는 `PIE_LATTICE_STEPS`(밀기·띠로 자르기, formShape 단계 1~2 — 0은 크러스트로 깔 큰 판). 모으는 단계는 없다 — 잘라 낸 반죽은 이미 한 덩이다(사용자 요청).
  빵을 추가하면 `FORMS`와 `formShape`를 같이 채운다. 마지막 모양(`formFinal`)이 다음 단계로 **그대로** 넘어간다.
  **`FORMS` 배열의 순서가 곧 `formShape`의 단계 번호다** — 올릴 토핑이 없으면 `toppings` 단계만 건너뛰고 번호는 그대로(`shapeOf`).
  공정(사용자 요청): 식빵 밀기 › 토핑 › 말기 / 크루아상 밀기 › 버터 감싸기 › (길게 밀기 › 세 겹 접기) ×2 › 큰 직사각형(세로로 길게 › 가로로 넓게 — 두 방향을 따로, 가로로 밀 땐 밀대를 세운다) › 세로로 긴 세모 자르기 › 토핑 › 밑변에서 끝으로 말기(끝은 저절로 밑으로 들어가고 판 가운데로 — `CRO_ROLLED`) › 초승달 /
  베이글 밀기(다 밀면 저절로 가로로 돌려 놓는다 — `sinceDone`) › 토핑 › 감싸며 말기 › 이음매·양 끝 꼬집어 붙이기 › 일정한 굵기로 › 한쪽 끝 납작하게 › 둥글게 구부려 납작한 끝으로 다른 끝을 감싸 잇기
  (감싸기는 세 마디 — 구부려 끝을 맞대고 › 넓적한 끝이 다른 끝 위로 넘어가 덮고 › 소매처럼 둘러 감싼다(`BAGEL_OVERLAP`만큼 겹친다, 감싸는 끝은 덜 오므린다 `capRoundEnd`).
  이음매는 튀어나오지 않고 감싼 끝의 가장자리가 관을 둥글게 두르는 접힌 선(살짝 덮인 턱 + 옅은 골 — `bagelSeamD`·`bagelSeamDisp`, 참고 사진).
  Blender `build_bagel`이 같은 식·같은 고리(`BAGEL_RING`·`BAGEL_TUBE`·`BAGEL_OVERLAP`)를 쓴다: 빚은 모양 그대로 구워진다) / 바게트 밀기 › 토핑 › 세 겹 접기 › 반 접어 붙이기 › 길게 › 양 끝 가늘게 › 칼집 /
  프레첼 밀기 › 토핑 › 일정한 굵기로 › U자 › 양 끝 두 번 꼬기 › 꼬임을 U자 아래(5시·7시)로 › 눌러 붙이기. 손으로 감는 동작은 손 없이 반죽만 움직인다.
  **말린 크루아상은 겹이 계단처럼 또렷하다**(참고 사진 — 세모를 정말로 말아서 바깥 겹일수록 좁다. 겹이 뭉개져 한 덩이가 되면 안 된다).
  **다 빚은 초승달은 예전 모양 그대로**(사용자 요청 — `croCrescent`: croissantLine 중심선·굵기 곡선 + 4겹 계단 `croStair`). 세모는 정말로 말리고(`rollSheet`, 두께 `CRO_H`로
  통이 그만큼 통통해진다), 다 말린 순간 곧게 편 초승달 반죽으로 바뀌어 판 가운데로 온다. **구부려도 커지지 않는다** — 굽은 각을 이어 붙여 길이·굵기를 지킨다.
  **오븐 GLB는 이 초승달을 바탕으로**(Blender `build_croissant`가 같은 중심선·굵기·계단 겹을 쓴다, 반죽 = GLB × 0.92, 굵기는 × 0.9 — `TRAY_SCALE` 1.45).
  구운 빵은 **겹 가장자리가 둥글고 부드럽다**(`cro_layers`의 `soft` 0.07, 참고 사진) — 빚은 반죽은 또렷한 계단 그대로, 오븐에서 모핑하며 부드러워진다.
  **프레첼**은 곧은 줄 › U자(`pretzelU` — 양 끝이 위로 나란히) › 한 번 엇갈린 X자 › 두 번 꼬임(`pretzelTwisted`의 tau) › 꼬임을 넘겨 접기 순서로 참고 사진을 따른다.
  **꼬는 동안 둘레는 U자 그대로**(사용자 요청 — 미리 접힌 고리가 되지 않는다): 양 끝이 꼬임 쪽으로 당겨져 위가 좁은 물방울꼴(`pretzelDrop`)이 되고, 꼬임을 넘겨 접을 때 둥근 고리로 펴진다.
  둘레 옆선은 꼬임 밑동(경로 18·32 — `twistArm`)에서 꺾이지 않고 곧게 올라와 그대로 엇갈린다. 한 번 엇갈릴 때 끝은 비스듬히 위로 뻗는다(참고 사진). 줄은 판에 맞게 짧게 시작해 단계마다 조금씩 늘어난다(`PZ_ROPE`).
  **판 위 토핑·소는 가운데에, 가장자리에서 넉넉히 떨어져**(사용자 요청 — `bits.ts`의 `SHEET_INSET`, `FormBits.layout`).
  판 위 토핑은 `render/live/formBits.ts` — 칩을 올리면 떨어지고, 말거나 접으면 지나간 자리부터 속으로 들어간다(`sheetCover`). 다 빚으면 겉에 `ROLLED_PEEK`만큼만 드러나고, 나머지는 자른 면에 박혀 있다(`crumbTexture`의 `chips` — **나선 결은 그리지 않는다**, 사용자 요청).
  프레첼 경로(`pretzelPath`)는 Blender `build_pretzel`을 그대로 옮긴 것 — 오븐 모핑과 어긋나지 않게 같이 고칠 것.

**mold는 모든 빵이 거친다**([stages/mold.ts](src/stages/mold.ts), 다 넣은 모습은 [render/live/placed.ts](src/render/live/placed.ts)):
- **붓기(batter)** — 화면을 누른 자리의 칸에, **누른 자리로** 줄기가 떨어진다. 손가락을 따라 줄기가 움직이고, 다른 칸으로
  **저절로 넘어가지 않는다**. 반죽은 처음 떨어진 자리에서 번져 칸 바닥을 덮고(`COVER`), 그 뒤로 차오른다 — 번지는 반지름과
  보이는 높이가 목표를 **지수적으로** 따라간다(`SPREAD_K`·`FILL_K`). 줄기는 3D 관(`PourStream`). 와플 칸은 벽까지 빈틈없이
  (`squarePoolGeometry`, meta `half`). 모든 칸이 `ENOUGH`만큼 차야 다음으로. 부은 양은 `layout.fills`로 오븐까지 간다.
- **식빵** — 돌돌 만 통 반죽을 끌어다 식빵틀 위에서 놓으면 바닥으로 떨어져 **통 모양 그대로** 앉는다(누르지 않는다).
- **트레이 빵** — 토핑까지 올린 반죽이 앞쪽 반죽 판에 있고(`ToppingScene`의 조각 그룹 `pieces` — 토핑 알갱이·소가 그룹에
  붙어 같이 움직인다), **하나씩** 끌어다 뒤쪽 트레이에 놓는다. 여러 조각 빵(쿠키 6개·플랫브레드 4개 — `pieceSpots`)은 놓은 자리에서 가장 가까운 빈 자리
  (`traySpots`, 오븐 GLB의 자리와 같다)로, 한 덩이 빵은 놓은 자리에(트레이 밖으로 나가지 않게). 다 옮기면 `startBake`.
  **속에 넣은 소는 여기서 드러나지 않는다**(`setFillingReveal(0)`).
- **파이**(`fill: 'place'` — 묽은 반죽이 아니다, 속이 빈 파이를 자르면 빈 속에 그늘을 깐다 — `cutScene.ts`, 필링처럼 보이지 않게) — 민 판(`PIE_CRUST_R` — 틀 바닥·벽을 덮고 늘어질 만큼)을 **민 그대로의 크기로** 들고 와(줄였다 키우지 않는다)
  담으면 틀을 따라 깔리고 가장자리가 틀 밖으로 늘어진다 → 빵칼로
  테두리(점선)를 빙 둘러 자르면 지나간 자리에 금만 나고(`trimAt`), **잘린 반죽은 부서지지 않고 한 고리로 틀 둘레에 내려앉는다**(`ringDrop`, 사용자 요청)
  → 토핑 화면은 **빈 크러스트에서 시작한다** — 칩을 올리면 필링이 차오른다(`ToppingScene.setFilled`). **고른 토핑이 곧 필링**(`pieFillingColor` + 소복한 알갱이).
  **토핑이 없으면 필링 없이 속이 빈 채로**(사용자 요청 — `pieHollow`: 토핑 화면을 건너뛰고, 오븐·꺼내기는 GLB의 필링을 빼고, 도감은 `bread/pie_empty_*` 그림) → 잘라 낸 반죽을 밀어 띠로 자른 뒤 `phase: 'lattice'`로 돌아와 띠를 얹으면 격자로 엮이고 테두리가
  생긴다. 격자는 Blender `build_pie`와 같은 자리·폭(`LATTICE_W`).

토핑 올리기([stages/shaping.ts](src/stages/shaping.ts))는 같은 무대에 다 넣은 모습을 그대로 두고(트레이 빵은 반죽 판 위)
([render/live/toppingScene.ts](src/render/live/toppingScene.ts)) 토핑 알갱이를 반죽 윗면에 3D로 흩뿌린다(위에서 광선 —
위를 향한 면에만, seed가 같으면 같은 자리).

### 토핑 여러 개 ([content/toppings.ts](src/content/toppings.ts))

토핑은 33종이고 종류(`category`: 차·향신료 / 견과·앙금 / 채소·치즈 / 과일 / 달콤)별 탭으로 pick에서 고른다(상점도 같은 묶음).
**들어가는 때가 종류마다 다르다**(사용자 요청): 가루(`tint`가 있는 차·향신료, `bowlToppings`)는 반죽 단계에 재료 칩으로 볼에 — 반죽이 처음부터 그 색이다.
**겉 알갱이는 직접 올린 토핑만**(사용자 요청 — 겉에 토핑을 저절로 올리지 않는다): 볼에 섞은 가루는 반죽 색만 물들이고(`toppingSlots`가 빼낸다),
말아 빚은 빵의 토핑은 겉에 드러나지 않는다(`ROLLED_PEEK` 0 — 자른 면에만).
슈가파우더(`isAfterBakeTopping`)는 **구운 뒤** finish에서 손가락을 흔들어 뿌린다(`uSugar` — 오븐에는 없다, `bakedToppingIds`). 나머지(`placedToppings`, 앙금 포함)는 반죽 위에 올린다.
기존 5종은 도감 0·3·6·9·12, 나머지는 **도감 14부터 2개마다 하나씩**(마지막 68) 해금된다.

**최대 `MAX_TOPPINGS`(2)개**이고 `toppingIds: ToppingId[]`로 들고 다닌다. `ToppingId`에
`'none'`은 없다 — 토핑 없음은 빈 배열이고, ❌ 칩은 토핑 화면 UI에만 있다.

- **`canonicalToppings()`** — 중복 제거 → `TOPPINGS` 배열 순서로 정렬 → 최대 개수로 자름.
  저장·도감 키·제목이 모두 이걸 거치므로, 고른 순서와 상관없이 같은 조합은 같은 칸·같은 이름이다.
  그래서 `TOPPINGS` **배열 순서가 곧 제목에서 토핑 이름이 놓이는 순서**다("아몬드 초코칩 쿠키").
  해금 순서는 `unlockAt`이 따로 정하고, 상점은 `toppingsByUnlock()`으로 그 순서대로 보여준다.
- **`comboName()` / `bakeTitle()`** — "아몬드 초코칩 쿠키" / "노릇노릇한 아몬드 초코칩 쿠키".
  도감 카드·도감 상세·꺼내기 캡션·굽기 헤더·완료 알림이 모두 이 두 함수로 이름을 만든다.
- **`toppingSlots()`** — 렌더러용, 항상 길이 `MAX_TOPPINGS`(빈 슬롯은 밀도 0). 슬롯마다 색·밀도·알갱이 크기(`size`).
  알갱이 토핑이 두 개면 빵이 덮이지 않게 각각 옅게 한다. 3D·2D가 같은 함수를 써서 이 규칙은 여기 한 곳에만 있다.
- **`tintedBread()`** — 녹차·홍차·커피·시나몬·생강·민트초코처럼 반죽에 섞이는 재료(`tint`)로 **빵 색 자체를 물들인**
  `BreadDef`. 셰이더(`makeBreadMaterial`)·2D(`drawBread`/`drawCrumbFace`)·틀 속 반죽 색이 모두 이걸 거쳐
  물들기 규칙이 한 곳에만 있다(셰이더에는 물들기 코드가 없다). 순수 가루 재료는 `density: 0`이라 알갱이가 없다.
  색은 hex여야 한다 — 2D가 `hexToRgb`로 파싱한다(`mixHex` 사용).
  `MAX_TOPPINGS`를 바꾸면 셰이더의 슬롯 배열 크기도 `defines`로 따라간다.
- **속에 넣는 소** — `ToppingDef.filling`(팥앙금·완두앙금처럼 페이스트인 토핑). 겉 알갱이가 없고
  (`toppingSlots`에서 빈 슬롯 — 그래서 3D 셰이더는 손댈 게 없다) `fillingsOf()`로 따로 꺼내 그린다:
  토핑 화면에선 반죽 위에 한 숟갈 얹혔다가 속으로 쏙 들어가 봉긋한 자리만 남고(`drawToppingStage`의
  `fillingReveal` 1 → 0), 꺼내기의 자른 면에선 몽글하게 보인다(둘이면 두 겹).
  토핑 화면의 소는 첫 반죽 덩이 윗면 가운데 — 고리(베이글)·초승달(크루아상)은 가운데가 비어 몸통 쪽으로 옮긴다
  (`toppingScene.ts`). 자른 면에선 단면 다각형에서 **가장자리로부터 가장 먼 자리**에, 그 거리보다 작게 그린다
  (`cutScene.ts`의 `deepest` — 소가 빵 밖으로 삐져나오지 않는다. 베이글처럼 단면이 여럿이면 단면마다).

토핑 올리기 화면의 미리보기와 오븐 속 빵은 **같은 seed**를 쓴다 — seed를 토핑 고르기(pick) 진입 시 한 번
뽑아 `activeBake`까지 넘기므로, 미리보기에서 본 알갱이 배치 그대로 구워진다.

### 굽는 그릇 · 틀에 넣기

`BreadDef.vessel`이 어디에 굽는지 정한다 — `tray`(쿠키·크루아상·베이글·플랫브레드·바게트·프레첼)와 틀·팬
(식빵틀·머핀틀·도넛틀·와플틀·파이 틀·케이크틀·프라이팬). `usesVessel(def)`가 참이면 반죽 다음에
[stages/mold.ts](src/stages/mold.ts)를 거친다. 넣는 방식은 `BreadDef.fill`:

- `'pour'`(기본) — 묽은 반죽. 누른 칸에 부어 칸마다 번진 뒤 차오른다(위 '모션 단계들' 참고)
- `'place'` — 덩어리 반죽을 담는다. 식빵(통 반죽 그대로)과 파이(판 깔기 → 테두리 자르기 → 필링 → 격자)

전략 없음 원칙대로 붓는 양·놓는 위치는 결과에 영향을 주지 않는다.

오븐 속 그릇은 GLB에 빵과 함께 들어 있다. 불러오지 못했을 때의 절차적 그릇은 [render/vessel.ts](src/render/vessel.ts)의 `makeVessel` — 빵 바운딩 박스에 **딱 붙게**(`WALL_GAP` 1.01,
도넛틀 기둥 = 도넛 구멍) 크기를 정하고,
빵 셰이더가 아닌 일반 재질이라 갈변하지 않는다. 벽은 빵보다 낮게 두어 봉긋한 윗면과 토핑이 보인다.
팬케이크의 프라이팬은 `replacesTray`로 트레이 자리를 대신한다. 꺼내기·도감의 2D는 **틀에서 빼낸 빵**이라
그릇을 그리지 않는다(컵케이크 종이 컵받침만 빵의 일부로 남는다).

**부풀기는 서서히** — 정점 셰이더의 `rise = smoothstep(0.02, 0.8, uProgress)`(S자). 넣자마자 다 부푼 모양이면
안 된다. 세로 부풂(`riseY`)은 **가운데가 먼저 솟고 가장자리가 늦게 따라와**(`uHalfW` 기준 거리) 봉긋한 머리가
서서히 생기고, 한창 부풀 때 숨 쉬듯 아주 느리게 들썩인다(`breathe`). 가로 부풂은 `rise` 하나로만 —
가장자리마다 다르게 키우면 안쪽 점이 바깥 점을 앞지른다. 부은 반죽(`uFlatStart`)은 부푸는 동안 윗면에
기포가 올라와 터진다(프래그먼트, `uTime`):

- **틀 빵**(`uMolded`): 옆으로는 **전혀** 커지지 않고(그래서 그릇을 빵에 딱 붙일 수 있다 — 바닥 빈틈 없음),
  바닥(`uBaseY`) 기준 세로로만 `uFillStart`(틀 벽보다 낮은 반죽 높이) → `1 + spring`배. 부은 반죽(`uFlatStart`)은
  시작 때 윗면이 평평하다가 부풀며 봉긋해진다. 표면 요철은 윗면에만.
- **트레이 빵**: 바닥 기준 세로 0.82배로 눌린 반죽에서 시작해 `1 + spring`배까지 — 옆으로는 원점 기준,
  **세로는 바닥 기준**으로 커진다(원점 기준으로 키우면 바닥이 트레이 아래로 꺼지거나 위로 뜬다).
- **트레이 빵 밑에는 접지 그림자**(`scene.ts`의 `contactShadow` — 빵 발자국을 흐리게 번진 판). 없으면 둥근 빵의 밑동이 트레이에 반쯤 박힌 것처럼 보인다(사용자 요청).
- **GLB 메시는 다 구운 끝 모양**(`uMorph`) — 위 틀·트레이 규칙은 절차적 메시용이고, GLB는 그 빵의 반죽 겉면(`aDough`)에서 메시(`position`)로
  모핑한다. 플랫브레드 GLB는 쿠키처럼 트레이째 여러 개(`build_flatbread_tray` — 4개). Blender에서 그릇·트레이 안에 맞춰 둔 모양이라 **굽는 내내 그릇·트레이 밖으로 나가지 않는다**. 틀 빵은 틀 벽에 가려
  **봉긋 솟은 윗부분만 보인다**. **표면 요철을 더하지 않는다** — 부푸는 빵의 윤곽이 매끈하다(사용자 요청).
- **팬케이크 십자 칼집**(`BreadDef.midScore`) — 덜 익은 때(`SCORE_AT`) 굽기가 멈추고(`scored`가 없으면 진행도가 거기서 막힌다) 오븐 창 위 점선(`scoreLines`, Blender 칼집과 같은 자리)을 빵칼로 두 줄 그으면
  `startedAt`을 다시 맞춰 나머지를 굽는다 — wall-clock 불변식 그대로, 완료 알림도 그때 건다. GLB의 칼집은 정점 속성 `_score`(높이 변위 → `scoreY`)로 되돌려 두었다가 낸 뒤에 벌어진다(`uScoreOpen`). 칼집 전에 꺼내면 칼집 없는 빵(`closeScore`).
- **바게트 칼집**(`score` 속성 — Blender `_score`를 가장 깊은 홈 = -1로 나눈 값): 시작은 반죽 겉면이라 **날카로운 가는 금**(`vScoreLine`)만
  있고, 모핑하며 서서히 벌어진다.

**빵은 굽는 내내 바닥에 붙어 있어야 한다.** scene.ts는 빵 바운딩 박스의 아래면을 그릇 바닥(`floorY`) 또는
트레이 윗면(살짝 파묻히게 `TRAY_SINK`)에 맞추고, 셰이더는 바닥 기준으로만 부풀리며 아래를 향한 면(`onFloor`)에는
요철·크랙을 주지 않는다. 형태를 새로 만들 땐 **밑면 전체가 바닥에 닿는지** 볼 것 — 크루아상처럼 끝으로 갈수록
가늘어지는 형태는 가운데 기준으로만 좁히면 끝이 공중에 뜬다(가늘어진 만큼 아래로 내려 밑면을 평평하게).

### 빵 13종 · 재료 · 형태

반죽 재료는 빵마다 다르다. [content/ingredients.ts](src/content/ingredients.ts)의 `INGREDIENT`
카탈로그에 이모지·이름을 한 번만 두고, `BreadDef.ingredients`는 id만 나열한다. 반죽 칩과 도감
상세의 재료 목록이 모두 `ingredientsOf(def)`를 쓴다.

형태(`GeometryKind`)는 `loaf · panLoaf · disc · crescent · ring · cylinder · cup · square` 여덟 가지이고,
**형태에 분기하는 곳은 네 군데뿐이다** — 새 형태를 추가하면 모두 채워야 한다:

- [render/breadMesh.ts](src/render/breadMesh.ts) `makeBreadGeometry` — 3D 메시
  (`cup`의 종이 컵받침은 갈변하면 안 되므로 `makeCupLiner()`로 따로 만들어 빵 메시의 자식으로 붙인다)
- [render/scene.ts](src/render/scene.ts) `GEOMETRY_TILT`(앞으로 기울기) — 높이는 바운딩 박스로 자동 계산하니 표가 없다
- [render/bread2d.ts](src/render/bread2d.ts) `breadPath` — 2D 실루엣 (`ring`은 `evenodd`로 구멍)
- [render/bread2d.ts](src/render/bread2d.ts) `CRUMB_FACE_H` — 자른 단면 높이

회전체 지오메트리(`LatheGeometry`)의 **평평한 면은 촘촘히 나눌 것** — 케이크 윗면이 긴 삼각형 한 줄이면 정점마다
계산하는 크랙·요철·노멀이 반지름 방향으로 번져 방사형 줄무늬가 생기고 토핑이 지워진다(`line()` 헬퍼).

`panLoaf`는 식빵틀에 맞춘 산형 식빵이다(촘촘히 나눈 상자 + 봉긋한 윗면). **꼭짓점을 `mergeVertices`로
이어 붙여야 한다** — 상자는 면마다 꼭짓점이 따로라, 셰이더가 노멀 방향으로 요철·크랙을 밀면 모서리가
찢어진다. `RoundedBoxGeometry`는 평평한 면을 나누지 않아 윗면을 부풀릴 수 없다.

**카메라가 거의 수평이라 납작한 빵은 옆면만 보인다.** 그래서 `ring`·`square`·`cylinder`·`panLoaf`와 얇은
빵(`thickness < 1`)은 `GEOMETRY_TILT`/`THIN_TILT`로 앞으로 기울여 윗면(도넛 구멍, 와플 격자,
토핑, 틀 입구)을 보여준다. 기울기는 **트레이(또는 프라이팬)·그릇·빵을 묶은 `floor` 그룹째** 준다 —
빵만 돌리면 평평한 트레이 위에 틀이 비스듬히 기대 선 꼴이 된다. 지오메트리는 돌리지 않는다: 셰이더가
오브젝트 좌표로 와플 격자와 토핑이 붙을 '윗면'을 판정하므로, 지오메트리를 돌리면 격자가 판의 모서리와 어긋난다.

`BreadDef.thickness`는 같은 형태로 팬케이크처럼 얇거나 파이처럼 두꺼운 빵을 만드는 세로 배율이다
(3D는 `bread.scale.y`, 2D는 disc 타원 높이를 완만하게). 높이는 두께를 곱한 바운딩 박스 아래면으로 맞추므로
두께가 달라도 바닥에 붙는다.

### 개발자 모드 ([src/dev/](src/dev/))

설정 시트의 토글로 켠다. 켜면 **별도 테스트 저장 슬롯**(`oven-mung-save-dev`)으로 바꾸고 앱을 다시
불러온다 — 실제 진행 기록(`oven-mung-save-v1`)은 켜져 있는 동안 건드리지 않는다. 그래서 부팅 순서는
반드시 `loadDev()` → `loadSave()`다(저장 키가 개발자 모드 여부로 정해진다).

- [dev/devState.ts](src/dev/devState.ts) — Preferences 키 `oven-mung-dev`의 옵션. **다른 모듈이 import해도
  순환이 생기지 않도록 Preferences 외엔 의존하지 않는다.**
- [dev/devPanel.ts](src/dev/devPanel.ts) — 모든 화면 오른쪽 위(헤더의 빈 오른쪽 칸) 🛠 버튼(`#app` 밖 `body`에 붙어 스테이지가
  바뀌어도 남는다)과 패널(반죽 화면의 ⏭ 건너뛰기 버튼은 🛠 왼쪽에 고정 — 헤더 오른쪽 칸은 🛠가 덮는다, 기본으로 켜짐): 모두 해금(**개발자 모드를 켜면 기본으로 켜진다** — 해금 사다리를 시험할 땐 끈다) · 굽기 시간 배율 · 반죽 건너뛰기 · 스테이지 바로가기(빵·토핑·거칠기·
  굽기 정도 지정) · 진행도 점프 · 도감 채우기(빵 × 토핑 0·1개 — 둘까지 다 채우면 7,000칸이 넘는다)/비우기/옛 저장본 넣기 · FPS · 소리/햅틱/알림 테스트 · 저장 JSON

게임 코드가 개발자 옵션을 보는 곳은 몇 군데뿐이고, 모두 우회 함수를 거친다:

- **해금** — 판정은 `album.length`가 아니라 `state/album.ts`의 `unlockCount()`(모두 해금이면 `Infinity`).
  화면에 보여줄 실제 개수는 `album.length` 그대로.
- **굽기 시간** — `bakeDurationMs`는 `timeDivisor()`로 나눈다(`?fast=1`의 20과 개발자 배율 중 큰 쪽).
- **진행도 점프**는 `activeBake.startedAt`을 당겨서 구현한다 — wall-clock 불변식을 그대로 지킨다.
- 반죽 건너뛰기 버튼, 굽기 화면 FPS 표시는 해당 스테이지가 `dev()`를 직접 본다.

### 품질 티어 (low / mid / high)

`Settings.quality`가 `auto`면 첫 굽기에서 80프레임을 재 평균 FPS로 `benchTier`를 정하고 저장한다
([baking.ts](src/stages/baking.ts)의 벤치 블록). 티어는 세 곳을 동시에 제어한다:

- `FPS_CAP` / `PIXEL_RATIO_CAP` / antialias — [render/scene.ts](src/render/scene.ts)
- 지오메트리 세그먼트 수 — [render/breadMesh.ts](src/render/breadMesh.ts)

티어 의존 값을 추가한다면 이 상수 테이블 패턴(`Record<Quality, T>`)을 따른다. 티어는 씬 생성 시점에
고정되므로 설정 변경은 다음 굽기부터 적용된다(설정 시트에 그렇게 안내되어 있다).

굽는 속도(`Settings.speed`)도 같은 성질이다 — `bakeDurationMs(def, speed)`로 **속도를 인자로
명시해 넘기고**(content가 state를 import하지 않도록), 결과가 `activeBake.durationMs`에 고정되므로
굽는 도중 설정을 바꿔도 진행 중인 굽기는 흔들리지 않는다.

### 렌더링

굽는 모습 자체가 게임이라 시각 로직이 두 갈래로 나뉜다:

- **3D (굽기 중)** — [render/breadShader.ts](src/render/breadShader.ts)의 커스텀 `ShaderMaterial`이
  전부다. 정점 셰이더가 오븐 스프링(팽창)·표면 요철·크랙을, 프래그먼트 셰이더가 마이야르 갈변을
  simplex 노이즈로 계산한다. CPU에서는 `uProgress`/`uBrowning`/`uTime`/`uLightOn` 유니폼만 밀어 넣고,
  `uTopCol[]`/`uTopDen[]`(토핑 슬롯)·`uGrid`(와플 격자)는 씬 생성 시 한 번 정해진다.
  메시는 Blender GLB(`breadModel.ts`) — 빵 껍질 메시마다 재질을 따로 두어 저마다의 바닥(`uBaseY`)·가운데(`uCenter`)
  에서 부푼다(컵케이크 6개가 각자 봉긋해진다). 정점 속성 `toast`(Blender의 굽기 분포, 절차적 메시는 1)가 갈변에
  곱해져 크루아상 결 사이·칼집 속처럼 덜 구워지는 자리가 오븐에서도 옅게 남는다. 기울기는 `MODEL_TILT`(그 빵을
  렌더한 카메라 고도에 맞춤). GLB 와플은 격자가 메시에 실제로 파여 있어 `uGrid`를 끈다.
  **크랙은 그리지 않는다**(사용자 요청 — Blender 카툰처럼 매끈한 껍질). 반죽·노릇·진한 색은 Blender `crust_mat`과
  같은 toon 보정(`toonColor` — `render_cartoon.toon`을 그대로 옮긴 것, sRGB의 HSV에서 곱한다)을 거친다.
  **`ShaderMaterial`은 색 공간을 자동으로 바꿔 주지 않는다** — 색 uniform은 선형 값이므로 프래그먼트 끝에 `#include <colorspace_fragment>`가
  있어야 한다(빠지면 빵이 어둡고 탁해지고, 오븐 반죽이 토핑 화면의 같은 반죽과 달라 보인다). 빵 재질·토핑 알갱이 재질 둘 다.
  **GLSL 예약어(`active`·`input`·`output`·`filter` 등)를 변수 이름으로 쓰지 말 것** — 셰이더가 컴파일되지 않으면
  빵만 사라지고 화면은 멀쩡해 보인다. 셰이더를 고쳤다면 굽기 화면에서 콘솔 오류를 꼭 확인한다.
- **3D (꺼내기)** — [render/cutScene.ts](src/render/cutScene.ts). 다른 단계와 **같은 무대 방식·같은 시점**(`StageView('cut')` — 깨끗한 반죽 판).
  오븐과 같은 GLB 빵(여러 개 구운 빵은 한 덩이만 — `pickOne`)을 같은 빵 셰이더로(`uStatic` = 메시 그대로, `uDay` = 오븐 밖 빛), 꺼낸 시점의
  모양으로(`settleAt`) 놓는다. **긴 빵은 화면에 가로로**(GLB 메시가 이미 x로 길다 — 돌리지 않는다, 아주 긴 바게트는 `FIT_LONG`으로 크게), **톱니 날 빵칼(3D)은 세로로**(날이 앞뒤 z 방향, 손잡이가 앞쪽,
  **판에 곧게 선다** — 비스듬히 눕히지 않는다, `KNIFE_ROLL` 0, 사용자 요청) 놓여 손가락을 따라 내려가고 판에 닿으면 빠져나간다. **저절로 벌어지지 않는다** —
  세로로 가는 틈만 남고 빵을 **톡 누르면** 왼쪽·오른쪽 두 쪽이 책 펼치듯 돌아누워 자른 면이 보인다(`setOpen`, 사용자 요청).
  **자른 면은 카메라 쪽으로 눕혀 거의 정면에서 보인다**(완전 정면은 아니다 — `OPEN_FACE`, 사용자 요청. 뒤로 넘어간 몸통 끝은 판에 가려진다). 컵케이크는 먼저 종이컵을 쓸어 벗긴다
  (`setPeel` — 정점 셰이더가 벽을 앞쪽부터 젖힌다). 메시를 평면 `x = CUT_X`(가운데에서 살짝 비킴 — 대칭 메시의 가운데 줄 정점을 피한다)로
  실제로 나누고(`splitAt` — 같은 모서리의 교점은 정해진 순서로 계산해 비트 단위로 같게), 잘린 선분을 이은 단면 고리를 삼각분할해 뚜껑을
  씌운다 — 긴 빵의 길이를 가로지르는 면이다. 뚜껑 텍스처는 속살 기공 + 소. 3D를 못 쓰면 예전 2D(`paintBread`·`drawCrumbFace`).
- **2D** — 도감·빵 고르기는 [render/bread2d.ts](src/render/bread2d.ts)의 `drawBreadSprite`: Blender로 굽기 4단계
  (0 · 0.55 · 1 · 1.4)를 렌더한 빵 그림을 갈변 정도에 따라 겹치고, 물들이는 재료는 빵 모양 그대로 색을 섞고,
  토핑 알갱이(`drawToppings`)는 빵 윗면에만 흩뿌려 빵 모양으로 오린다. 그림을 불러오기 전엔 예전 2D 그림
  (`drawBread`)으로 그린다(`paintBread`).

두 경로가 같은 빵을 그리므로 색 파라미터는 반드시 [content/breads.ts](src/content/breads.ts)의
`BreadDef`와 [content/toppings.ts](src/content/toppings.ts)의 `ToppingDef`에서 온다.
**표면 표현은 GLSL과 TS 양쪽에 중복 구현되어 있어 한쪽만 고치면 오븐 화면과 도감이 어긋난다:**

- 갈변 색 곡선 — GLSL `FRAGMENT` ↔ `util.ts`의 `breadSurfaceColor` (같은 구간 0.6 / 1.25 / 1.6)
- 토핑 알갱이 — GLSL의 슬롯 루프 ↔ `bread2d.ts`의 `drawToppings`(영역을 받아 Blender 빵·단면 그림도 같이 씀). 슬롯마다 노이즈를
  다르게 민다(GLSL `float(i) * 17.0` ↔ 2D 시드 `seed + 13 + i * 101`). 알갱이 크기도 맞춰져 있다 — GLSL 노이즈
  주파수 `5.5 / size` ↔ 2D 반지름 `s * (0.016~0.036) * size`. 주파수를 올리면 오븐 속 알갱이만 잘아진다. 갈변에 따라 함께 진해지는 규칙도
  `toppingColor`에 같은 값으로 들어 있다
- 와플 격자 — GLSL의 `uGrid` 분기 ↔ `bread2d.ts`의 `drawGrid`. 셰이더의 격자 간격(`3.45`)은
  breadMesh.ts의 와플 크기(1.45)에 맞춘 값이라 판 크기를 바꾸면 같이 고쳐야 한다

`browning`은 0~1.6 범위다. 1 초과는 "실패/탄 것"이 아니라 "더 진하게 구운 것"이며
([baking.ts](src/stages/baking.ts)의 `browningOf`), 이 게임에는 실패 상태가 없다.

`seed`는 굽기 시작 시 한 번 뽑혀 `activeBake` → `BakeRecord`까지 따라다닌다. 셰이더 노이즈와
2D 드로잉(`seededRandom`)이 같은 seed를 쓰므로 같은 빵은 언제 다시 그려도 같은 모습이어야 한다.

김서림([render/fog.ts](src/render/fog.ts))은 저해상도 오프스크린 캔버스에 농도를 그리고 블러로
확대 합성한다. 닦기는 `destination-out`, 재서림은 아주 옅은 흰색 덧칠.

### 오디오 ([src/audio/engine.ts](src/audio/engine.ts))

에셋 파일 없이 Web Audio로 전부 합성한다 — 훅(브라운 노이즈 + 저음 사인), 타닥거림(지수 분포로
스케줄된 노이즈 버스트, `browningLevel`이 올라갈수록 잦아짐), 완료 딩(배음 합성).
싱글턴 `audio`를 import해서 쓴다.

autoplay 정책 때문에 `AudioContext`는 첫 `pointerdown` 이후 `audio.ensure()`에서 생성된다.
오디오를 건드리는 코드는 `ctx`가 아직 null일 수 있다는 전제로 짠다. 볼륨 슬라이더는 제곱 매핑.

### 네이티브 래퍼 ([src/native/index.ts](src/native/index.ts))

햅틱·keep-awake·로컬 알림을 감싸고, **웹에서는 조용히 실패하거나 no-op한다**(try/catch 삼킴).
호출부는 `void hapticTick()`처럼 결과를 기다리지 않고 부른다. 네이티브 기능을 추가할 때도
이 패턴을 지켜 웹 브라우저에서 그대로 돌아가게 유지한다.

### UI

[src/ui.ts](src/ui.ts)의 `el(html)`로 템플릿 문자열에서 DOM을 만들고, `data-*` 속성으로 셀렉트한다.
스타일은 [src/style.css](src/style.css) 한 파일에 CSS 변수 기반으로 모여 있다.
세로 고정(`max-width: 480px`), 다크 전용, safe-area 인셋 적용 — 모바일 전제.

Capacitor가 `file://`로 로드하므로 [vite.config.ts](vite.config.ts)의 `base: './'`를 바꾸지 말 것.
같은 이유로 에셋도 `./assets/…` 상대 경로로 부른다(`sprites.ts`의 `spriteUrl`, `breadModel.ts`).

### 세션 인수인계 (전역 스킬 `session-handoff`)

긴 세션의 맥락을 같은 프로젝트의 다음 세션으로 넘기는 장치다(자동 압축은 꺼져 있다). 모든 프로젝트 공용이라
프로젝트 밖에 있다 — 스킬 `~/.claude/skills/session-handoff/`, 훅 `~/.claude/hooks/session-handoff/`, 등록 `~/.claude/settings.json`.

- `context-guard.mjs`(UserPromptSubmit·PostToolUse) — 컨텍스트 80%·90%에 한 번씩 "session-handoff 스킬을 돌려라"를 넣는다.
  한도는 `HANDOFF_CONTEXT_LIMIT`(기본 1,000,000).
- `handoff-load.mjs`(SessionStart: startup·clear·compact) — 이 프로젝트 메모리 폴더의 `session-handoff.md`를 컨텍스트에 넣는다.
- `/clear`나 세션 종료 전에는 `/session-handoff`를 직접 부른다(시작할 땐 할 일 없음).
