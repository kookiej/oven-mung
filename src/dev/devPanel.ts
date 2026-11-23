// 개발자 도구 — 모든 화면 오른쪽 아래의 🛠 버튼과 패널.
// 개발자 모드에선 테스트 저장 슬롯을 쓰므로 여기서 무엇을 해도 실제 진행 기록은 안전하다.
import type { StageCtx } from '../main';
import { confirmSheet, el } from '../ui';
import { BREADS, bakeDurationMs, getBread } from '../content/breads';
import { MAX_TOPPINGS, TOPPINGS, canonicalToppings } from '../content/toppings';
import { formStepsOf } from '../content/forming';
import { clearSave, getSave, persist, writeRawSave } from '../state/save';
import { albumKey, upsertRecord } from '../state/album';
import { audio } from '../audio/engine';
import { hapticThud, isNative, scheduleBakeDoneNotification } from '../native';
import { dev, persistDev, switchDevMode, type DevOptions } from './devState';
import type { BakeRecord, BreadId, ToppingId } from '../types';

/** 바로가기에 쓸 선택 — 패널을 닫았다 열어도 유지 */
const pick = {
  breadId: 'shokupan' as BreadId,
  toppings: ['', ''] as (ToppingId | '')[],
  roughness: 0.3,
  browning: 1.0,
};

/** 모든 토핑 조합 — 없음, 하나, 둘 (최대 MAX_TOPPINGS) */
function allToppingSets(): ToppingId[][] {
  const ids = TOPPINGS.map((t) => t.id);
  const sets: ToppingId[][] = [[]];
  ids.forEach((a, i) => {
    sets.push([a]);
    if (MAX_TOPPINGS >= 2) ids.slice(i + 1).forEach((b) => sets.push([a, b]));
  });
  return sets;
}

function randomRecord(breadId: BreadId, toppingIds: ToppingId[]): Omit<BakeRecord, 'id' | 'isNew'> {
  return {
    breadId,
    toppingIds,
    browning: 0.3 + Math.random() * 1.2,
    seed: Math.random() * 100,
    roughness: Math.random(),
    finishedAt: Date.now() - Math.floor(Math.random() * 30) * 86_400_000,
  };
}

export function mountDevTools(ctx: StageCtx): void {
  const fab = el(`<button class="dev-fab" title="개발자 도구">🛠</button>`);
  fab.addEventListener('click', () => openPanel(ctx));
  document.body.appendChild(fab);
}

