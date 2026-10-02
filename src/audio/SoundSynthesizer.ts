/**
 * SoundSynthesizer.ts
 * Procedural Web Audio API sound synthesizer for FPS weapons, impacts,
 * footfalls, shell casings, and hit feedback without external asset dependencies.
 */

export class SoundSynthesizer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  public isMuted: boolean = false;

  constructor() {
    // AudioContext will be initialized on first user gesture
  }

  private ensureContext(): AudioContext | null {
    if (this.isMuted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.35;
        this.masterGain.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  public setVolume(vol: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = THREE_CLAMP(vol, 0, 1);
    }
  }

  public playAssaultRifle(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    // 1. Noise transient for gunshot punch
    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.02));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(1800, now);
    noiseFilter.Q.setValueAtTime(1.5, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(1.2, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.09);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);

    // 2. Punch sub oscillator
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.08);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.9, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  public playShotgun(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    // Heavy booming low end
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.22);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(1.8, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.26);

    // Blast noise
    const bufferSize = ctx.sampleRate * 0.25;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.05));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2500, now);
    filter.frequency.linearRampToValueAtTime(600, now + 0.22);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(1.6, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.24);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);
  }

  public playSniper(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    // Deep supersonic boom
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.35);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(2.2, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.42);

    // High frequency crack
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(950, now);
    osc2.frequency.exponentialRampToValueAtTime(120, now + 0.1);

    const osc2Gain = ctx.createGain();
    osc2Gain.gain.setValueAtTime(0.8, now);
    osc2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc2.connect(osc2Gain);
    osc2Gain.connect(this.masterGain);
    osc2.start(now);
    osc2.stop(now + 0.11);
  }

  public playPlasmaFire(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(580, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.2);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1.1, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  public playExplosion(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const bufferSize = ctx.sampleRate * 0.8;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.18));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.linearRampToValueAtTime(120, now + 0.7);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(2.0, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.75);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(now);
  }

  public playHitmark(isHeadshot: boolean = false): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const freq = isHeadshot ? 2200 : 1400;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.25, now + 0.05);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(isHeadshot ? 1.0 : 0.6, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isHeadshot ? 0.09 : 0.05));

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + (isHeadshot ? 0.1 : 0.06));
  }

  public playReload(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    // Mag out click
    this.playClick(now, 600, 0.03);
    // Mag in click
    this.playClick(now + 0.45, 900, 0.04);
    // Slide rack
    this.playClick(now + 0.85, 1400, 0.05);
  }

  public playEmptyClick(): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.playClick(ctx.currentTime, 1800, 0.02);
  }

  public playFootstep(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.06);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  private playClick(time: number, freq: number, duration: number): void {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + duration + 0.01);
  }
}

function THREE_CLAMP(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export const soundSynth = new SoundSynthesizer();
