// 단계 화면의 세 겹 캔버스 — 아래부터
//   bg: Blender로 렌더한 무대 그림(볼·반죽 판·틀·트레이) — 크기가 바뀔 때만 다시 그린다
//   gl: 실시간 3D 무대(LiveStage) — 반죽·액체·조각이 움직인다. 그릇은 투명한 가림막
//   fg: 2D 덧그림 — 도구(거품기·계량컵·밀대·빵칼), 쏟아지는 가루·줄기, 토핑 이름표 따위. 손가락 입력도 여기서 받는다
// 세 캔버스가 같은 정사각형 상자(box)를 써서 그림과 3D가 맞물린다.
import { el } from '../../ui';
import { drawSprite, loadSprites, squareBox, type Box } from '../sprites';
import { LiveStage } from './liveStage';

export class StageView {
  readonly el: HTMLElement;
  readonly fg: HTMLCanvasElement;
  readonly fgCtx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private bgCtx: CanvasRenderingContext2D;
  private gl: HTMLCanvasElement;
  stage: LiveStage | null = null;
  box: Box = { x: 0, y: 0, size: 1 };
  w = 1;
  h = 1;
  private bgState = '';

  constructor(
    readonly name: string,
    private readonly cy = 0.55,
    private readonly fit = 1,
    /** 그림의 이 가로 자리(0~1)가 화면 가운데에 온다 — 크게 그릴 때(fit > 1) 보여 줄 곳을 고른다 */
    private readonly cx = 0.5,
  ) {
    this.el = el(`
      <div class="live-wrap">
        <canvas class="live-bg"></canvas>
        <canvas class="live-gl"></canvas>
        <canvas class="live-fg"></canvas>
      </div>`);
    [this.bg, this.gl, this.fg] = [...this.el.querySelectorAll('canvas')] as HTMLCanvasElement[];
    this.bgCtx = this.bg.getContext('2d')!;
    this.fgCtx = this.fg.getContext('2d')!;
  }

  get bgKey(): string {
    return `stage/${this.name}`;
  }

  /** 무대 그림과 GLB를 불러온다 */
  async load(): Promise<LiveStage> {
    void loadSprites([this.bgKey]).then(() => (this.bgState = ''));
    this.stage = await LiveStage.load(this.gl, this.name);
    this.layout();
    return this.stage;
  }

  /** 매 프레임 — 크기를 맞추고 fg를 비운 뒤 fg 컨텍스트를 돌려준다 */
  layout(): CanvasRenderingContext2D {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = this.el.clientWidth || 1;
    const h = this.el.clientHeight || 1;
    this.w = w;
    this.h = h;
    this.box = squareBox(w, h, this.fit, this.cy);
    this.box.x = w / 2 - this.box.size * this.cx;
    for (const c of [this.bg, this.fg]) {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        this.bgState = '';
      }
    }
    const state = `${w}x${h}`;
    if (this.bgState !== state) {
      this.bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.bgCtx.clearRect(0, 0, w, h);
      if (drawSprite(this.bgCtx, this.bgKey, this.box)) this.bgState = state;
    }
    this.stage?.setBox(w, h, this.box);
    this.fgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.fgCtx.clearRect(0, 0, w, h);
    return this.fgCtx;
  }

  render(): void {
    this.stage?.render();
  }

  /** 손가락 자리 (캔버스 CSS 픽셀) */
  local(e: PointerEvent): { x: number; y: number } {
    const r = this.fg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  dispose(): void {
    this.stage?.dispose();
  }
}