function openPanel(ctx: StageCtx): void {
  const o = dev();
  const save = getSave();
  const bake = save.activeBake;
  const toppingOptions = (sel: ToppingId | '') =>
    `<option value="">없음</option>` +
    TOPPINGS.map(
      (t) => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${t.emoji} ${t.name}</option>`,
    ).join('');

  const sheet = el(`
    <div class="sheet-backdrop">
      <div class="sheet dev-panel">
        <h2>🛠 개발자 도구</h2>
        <p class="dev-status" data-status>테스트 저장 슬롯 · 도감 ${save.album.length}칸</p>

        <section>
          <h3>진행</h3>
          <label class="slider-row"><span>모든 빵·토핑 해금</span><input type="checkbox" data-opt="unlockAll" ${o.unlockAll ? 'checked' : ''} /></label>
          <label class="slider-row"><span>반죽 건너뛰기 버튼</span><input type="checkbox" data-opt="skipKnead" ${o.skipKnead ? 'checked' : ''} /></label>
          <label class="slider-row"><span>굽기 시간</span>
            <select data-div>
              <option value="1">×1</option>
              <option value="20">×1/20</option>
              <option value="100">×1/100</option>
            </select>
          </label>
          <p class="sheet-hint">굽기 시간은 다음 굽기부터 · 굽는 중이면 아래 진행도 점프를 쓰세요</p>
        </section>

        <section>
          <h3>바로가기</h3>
          <label class="slider-row"><span>빵</span>
            <select data-bread>${BREADS.map(
              (b) => `<option value="${b.id}" ${b.id === pick.breadId ? 'selected' : ''}>${b.emoji} ${b.name}</option>`,
            ).join('')}</select>
          </label>
          <label class="slider-row"><span>토핑 1</span><select data-top="0">${toppingOptions(pick.toppings[0])}</select></label>
          <label class="slider-row"><span>토핑 2</span><select data-top="1">${toppingOptions(pick.toppings[1])}</select></label>
          <label class="slider-row"><span>반죽 거칠기 <b data-rv>${pick.roughness.toFixed(2)}</b></span>
            <input type="range" min="0" max="1" step="0.05" value="${pick.roughness}" data-rough /></label>
          <label class="slider-row"><span>굽기 정도 <b data-bv>${pick.browning.toFixed(2)}</b></span>
            <input type="range" min="0" max="1.6" step="0.05" value="${pick.browning}" data-brown /></label>
          <div class="dev-row">
            <button class="btn dev-btn" data-go="kneading">반죽</button>
            <button class="btn dev-btn" data-go="forming">모양 빚기</button>
            <button class="btn dev-btn" data-go="mold">틀·트레이</button>
            <button class="btn dev-btn" data-go="shaping">토핑</button>
            <button class="btn dev-btn" data-go="baking">굽기 시작</button>
            <button class="btn dev-btn" data-go="finish">꺼내기</button>
          </div>
        </section>

        <section>
          <h3>굽는 중 ${bake ? `— ${getBread(bake.breadId).emoji} ${getBread(bake.breadId).name}` : ''}</h3>
          ${
            bake
              ? `<div class="dev-row">${[0, 0.5, 0.99, 1, 1.5]
                  .map((p) => `<button class="btn dev-btn" data-progress="${p}">${Math.round(p * 100)}%</button>`)
                  .join('')}</div>`
              : '<p class="sheet-hint">굽고 있는 빵이 없어요</p>'
          }
        </section>

        <section>
          <h3>도감</h3>
          <div class="dev-row">
            <button class="btn dev-btn" data-album="fill">빵 × 토핑 0·1개 채우기</button>
            <button class="btn dev-btn" data-album="add1">무작위 +1</button>
            <button class="btn dev-btn" data-album="add5">무작위 +5</button>
            <button class="btn dev-btn" data-album="clear">비우기</button>
            <button class="btn dev-btn" data-album="new">전부 새 항목</button>
            <button class="btn dev-btn" data-album="seen">전부 확인함</button>
            <button class="btn dev-btn" data-album="legacy">옛 저장본 넣기</button>
          </div>
        </section>

        <section>
          <h3>표시 · 기기</h3>
          <label class="slider-row"><span>FPS 표시</span><input type="checkbox" data-opt="showFps" ${o.showFps ? 'checked' : ''} /></label>
          <div class="dev-row">
            <button class="btn dev-btn" data-dev="bench">품질 벤치 초기화</button>
            <button class="btn dev-btn" data-dev="ding">딩 소리</button>
            <button class="btn dev-btn" data-dev="haptic">햅틱</button>
            <button class="btn dev-btn" data-dev="notify">5초 뒤 알림</button>
          </div>
        </section>

        <section>
          <h3>데이터</h3>
          <div class="dev-row">
            <button class="btn dev-btn" data-dev="json">저장 데이터 보기</button>
            <button class="btn dev-btn" data-dev="reset">테스트 슬롯 초기화</button>
            <button class="btn dev-btn" data-dev="off">개발자 모드 끄기</button>
          </div>
          <pre class="dev-json" data-json hidden></pre>
        </section>

        <button class="btn btn-primary" data-close>닫기</button>
      </div>
    </div>
  `);

  const $ = <T extends HTMLElement>(sel: string) => sheet.querySelector<T>(sel)!;
  const status = $('[data-status]');
  const say = (msg: string) => (status.textContent = msg);
  const close = () => sheet.remove();

  // ---- 진행 ----
  for (const box of sheet.querySelectorAll<HTMLInputElement>('[data-opt]')) {
    box.addEventListener('change', async () => {
      const k = box.dataset.opt as keyof Pick<DevOptions, 'unlockAll' | 'skipKnead' | 'showFps'>;
      o[k] = box.checked;
      await persistDev();
      ctx.refresh();
      say(`${box.parentElement!.querySelector('span')!.textContent} ${box.checked ? '켬' : '끔'}`);
    });
  }
  const divSel = $<HTMLSelectElement>('[data-div]');
  divSel.value = String(o.timeDivisor);
  divSel.addEventListener('change', async () => {
    o.timeDivisor = Number(divSel.value);
    await persistDev();
    ctx.refresh();
    say(`굽기 시간 ×1/${o.timeDivisor}`);
  });

  // ---- 바로가기 ----
  const breadSel = $<HTMLSelectElement>('[data-bread]');
  // 모양 빚기는 덩어리 반죽 빵만
  const formBtn = $<HTMLButtonElement>('[data-go="forming"]');
  const syncForm = () => (formBtn.disabled = !formStepsOf(getBread(pick.breadId)));
  syncForm();
  breadSel.addEventListener('change', () => {
    pick.breadId = breadSel.value as BreadId;
    syncForm();
  });
  for (const sel of sheet.querySelectorAll<HTMLSelectElement>('[data-top]')) {
    sel.addEventListener('change', () => {
      pick.toppings[Number(sel.dataset.top)] = sel.value as ToppingId | '';
    });
  }
  const rough = $<HTMLInputElement>('[data-rough]');
  rough.addEventListener('input', () => {
    pick.roughness = Number(rough.value);
    $('[data-rv]').textContent = pick.roughness.toFixed(2);
  });
  const brown = $<HTMLInputElement>('[data-brown]');
  brown.addEventListener('input', () => {
    pick.browning = Number(brown.value);
    $('[data-bv]').textContent = pick.browning.toFixed(2);
  });

  for (const btn of sheet.querySelectorAll<HTMLButtonElement>('[data-go]')) {
    btn.addEventListener('click', async () => {
      const def = getBread(pick.breadId);
      const toppingIds = canonicalToppings(pick.toppings.filter((t): t is ToppingId => t !== ''));
      const base = { breadId: def.id, roughness: pick.roughness };
      const flow = { ...base, toppingIds, seed: Math.random() * 100 };
      close();
      switch (btn.dataset.go) {
        case 'kneading':
          ctx.go('kneading', { breadId: def.id, toppingIds, seed: flow.seed });
          break;
        case 'forming':
          ctx.go('forming', flow);
          break;
        case 'mold':
          ctx.go('mold', flow);
          break;
        case 'shaping':
          ctx.go('shaping', flow);
          break;
        case 'baking':
          save.activeBake = {
            ...base,
            toppingIds,
            seed: Math.random() * 100,
            startedAt: Date.now(),
            durationMs: bakeDurationMs(def, save.settings.speed),
          };
          await persist();
          ctx.go('baking');
          break;
        case 'finish':
          ctx.go('finish', { ...base, toppingIds, browning: pick.browning, seed: Math.random() * 100 });
          break;
      }
    });
  }

  // ---- 굽는 중: 진행도 점프 — startedAt을 당긴다 (wall-clock 불변식 유지) ----
  for (const btn of sheet.querySelectorAll<HTMLButtonElement>('[data-progress]')) {
    btn.addEventListener('click', async () => {
      const b = getSave().activeBake;
      if (!b) return;
      b.startedAt = Date.now() - Number(btn.dataset.progress) * b.durationMs;
      await persist();
      say(`진행도 ${btn.textContent}`);
    });
  }

  // ---- 도감 ----
  const combos = () =>
    BREADS.flatMap((b) => allToppingSets().map((t) => ({ breadId: b.id, toppingIds: t })));
  const missing = () => {
    const have = new Set(getSave().album.map((r) => r.id));
    return combos().filter((c) => !have.has(albumKey(c.breadId, c.toppingIds)));
  };
  const addRandom = async (n: number) => {
    const pool = missing();
    for (let i = 0; i < n && pool.length; i++) {
      const [c] = pool.splice(Math.floor(Math.random() * pool.length), 1);
      await upsertRecord(randomRecord(c.breadId, c.toppingIds));
    }
  };
  for (const btn of sheet.querySelectorAll<HTMLButtonElement>('[data-album]')) {
    btn.addEventListener('click', async () => {
      const album = getSave().album;
      switch (btn.dataset.album) {
        case 'fill':
          // 토핑 두 개 조합까지 다 채우면 7,000칸이 넘어 도감 화면이 버거우므로 토핑 0·1개까지만.
          // 대량이라 upsertRecord(칸마다 저장) 대신 같은 키 규칙으로 한 번에 넣고 한 번 저장한다
          for (const c of missing().filter((m) => m.toppingIds.length <= 1)) {
            album.push({
              ...randomRecord(c.breadId, c.toppingIds),
              id: albumKey(c.breadId, c.toppingIds),
              isNew: false,
            });
          }
          await persist();
          break;
        case 'add1':
          await addRandom(1);
          break;
        case 'add5':
          await addRandom(5);
          break;
        case 'clear':
          album.length = 0;
          await persist();
          break;
        case 'new':
        case 'seen':
          for (const r of album) r.isNew = btn.dataset.album === 'new';
          await persist();
          break;
        case 'legacy':
          // 토핑이 없거나 하나뿐이던 시절의 모양 — 같은 조합이 중복돼 있고 settings.speed도 없다
          await writeRawSave({
            settings: { volHum: 0.7, volCrackle: 0.8, volDing: 0.9, quality: 'auto' },
            album: [
              { id: '1-1', breadId: 'shokupan', browning: 0.8, seed: 12, roughness: 0.2, finishedAt: 1000 },
              { id: '2-2', breadId: 'shokupan', browning: 1.3, seed: 34, roughness: 0.5, finishedAt: 9000 },
              { id: '3-3', breadId: 'cookie', toppingId: 'choco', browning: 0.9, seed: 56, roughness: 0.3, finishedAt: 5000 },
              { id: '4-4', breadId: 'cookie', toppingId: 'none', browning: 0.6, seed: 78, roughness: 0.4, finishedAt: 7000 },
            ],
            activeBake: null,
            benchTier: null,
          });
          location.reload();
          return;
      }
      say(`도감 ${getSave().album.length}칸 / 전체 ${combos().length}조합`);
      ctx.refresh();
    });
  }

  // ---- 표시 · 기기 · 데이터 ----
  for (const btn of sheet.querySelectorAll<HTMLButtonElement>('[data-dev]')) {
    btn.addEventListener('click', async () => {
      switch (btn.dataset.dev) {
        case 'bench':
          save.benchTier = null;
          save.settings.quality = 'auto';
          await persist();
          say('다음 굽기에서 품질을 다시 재요');
          break;
        case 'ding':
          audio.ensure();
          audio.ding();
          break;
        case 'haptic':
          void hapticThud();
          say(isNative ? '햅틱' : '웹에선 햅틱이 없어요');
          break;
        case 'notify':
          if (!isNative) {
            say('알림은 네이티브 앱에서만 떠요');
            break;
          }
          await scheduleBakeDoneNotification(Date.now() + 5000, '테스트 빵');
          say('5초 뒤에 알림이 떠요');
          break;
        case 'json': {
          const pre = $('[data-json]');
          pre.textContent = JSON.stringify(getSave(), null, 2);
          pre.hidden = !pre.hidden;
          break;
        }
        case 'reset':
          confirmSheet(
            '테스트 저장 슬롯을 비울까요?<br/>실제 진행 기록은 그대로예요',
            async () => {
              await clearSave();
              location.reload();
            },
            { ok: '비우기', cancel: '취소' },
          );
          break;
        case 'off':
          void switchDevMode(false);
          break;
      }
    });
  }

  $('[data-close]').addEventListener('click', close);
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  document.body.appendChild(sheet);
}
