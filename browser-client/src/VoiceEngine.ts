// VoiceEngine.ts — Web Speech API + Whisper fallback + "jarvis" wake-word gate
// Part of JARVIS Phase 2

import type { SpeechRecognition, SpeechRecognitionEvent, SpeechRecognitionErrorEvent } from './speech-recognition';


const WAKE_WORD = "jarvis";
const SILENCE_TIMEOUT_MS = 4000;
const BACKEND_HOST = window.location.hostname || "localhost";
const BACKEND_URL = `http://${BACKEND_HOST}:8000`;
const WHISPER_CHUNK_MS = 3000;

/** Strip the wake word and common filler prefixes from transcript text. */
function stripWakeWord(text: string): string {
  return text
    .replace(/\bjarvis\b[\s,]*/gi, "")
    .replace(/^\s*(please|can you|could you)\s+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export type VoiceEngineState = "idle" | "listening" | "awake" | "recording";

export type VoiceEngineEvent =
  | { type: "wakeWordDetected" }
  | { type: "transcript"; text: string; isFinal: boolean }
  | { type: "commandReady"; text: string }
  | { type: "stateChange"; state: VoiceEngineState }
  | { type: "error"; error: Error };

type EventHandler = (event: VoiceEngineEvent) => void;

export class VoiceEngine {
  private state: VoiceEngineState = "idle";
  private recognition: SpeechRecognition | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private commandBuffer = "";
  private listeners: EventHandler[] = [];
  private usingWhisper = false;
  private networkErrorCount = 0;
  private static readonly MAX_NETWORK_ERRORS = 5;

  // Whisper-mode audio capture
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private whisperAwake = false;
  private whisperCommandChunks: Blob[] = [];
  private whisperPollChunks: Blob[] = [];
  private whisperPollTimer: ReturnType<typeof setInterval> | null = null;

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to VoiceEngine events. Returns an unsubscribe function.
   */
  on(handler: EventHandler): () => void {
    this.listeners.push(handler);
    return () => {
      this.listeners = this.listeners.filter((h) => h !== handler);
    };
  }

  /** Start voice recognition. Picks Web Speech API or Whisper automatically. */
  async start(): Promise<void> {
    if (this.state !== "idle") return;

    if (this.isWebSpeechAvailable()) {
      this.usingWhisper = false;
      this.startWebSpeech();
    } else {
      this.usingWhisper = true;
      await this.startWhisper();
    }
  }

  /** Stop all recognition and reset to idle. */
  stop(): void {
    this.clearSilenceTimer();
    this.clearWhisperPollTimer();
    this.stopWebSpeech();
    this.stopWhisper();
    this.commandBuffer = "";
    this.whisperAwake = false;
    this.whisperCommandChunks = [];
    this.whisperPollChunks = [];
    this.setState("idle");
  }

  getState(): VoiceEngineState {
    return this.state;
  }

  isUsingWhisper(): boolean {
    return this.usingWhisper;
  }

  // ─── Web Speech API path ─────────────────────────────────────────────────

  private isWebSpeechAvailable(): boolean {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  private startWebSpeech(): void {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    this.recognition = new SR();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = "en-US";

    this.recognition.addEventListener("result", (event: SpeechRecognitionEvent) => {
      this.handleWebSpeechResult(event);
    });

    this.recognition.addEventListener("error", (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        console.warn("[VoiceEngine] Web Speech API not allowed, falling back to Whisper");
        this.stopWebSpeech();
        this.usingWhisper = true;
        this.startWhisper().catch((err) => {
          this.emit({ type: "error", error: err instanceof Error ? err : new Error(String(err)) });
          this.setState("idle");
        });
      } else if (event.error === "network") {
        this.networkErrorCount++;
        if (this.networkErrorCount >= VoiceEngine.MAX_NETWORK_ERRORS) {
          console.warn(
            `[VoiceEngine] ${this.networkErrorCount} consecutive network errors — falling back to Whisper`
          );
          this.stopWebSpeech();
          this.usingWhisper = true;
          this.networkErrorCount = 0;
          this.startWhisper().catch((err) => {
            this.emit({ type: "error", error: err instanceof Error ? err : new Error(String(err)) });
            this.setState("idle");
          });
        } else {
          console.warn(
            `[VoiceEngine] Network error (${this.networkErrorCount}/${VoiceEngine.MAX_NETWORK_ERRORS}) — will retry on 'end' event`
          );
        }
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        console.error("[VoiceEngine] Recognition error:", event.error);
        this.emit({ type: "error", error: new Error(`Speech recognition error: ${event.error}`) });
      }
    });

    this.recognition.addEventListener("end", () => {
      // Auto-restart unless we've been stopped or switched to Whisper
      if (this.state !== "idle" && !this.usingWhisper) {
        try {
          this.recognition?.start();
        } catch (err) {
          console.error("[VoiceEngine] Failed to restart recognition:", err);
        }
      }
    });

    this.recognition.start();
    this.setState("listening");
    console.log("[VoiceEngine] Started with Web Speech API, listening for wake word:", WAKE_WORD);
  }

  private stopWebSpeech(): void {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore errors on stop
      }
      this.recognition = null;
    }
  }

  private handleWebSpeechResult(event: SpeechRecognitionEvent): void {
    this.networkErrorCount = 0;
    let finalTranscript = "";
    let interimTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript;
      if (result.isFinal) {
        finalTranscript += text;
      } else {
        interimTranscript += text;
      }
    }

    const fullText = (finalTranscript || interimTranscript).toLowerCase();

    if (finalTranscript) {
      const cleaned = stripWakeWord(finalTranscript);
      if (cleaned) {
        this.emit({ type: "transcript", text: cleaned, isFinal: true });
      }
    } else if (interimTranscript) {
      const cleaned = stripWakeWord(interimTranscript);
      if (cleaned) {
        this.emit({ type: "transcript", text: cleaned, isFinal: false });
      }
    }

    if (this.state === "listening") {
      if (fullText.includes(WAKE_WORD)) {
        this.setState("awake");
        this.commandBuffer = "";
        this.emit({ type: "wakeWordDetected" });
        console.log("[VoiceEngine] Wake word detected");

        // Capture text that immediately follows the wake word
        if (finalTranscript) {
          const idx = finalTranscript.toLowerCase().indexOf(WAKE_WORD);
          const afterWake = finalTranscript.slice(idx + WAKE_WORD.length).trim();
          if (afterWake) {
            this.commandBuffer = afterWake;
            this.setState("recording");
            this.resetSilenceTimer();
          }
        }
      }
    } else if (this.state === "awake" || this.state === "recording") {
      if (finalTranscript) {
        const trimmed = finalTranscript.trim();
        this.commandBuffer += (this.commandBuffer ? " " : "") + trimmed;
        this.setState("recording");
        console.log("[VoiceEngine] Command buffer:", this.commandBuffer);

        if (trimmed.toLowerCase() === "done" || trimmed.toLowerCase().endsWith(" done")) {
          this.flushCommand();
        } else {
          this.resetSilenceTimer();
        }
      }
    }
  }

  // ─── Whisper fallback path ───────────────────────────────────────────────

  private async startWhisper(): Promise<void> {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    this.mediaRecorder = new MediaRecorder(this.mediaStream);

    this.mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        if (this.whisperAwake) {
          this.whisperCommandChunks.push(event.data);
        } else {
          this.whisperPollChunks.push(event.data);
        }
      }
    });

    // Collect audio in short chunks for wake-word polling
    this.mediaRecorder.start(WHISPER_CHUNK_MS);

    // Poll transcriptions for the wake word
    this.whisperPollTimer = setInterval(() => {
      void this.pollWhisperForWakeWord();
    }, WHISPER_CHUNK_MS + 200);

    this.setState("listening");
    console.log("[VoiceEngine] Started with Whisper fallback, polling for wake word:", WAKE_WORD);
  }

  private stopWhisper(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
    this.mediaRecorder = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
  }

  private async pollWhisperForWakeWord(): Promise<void> {
    if (this.whisperAwake || this.state === "idle") return;

    const chunks = this.whisperPollChunks.splice(0);
    if (chunks.length === 0) return;

    const audioBlob = new Blob(chunks, { type: chunks[0].type });
    const transcript = await this.transcribeBlob(audioBlob);
    if (!transcript) return;

    const cleanedPoll = stripWakeWord(transcript);
    if (cleanedPoll) {
      this.emit({ type: "transcript", text: cleanedPoll, isFinal: true });
    }
    console.log("[VoiceEngine] Whisper poll transcript:", transcript);

    if (transcript.toLowerCase().includes(WAKE_WORD)) {
      this.whisperAwake = true;
      this.whisperCommandChunks = [];
      this.clearWhisperPollTimer();
      this.setState("awake");
      this.emit({ type: "wakeWordDetected" });
      console.log("[VoiceEngine] Wake word detected via Whisper");
      this.resetSilenceTimer();
    }
  }

  private async flushWhisperCommand(): Promise<void> {
    const chunks = this.whisperCommandChunks.splice(0);
    this.whisperAwake = false;

    if (chunks.length === 0) {
      this.setState("listening");
      this.restartWhisperPolling();
      return;
    }

    const audioBlob = new Blob(chunks, { type: chunks[0].type });
    const transcript = await this.transcribeBlob(audioBlob);

    if (transcript) {
      const cleanedWhisper = stripWakeWord(transcript);
      if (cleanedWhisper) {
        this.emit({ type: "transcript", text: cleanedWhisper, isFinal: true });
      }
      this.commandBuffer = stripWakeWord(transcript);
      console.log("[VoiceEngine] Whisper command:", this.commandBuffer);
    }

    this.flushCommand();
    this.restartWhisperPolling();
  }

  private restartWhisperPolling(): void {
    this.whisperPollChunks = [];
    this.whisperPollTimer = setInterval(() => {
      void this.pollWhisperForWakeWord();
    }, WHISPER_CHUNK_MS + 200);
  }

  private async transcribeBlob(blob: Blob): Promise<string> {
    try {
      const formData = new FormData();
      formData.append("file", blob, "audio.webm");

      const res = await fetch(`${BACKEND_URL}/voice/transcribe`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        console.error("[VoiceEngine] Transcription request failed:", res.status);
        return "";
      }

      const data = (await res.json()) as { text?: string };
      return data.text?.trim() ?? "";
    } catch (err) {
      console.error("[VoiceEngine] Transcription error:", err);
      return "";
    }
  }

  // ─── Shared helpers ────────────────────────────────────────────────────────

  private clearSilenceTimer(): void {
    if (this.silenceTimer !== null) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private clearWhisperPollTimer(): void {
    if (this.whisperPollTimer !== null) {
      clearInterval(this.whisperPollTimer);
      this.whisperPollTimer = null;
    }
  }

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    this.silenceTimer = setTimeout(() => {
      if (this.usingWhisper) {
        this.clearWhisperPollTimer();
        void this.flushWhisperCommand();
      } else {
        this.flushCommand();
      }
    }, SILENCE_TIMEOUT_MS);
  }

  private flushCommand(): void {
    this.clearSilenceTimer();
    const text = stripWakeWord(this.commandBuffer);
    this.commandBuffer = "";
    this.setState("listening");

    if (text) {
      console.log("[VoiceEngine] Command ready:", text);
      this.emit({ type: "commandReady", text });
    }
  }

  private setState(state: VoiceEngineState): void {
    if (this.state !== state) {
      this.state = state;
      this.emit({ type: "stateChange", state });
    }
  }

  private emit(event: VoiceEngineEvent): void {
    for (const handler of this.listeners) {
      try {
        handler(event);
      } catch (err) {
        console.error("[VoiceEngine] Event handler error:", err);
      }
    }
  }
}
