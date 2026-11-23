/**
 * VoiceFeedback.ts — JARVIS speech synthesis wrapper.
 *
 * Provides spoken feedback to the user using the Web Speech Synthesis API.
 * Selects a natural-sounding English voice when available, otherwise falls
 * back to the browser default.
 */

type FeedbackEvent =
  | { type: 'speaking'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; error: Error };

type FeedbackHandler = (event: FeedbackEvent) => void;

const DEFAULT_PITCH = 1.0;
const DEFAULT_RATE = 1.05;
const DEFAULT_VOLUME = 0.85;

export class VoiceFeedback {
  private listeners: FeedbackHandler[] = [];
  private selectedVoice: SpeechSynthesisVoice | null = null;
  public voiceReady = false;

  constructor() {
    this.pickVoice();
    // Voices may load asynchronously in some browsers
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.addEventListener('voiceschanged', () => {
        this.pickVoice();
      });
    }
  }

  on(handler: FeedbackHandler): () => void {
    this.listeners.push(handler);
    return () => {
      this.listeners = this.listeners.filter((h) => h !== handler);
    };
  }

  /** Speak the given text. Cancels any in-progress utterance. */
  speak(text: string): void {
    if (typeof speechSynthesis === 'undefined') {
      console.warn('[VoiceFeedback] SpeechSynthesis not available');
      return;
    }

    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = DEFAULT_PITCH;
    utterance.rate = DEFAULT_RATE;
    utterance.volume = DEFAULT_VOLUME;

    if (this.selectedVoice) {
      utterance.voice = this.selectedVoice;
    }

    utterance.onstart = () => {
      this.emit({ type: 'speaking', text });
    };

    utterance.onend = () => {
      this.emit({ type: 'done', text });
    };

    utterance.onerror = (event) => {
      if (event.error === 'canceled') return;
      this.emit({ type: 'error', error: new Error(`SpeechSynthesis error: ${event.error}`) });
    };

    speechSynthesis.speak(utterance);
  }

  /** Cancel any in-progress speech. */
  cancel(): void {
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
    }
  }

  isAvailable(): boolean {
    return typeof speechSynthesis !== 'undefined';
  }

  private pickVoice(): void {
    if (typeof speechSynthesis === 'undefined') return;

    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) return;

    // Prefer a natural English voice
    const preferred = voices.find(
      (v) => v.lang.startsWith('en') && v.name.toLowerCase().includes('natural')
    );
    const english = voices.find((v) => v.lang.startsWith('en') && v.localService);
    const fallback = voices.find((v) => v.lang.startsWith('en'));

    this.selectedVoice = preferred ?? english ?? fallback ?? null;
    this.voiceReady = true;

    if (this.selectedVoice) {
      console.log('[VoiceFeedback] Selected voice:', this.selectedVoice.name);
    }
  }

  private emit(event: FeedbackEvent): void {
    for (const handler of this.listeners) {
      try {
        handler(event);
      } catch (err) {
        console.error('[VoiceFeedback] Handler error:', err);
      }
    }
  }
}
