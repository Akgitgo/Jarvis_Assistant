// VoiceTyper.ts — Voice-to-Text auto-typing module for JARVIS
// Triggered by PINCH gesture from GestureEngine
// Copies transcript to clipboard and sends voice_paste to backend for Ctrl+V into active app

import { socket } from './socket';
import type { SpeechRecognition, SpeechRecognitionEvent, SpeechRecognitionErrorEvent } from './speech-recognition';

/** Strip the wake word and common filler prefixes from transcript text. */
function stripWakeWord(text: string): string {
  return text
    .replace(/\bjarvis\b[\s,]*/gi, "")
    .replace(/^\s*(please|can you|could you)\s+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type TranscriptCallback = (transcript: string) => void;

export class VoiceTyper {
  private recognition: SpeechRecognition | null = null;
  private listening = false;
  private transcriptCallbacks: TranscriptCallback[] = [];
  private indicatorEl: HTMLDivElement | null = null;

  /**
   * Start listening for speech. Opens the mic using Web Speech API
   * and types the transcript into the active element on completion.
   */
  startListening(): void {
    if (this.listening) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      console.error("[VoiceTyper] Web Speech API not available");
      return;
    }

    this.recognition = new SR();
    this.recognition.continuous = false;
    this.recognition.interimResults = false;
    this.recognition.lang = "en-US";

    this.recognition.addEventListener("result", (event: SpeechRecognitionEvent) => {
      const result = event.results[0];
      if (result && result.isFinal) {
        const raw = result[0].transcript;
        const transcript = stripWakeWord(raw);
        console.log("[VoiceTyper] Transcript received:", raw, "→ cleaned:", transcript);
        if (transcript.length > 0) {
          this.pasteViaClipboard(transcript);
          this.notifyTranscript(transcript);
        }
      }
    });

    this.recognition.addEventListener("error", (event: SpeechRecognitionErrorEvent) => {
      console.error("[VoiceTyper] Recognition error:", event.error);
      this.cleanUp();
    });

    this.recognition.addEventListener("end", () => {
      console.log("[VoiceTyper] Recognition ended (silence or completion)");
      this.cleanUp();
    });

    try {
      this.recognition.start();
      this.listening = true;
      this.showIndicator();
      console.log("[VoiceTyper] Listening started");
    } catch (err) {
      console.error("[VoiceTyper] Failed to start recognition:", err);
      this.cleanUp();
    }
  }

  /**
   * Stop listening and clean up.
   */
  stopListening(): void {
    if (!this.listening) return;

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore errors on stop
      }
    }
    this.cleanUp();
    console.log("[VoiceTyper] Listening stopped");
  }

  /**
   * Subscribe to transcript events. Returns an unsubscribe function.
   */
  onTranscript(cb: TranscriptCallback): () => void {
    this.transcriptCallbacks.push(cb);
    return () => {
      this.transcriptCallbacks = this.transcriptCallbacks.filter((c) => c !== cb);
    };
  }

  /**
   * Returns whether VoiceTyper is currently listening.
   */
  isListening(): boolean {
    return this.listening;
  }

  /**
   * Write transcript to clipboard and tell the backend to press Ctrl+V
   * so the text is pasted into whatever app is focused (Obsidian, etc.).
   */
  private pasteViaClipboard(transcript: string): void {
    console.log('Transcript ready, sending voice_paste:', transcript);
    navigator.clipboard.writeText(transcript).then(() => {
      console.log("[VoiceTyper] Transcript copied to clipboard");
      socket.emit("voice_paste", { transcript });
    }).catch((err) => {
      console.error("[VoiceTyper] Clipboard write failed:", err);
    });
  }

  private notifyTranscript(transcript: string): void {
    for (const cb of this.transcriptCallbacks) {
      try {
        cb(transcript);
      } catch (err) {
        console.error("[VoiceTyper] Transcript callback error:", err);
      }
    }
  }

  private cleanUp(): void {
    this.listening = false;
    this.recognition = null;
    this.hideIndicator();
  }

  private showIndicator(): void {
    if (this.indicatorEl) return;

    const el = document.createElement("div");
    el.id = "voice-typer-indicator";
    el.textContent = "🎙 Listening";
    el.style.cssText = [
      "position: fixed",
      "top: 16px",
      "left: 50%",
      "transform: translateX(-50%)",
      "background: rgba(239, 68, 68, 0.9)",
      "color: white",
      "padding: 8px 20px",
      "border-radius: 24px",
      "font-size: 14px",
      "font-weight: 600",
      "z-index: 99999",
      "pointer-events: none",
      "box-shadow: 0 2px 8px rgba(0,0,0,0.3)",
      "animation: voice-typer-pulse 1.5s ease-in-out infinite",
    ].join(";");

    // Add pulse animation
    if (!document.getElementById("voice-typer-style")) {
      const style = document.createElement("style");
      style.id = "voice-typer-style";
      style.textContent = `
        @keyframes voice-typer-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(el);
    this.indicatorEl = el;
  }

  private hideIndicator(): void {
    if (this.indicatorEl) {
      this.indicatorEl.remove();
      this.indicatorEl = null;
    }
  }
}

// ─── Integration Hook (for GestureEngine) ──────────────────────────────────
// To wire VoiceTyper to GestureEngine PINCH events, add this in your app setup:
//
//   import { VoiceTyper } from './VoiceTyper';
//
//   const voiceTyper = new VoiceTyper();
//   gestureEngine.onGesture((gesture) => {
//     if (gesture === 'PINCH') {
//       if (voiceTyper.isListening()) {
//         voiceTyper.stopListening();
//       } else {
//         voiceTyper.startListening();
//       }
//     }
//   });
