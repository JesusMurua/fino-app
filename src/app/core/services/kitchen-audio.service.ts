import { Injectable } from '@angular/core';

/**
 * Plays a short "new order" beep on the KDS when a job arrives.
 *
 * Uses the Web Audio API with an oscillator (no asset dependency, no
 * download). The browser blocks `audio.play()` and `AudioContext.resume()`
 * before the first user gesture; the NotificationToggleComponent unlocks
 * the context on the user's first click via `unlock()`.
 */
@Injectable({ providedIn: 'root' })
export class KitchenAudioService {

  //#region Properties

  private audioContext: AudioContext | null = null;

  /** True after the user has interacted at least once and the context is running */
  private isUnlocked = false;

  //#endregion

  //#region Public Methods

  /**
   * Unlocks the AudioContext on a user gesture.
   * Must be called from inside a click/touch handler — typically the
   * notification permission button.
   */
  unlock(): void {
    if (this.isUnlocked) return;

    try {
      this.ensureContext();
      if (this.audioContext?.state === 'suspended') {
        void this.audioContext.resume();
      }
      this.isUnlocked = true;
    } catch {
      // Web Audio not supported — beeps will be silent, no-op
    }
  }

  /**
   * Plays a short two-tone beep ("ding") to alert the kitchen of a new order.
   * Silently no-ops if the AudioContext has not been unlocked yet.
   */
  playNewOrderBeep(): void {
    if (!this.isUnlocked) return;

    try {
      this.ensureContext();
      const ctx = this.audioContext!;
      const now = ctx.currentTime;

      // First tone — high pitch, short
      this.playTone(ctx, 880, now, 0.15);
      // Second tone — slightly lower, overlaps for a "ding-dong" feel
      this.playTone(ctx, 660, now + 0.18, 0.2);
    } catch {
      // Audio failed — never throw, KDS must keep working
    }
  }

  //#endregion

  //#region Private Helpers

  /** Lazily creates the shared AudioContext */
  private ensureContext(): void {
    if (this.audioContext) return;

    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (Ctor) {
      this.audioContext = new Ctor();
    }
  }

  /** Plays a single sine-wave tone with a quick attack/release envelope */
  private playTone(ctx: AudioContext, frequencyHz: number, startAt: number, durationSec: number): void {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequencyHz, startAt);

    // Envelope — fast attack, exponential decay (avoids clicks)
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.4, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start(startAt);
    oscillator.stop(startAt + durationSec + 0.05);
  }

  //#endregion
}
