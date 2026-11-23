# 🍞 오븐 멍

빵을 만들고, 구워지는 모습을 바라보며 멍때리는 게임. 타이머 압박도, 실패도 없습니다.

기획서: `oven-mung.md` 참고. 웹(Three.js + Web Audio) 기반으로 만들고 Capacitor로 감싸 스토어에 배포하는 구조입니다.

## 실행

```bash
npm install
npm run dev          # http://localhost:5173 — --host 로 LAN 공유되어 폰 브라우저로 접속 가능
```

- **빠른 굽기 테스트**: `http://localhost:5173/?fast=1` → 굽기 시간이 1/20 (식빵 6분 → 18초)
- 진행은 wall-clock 기준이라 탭을 닫았다 열어도 굽기가 이어집니다.

## 빌드 / Capacitor

```bash
npm run build        # tsc + vite build → dist/
npm run sync         # npx cap sync (웹 에셋 복사)

# 네이티브 플랫폼 추가 (이후 단계, Android Studio / Xcode 필요)
npx cap add android
npx cap add ios
```

## 구조

- `src/stages/` — 화면: title → kneading(반죽) → shaping(성형) → baking(굽기, 핵심) → finish(자르기) → album(도감)
- `src/render/` — Three.js 오븐 씬, 굽기 셰이더(오븐 스프링·마이야르 갈변·크랙), 김서림 오버레이, 2D 빵 드로잉
- `src/audio/` — 절차적 Web Audio (오븐 훅 / 타닥거림 / 완료 딩, 레이어별 볼륨)
- `src/state/` — Capacitor Preferences 저장 (도감, 설정, 진행 중 굽기)
- `src/native/` — 햅틱 / keep-awake / 로컬 알림 래퍼 (웹에선 no-op)
