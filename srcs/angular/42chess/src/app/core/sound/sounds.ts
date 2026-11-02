import { isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { Preferences } from '../preferences/preferences';

export type SoundName = 'move' | 'capture' | 'check' | 'end' | 'notify';

/** Notes of each sound: frequency (Hz), start and length (s), and wave shape. */
const SOUNDS: Record<
  SoundName,
  { frequency: number; at: number; length: number; wave: OscillatorType }[]
> = {
  move: [{ frequency: 520, at: 0, length: 0.07, wave: 'triangle' }],
  capture: [
    { frequency: 300, at: 0, length: 0.06, wave: 'square' },
    { frequency: 220, at: 0.05, length: 0.09, wave: 'triangle' },
  ],
  check: [
    { frequency: 660, at: 0, length: 0.09, wave: 'triangle' },
    { frequency: 880, at: 0.1, length: 0.12, wave: 'triangle' },
  ],
  end: [
    { frequency: 523, at: 0, length: 0.16, wave: 'sine' },
    { frequency: 659, at: 0.14, length: 0.16, wave: 'sine' },
    { frequency: 784, at: 0.28, length: 0.32, wave: 'sine' },
  ],
  notify: [
    { frequency: 880, at: 0, length: 0.08, wave: 'sine' },
    { frequency: 1175, at: 0.09, length: 0.12, wave: 'sine' },
  ],
};

/** The sound for a move, from its notation: a capture, a check, or a plain move. */
export function moveSound(notation: string | null): SoundName {
  if (notation && /[+#]$/.test(notation)) return 'check';
  return notation?.includes('x') ? 'capture' : 'move';
}

/**
 * Short synthesized sounds for moves, captures, checks and the end of a game; silent when the
 * player turned sound off. No audio file to download, and nothing plays before the player has
 * interacted with the page (the browser's rule).
 */
@Injectable({ providedIn: 'root' })
export class Sounds {
  private readonly preferences = inject(Preferences);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private context: AudioContext | null = null;

  play(name: SoundName): void {
    if (!this.browser || !this.preferences.soundEnabled()) return;
    const context = this.audio();
    if (!context) return;
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
    const start = context.currentTime + 0.01;
    for (const note of SOUNDS[name]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = note.wave;
      oscillator.frequency.value = note.frequency;
      gain.gain.setValueAtTime(0.0001, start + note.at);
      gain.gain.exponentialRampToValueAtTime(0.12, start + note.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.length);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + note.at);
      oscillator.stop(start + note.at + note.length + 0.02);
    }
  }

  private audio(): AudioContext | null {
    if (this.context) return this.context;
    const Context = globalThis.AudioContext as typeof AudioContext | undefined;
    if (!Context) return null;
    try {
      this.context = new Context();
    } catch {
      return null;
    }
    return this.context;
  }
}
