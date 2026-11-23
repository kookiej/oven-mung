// 절차적 Web Audio 엔진 — 에셋 파일 없이 전부 합성.
// 레이어: 오븐 훅(hum) / 타닥거림(crackle) / 완료 딩(ding), 각각 개별 볼륨.
import type { Settings } from '../types';
import { clamp } from '../util';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private humGain!: GainNode;
  private crackleGain!: GainNode;
  private dingGain!: GainNode;
  private popBuffer!: AudioBuffer;
  private crackleTimer: number | null = null;
  private nextPopTime = 0;
  private ambientOn = false;

  /** 갈변 정도 0~1.6 — 높을수록 타닥거림이 잦아진다 */
  browningLevel = 0;

  private volumes = { hum: 0.7, crackle: 0.8, ding: 0.9 };

  /** 사용자 제스처 이후에 호출해야 함 (autoplay 정책) */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    this.humGain = ctx.createGain();
    this.crackleGain = ctx.createGain();
    this.dingGain = ctx.createGain();
    this.humGain.connect(this.master);
    this.crackleGain.connect(this.master);
    this.dingGain.connect(this.master);
    this.applyVolumes();

    this.popBuffer = this.makeNoiseBuffer(0.06);
    this.buildHum();
    if (this.ambientOn) this.startCrackleScheduler();
  }

  setVolumes(s: Pick<Settings, 'volHum' | 'volCrackle' | 'volDing'>): void {
    this.volumes = { hum: s.volHum, crackle: s.volCrackle, ding: s.volDing };
    if (this.ctx) this.applyVolumes();
  }

  private applyVolumes(): void {
    // 제곱으로 매핑해서 슬라이더가 청감상 선형에 가깝게
    const v = this.volumes;
    this.humGain.gain.value = v.hum * v.hum * (this.ambientOn ? 1 : 0);
    this.crackleGain.gain.value = v.crackle * v.crackle;
    this.dingGain.gain.value = v.ding * v.ding;
  }

  /** 굽기 화면 진입 시 켜고, 나갈 때 끈다 */
  setAmbient(on: boolean): void {
    this.ambientOn = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const target = on ? this.volumes.hum * this.volumes.hum : 0.0001;
    this.humGain.gain.cancelScheduledValues(t);
    this.humGain.gain.setValueAtTime(Math.max(this.humGain.gain.value, 0.0001), t);
    this.humGain.gain.exponentialRampToValueAtTime(Math.max(target, 0.0001), t + 0.8);
    if (on) this.startCrackleScheduler();
    else this.stopCrackleScheduler();
  }

  /** 굽기 완료 벨 — 부드러운 배음 합성 */
  ding(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + 0.02;
    const partials: Array<[number, number, number]> = [
      // [주파수 배율, 크기, 감쇠 시간]
      [1.0, 0.5, 2.2],
      [2.42, 0.22, 1.5],
      [3.83, 0.1, 0.9],
    ];
    const base = 784; // G5 근처, 주방 타이머 느낌
    for (const [mult, amp, decay] of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = base * mult;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(amp, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      osc.connect(g);
      g.connect(this.dingGain);
      osc.start(t0);
      osc.stop(t0 + decay + 0.1);
    }
  }

  // ---- 오븐 훅: 브라운 노이즈 루프 + 저음 사인 ----
  private buildHum(): void {
    const ctx = this.ctx!;
    // 브라운 노이즈 (적분된 화이트 노이즈) 4초 루프
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    // 루프 경계 클릭 제거: 양 끝 크로스페이드
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      data[i] = data[i] * t + data[len - fade + i] * (1 - t) * t;
      data[len - 1 - i] *= i / fade;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    lp.Q.value = 0.5;
    src.connect(lp);
    lp.connect(this.humGain);
    src.start();

    // 팬/모터 저음
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 58;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.06;
    osc.connect(oscGain);
    oscGain.connect(this.humGain);
    osc.start();

    // 아주 느린 숨쉬는 듯한 변조
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain);
    lfoGain.connect(oscGain.gain);
    lfo.start();
  }

  // ---- 타닥거림: 랜덤 스케줄 노이즈 버스트 ----
  private makeNoiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  private startCrackleScheduler(): void {
    if (this.crackleTimer !== null || !this.ctx) return;
    this.nextPopTime = this.ctx.currentTime + 1;
    this.crackleTimer = window.setInterval(() => this.scheduleCrackles(), 180);
  }

  private stopCrackleScheduler(): void {
    if (this.crackleTimer !== null) {
      clearInterval(this.crackleTimer);
      this.crackleTimer = null;
    }
  }

  private scheduleCrackles(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // 갈변이 진행될수록 타닥거림이 잦아진다 (0.25 → ~5 pops/sec)
    const rate = 0.25 + clamp(this.browningLevel, 0, 1.6) * 3;
    const horizon = ctx.currentTime + 0.6;
    while (this.nextPopTime < horizon) {
      this.schedulePop(Math.max(this.nextPopTime, ctx.currentTime + 0.01));
      // 지수 분포 간격 → 자연스러운 랜덤 타이밍
      this.nextPopTime += -Math.log(1 - Math.random()) / rate;
    }
  }

  private schedulePop(at: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.popBuffer;
    src.playbackRate.value = 0.7 + Math.random() * 0.9;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200 + Math.random() * 2800;
    bp.Q.value = 1.2;

    const g = ctx.createGain();
    const amp = 0.12 + Math.random() * 0.25;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(amp, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03 + Math.random() * 0.05);

    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.6;

    src.connect(bp);
    bp.connect(g);
    g.connect(pan);
    pan.connect(this.crackleGain);
    src.start(at);
    src.stop(at + 0.12);
  }
}

export const audio = new AudioEngine();
