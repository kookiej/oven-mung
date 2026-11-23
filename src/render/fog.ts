// 오븐 창 김서림 오버레이.
// 저해상도 오프스크린 캔버스에 김 농도를 그리고, 화면 캔버스에 블러로 확대 합성.
// 탭 → 입김 자국, 드래그 → 닦기, 시간이 지나면 천천히 다시 서림.
export class FogLayer {
  private density: HTMLCanvasElement;
  private dctx: CanvasRenderingContext2D;
  private view: HTMLCanvasElement;
  private vctx: CanvasRenderingContext2D;
  private refogAccum = 0;

  constructor(viewCanvas: HTMLCanvasElement) {
    this.view = viewCanvas;
    this.vctx = viewCanvas.getContext('2d')!;
    this.density = document.createElement('canvas');
    this.density.width = 220;
    this.density.height = 280;
    this.dctx = this.density.getContext('2d')!;
    // 시작할 때 은은하게 서려 있어야 닦는 재미가 바로 있다.
    // 가운데는 맑고 가장자리로 갈수록 뿌옇게 — 실제 결로처럼.
    const w = this.density.width;
    const h = this.density.height;
    const grad = this.dctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.2,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.75,
    );
    grad.addColorStop(0, 'rgba(255,255,255,0.04)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.16)');
    grad.addColorStop(1, 'rgba(255,255,255,0.42)');
    this.dctx.fillStyle = grad;
    this.dctx.fillRect(0, 0, w, h);
  }

  private toDensityCoords(clientX: number, clientY: number): [number, number] {
    const rect = this.view.getBoundingClientRect();
    return [
      ((clientX - rect.left) / rect.width) * this.density.width,
      ((clientY - rect.top) / rect.height) * this.density.height,
    ];
  }

  /** 탭 — 입김 자국 */
  tapAt(clientX: number, clientY: number): void {
    const [x, y] = this.toDensityCoords(clientX, clientY);
    const r = 34;
    const grad = this.dctx.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.28)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    this.dctx.fillStyle = grad;
    this.dctx.beginPath();
    this.dctx.arc(x, y, r, 0, Math.PI * 2);
    this.dctx.fill();
  }

  /** 드래그 — 손가락으로 닦기 */
  wipe(fromX: number, fromY: number, toX: number, toY: number): void {
    const [x1, y1] = this.toDensityCoords(fromX, fromY);
    const [x2, y2] = this.toDensityCoords(toX, toY);
    this.dctx.save();
    this.dctx.globalCompositeOperation = 'destination-out';
    this.dctx.strokeStyle = 'rgba(0,0,0,0.85)';
    this.dctx.lineWidth = 30;
    this.dctx.lineCap = 'round';
    this.dctx.beginPath();
    this.dctx.moveTo(x1, y1);
    this.dctx.lineTo(x2, y2);
    this.dctx.stroke();
    this.dctx.restore();
  }

  /** 매 프레임 — 천천히 다시 서림 + 화면에 그리기 */
  tick(dtSec: number): void {
    this.refogAccum += dtSec;
    if (this.refogAccum > 0.5) {
      this.refogAccum = 0;
      this.dctx.fillStyle = 'rgba(255,255,255,0.006)';
      this.dctx.fillRect(0, 0, this.density.width, this.density.height);
    }

    const w = this.view.clientWidth;
    const h = this.view.clientHeight;
    if (this.view.width !== w || this.view.height !== h) {
      this.view.width = w;
      this.view.height = h;
    }
    this.vctx.clearRect(0, 0, w, h);
    this.vctx.save();
    this.vctx.filter = 'blur(5px)';
    this.vctx.globalAlpha = 0.62;
    this.vctx.drawImage(this.density, 0, 0, w, h);
    this.vctx.restore();
  }
}
