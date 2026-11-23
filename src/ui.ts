// 공용 UI 조각들 — 설정 시트, 확인 시트, DOM 헬퍼.
import { audio } from './audio/engine';
import { getSave, persist } from './state/save';
import { dev, switchDevMode } from './dev/devState';
import type { Quality, Speed } from './types';

export function el<T extends HTMLElement = HTMLElement>(html: string): T {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild as T;
}

/** 한 번 물어본다 — 기본 문구는 진행 중인 걸 두고 나갈 때의 것 */
/** 끌어다 놓거나 톡 누르면 onPut — 토핑·재료 칩 (어디에 놓아도 결과는 같다) */
export function bindPutChip(chip: HTMLButtonElement, onPut: () => void): void {
  let sx = 0;
  let sy = 0;
  chip.addEventListener('pointerdown', (e) => {
    chip.setPointerCapture(e.pointerId);
    sx = e.clientX;
    sy = e.clientY;
    chip.classList.add('dragging');
  });
  chip.addEventListener('pointermove', (e) => {
    if (chip.classList.contains('dragging')) chip.style.transform = `translate(${e.clientX - sx}px, ${e.clientY - sy}px) scale(1.15)`;
  });
  const end = (put: boolean) => {
    const was = chip.classList.contains('dragging');
    chip.classList.remove('dragging');
    chip.style.transform = '';
    if (put && was && !chip.disabled) onPut();
  };
  chip.addEventListener('pointerup', () => end(true));
  chip.addEventListener('pointercancel', () => end(false));
}

export function confirmSheet(
  message: string,
  onConfirm: () => void,
  labels: { ok?: string; cancel?: string } = {},
): void {
  const sheet = el(`
    <div class="sheet-backdrop">
      <div class="sheet">
        <p class="confirm-msg">${message}</p>
        <button class="btn btn-primary" data-ok>${labels.ok ?? '나가기'}</button>
        <button class="btn" data-cancel>${labels.cancel ?? '계속 하기'}</button>
      </div>
    </div>
  `);
  const close = () => sheet.remove();
  sheet.querySelector('[data-ok]')!.addEventListener('click', () => {
    close();
    onConfirm();
  });
  sheet.querySelector('[data-cancel]')!.addEventListener('click', close);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  document.body.appendChild(sheet);
}

/** 소리/품질/속도 설정 시트 (오버레이) */
export function openSettingsSheet(): void {
  const save = getSave();
  const s = save.settings;
  const sheet = el(`
    <div class="sheet-backdrop">
      <div class="sheet">
        <h2>설정</h2>
        <label class="slider-row">
          <span>오븐 소리 🔥</span>
          <input type="range" min="0" max="1" step="0.01" value="${s.volHum}" data-k="volHum" />
        </label>
        <label class="slider-row">
          <span>타닥거림 ✨</span>
          <input type="range" min="0" max="1" step="0.01" value="${s.volCrackle}" data-k="volCrackle" />
        </label>
        <label class="slider-row">
          <span>완료 딩 🔔</span>
          <input type="range" min="0" max="1" step="0.01" value="${s.volDing}" data-k="volDing" />
        </label>
        <label class="slider-row">
          <span>굽는 속도</span>
          <select data-speed>
            <option value="slow">느리게</option>
            <option value="normal">보통</option>
            <option value="fast">빠르게</option>
          </select>
        </label>
        <label class="slider-row">
          <span>그래픽 품질</span>
          <select data-q>
            <option value="auto">자동</option>
            <option value="low">낮음</option>
            <option value="mid">중간</option>
            <option value="high">높음</option>
          </select>
        </label>
        <p class="sheet-hint">속도와 품질 변경은 다음 굽기부터 적용돼요</p>
        <label class="slider-row">
          <span>개발자 모드 🛠</span>
          <input type="checkbox" data-dev ${dev().enabled ? 'checked' : ''} />
        </label>
        <button class="btn btn-primary" data-close>닫기</button>
      </div>
    </div>
  `);

  const qualitySelect = sheet.querySelector<HTMLSelectElement>('[data-q]')!;
  qualitySelect.value = s.quality;
  qualitySelect.addEventListener('change', () => {
    s.quality = qualitySelect.value as 'auto' | Quality;
    void persist();
  });

  const speedSelect = sheet.querySelector<HTMLSelectElement>('[data-speed]')!;
  speedSelect.value = s.speed;
  speedSelect.addEventListener('change', () => {
    s.speed = speedSelect.value as Speed;
    void persist();
  });

  for (const input of sheet.querySelectorAll<HTMLInputElement>('input[type=range]')) {
    input.addEventListener('input', () => {
      const k = input.dataset.k as 'volHum' | 'volCrackle' | 'volDing';
      s[k] = parseFloat(input.value);
      audio.ensure();
      audio.setVolumes(s);
      if (k === 'volDing') audio.ding();
    });
    input.addEventListener('change', () => void persist());
  }

  // 개발자 모드 — 저장 슬롯이 바뀌어 앱을 다시 불러오므로 먼저 확인한다
  const devToggle = sheet.querySelector<HTMLInputElement>('[data-dev]')!;
  devToggle.addEventListener('change', () => {
    const on = devToggle.checked;
    devToggle.checked = !on; // 확인 전까지는 그대로
    confirmSheet(
      on
        ? '개발자 모드를 켤까요?<br/>테스트 저장 슬롯으로 바꾸고 다시 불러와요.<br/>지금 진행 기록은 그대로 보관돼요'
        : '개발자 모드를 끌까요?<br/>원래 진행 기록으로 돌아가요',
      () => void switchDevMode(on),
      { ok: on ? '켜기' : '끄기', cancel: '취소' },
    );
  });

  const close = () => sheet.remove();
  sheet.querySelector('[data-close]')!.addEventListener('click', close);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  document.body.appendChild(sheet);
}
