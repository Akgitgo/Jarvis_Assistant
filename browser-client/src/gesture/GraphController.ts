/**
 * GraphController — gesture-to-OS-mouse-command dispatcher for JARVIS.
 *
 * Listens for `jarvis-gesture` custom events and raw landmark updates,
 * then emits Socket.IO `os_mouse_command` events to the Python Orchestrator,
 * which executes the actual OS-level mouse actions against Obsidian.
 *
 * The browser client is responsible only for:
 *   - calculating normalized coordinates (0–1) from MediaPipe landmarks
 *   - tracking gesture state (dragging, active)
 *   - emitting the correct action over the socket
 *
 * Gesture mapping:
 *   POINT        → os_mouse_command { action: "move", x, y }
 *   PINCH        → os_mouse_command { action: "click_left", x, y }
 *   DWELL_CLICK  → os_mouse_command { action: "click_left", x, y }
 *   FIST start   → os_mouse_command { action: "drag_start", x, y }
 *   FIST release → os_mouse_command { action: "drag_end", x, y }
 *   SWIPE_RIGHT  → os_mouse_command { action: "scroll_out", x, y }
 *   SCROLL_UP    → os_mouse_command { action: "scroll_up", x, y }
 *   SCROLL_DOWN  → os_mouse_command { action: "scroll_down", x, y }
 *   ZOOM_IN      → os_mouse_command { action: "scroll_in", x, y }
 *   ZOOM_OUT     → os_mouse_command { action: "scroll_out", x, y }
 *   OPEN_PALM    → os_mouse_command { action: "reset_view", x: 0.5, y: 0.5 }
 */

import type { GestureClass, Landmark } from '../GestureEngine';
import { socket } from '../socket';

/** EMA alpha — weight of the newest frame (higher = more responsive, lower = smoother). */
const EMA_ALPHA = 0.35;

/** Number of frames in the EMA smoothing window. */
const EMA_BUFFER_SIZE = 6;

/** Cooldown between repeated PINCH clicks (ms). */
const CLICK_COOLDOWN_MS = 400;

/** Duration to freeze cursor movement after a PINCH (ms). */
const PINCH_FREEZE_MS = 400;

/** Cooldown between repeated SWIPE_RIGHT scroll events (ms). */
const SCROLL_COOLDOWN_MS = 300;

interface CursorState {
  /** Smoothed normalized X (0–1, mirrored horizontally). */
  x: number;
  /** Smoothed normalized Y (0–1). */
  y: number;
  /** Whether cursor tracking is active (POINT mode). */
  active: boolean;
  /** Whether drag is engaged (FIST mode). */
  dragging: boolean;
}

export class GraphController {
  private cursor: CursorState = { x: 0, y: 0, active: false, dragging: false };
  private lastClickAt = 0;
  private lastScrollAt = 0;
  private gestureListener: ((e: Event) => void) | null = null;
  private started = false;

  /** EMA-smoothed coordinates (running weighted average over last N frames). */
  private emaX = 0;
  private emaY = 0;
  private emaFrameCount = 0;

  /** Timestamp until which move emissions are frozen (set on PINCH). */
  private moveFrozenUntil = 0;

  /**
   * Start listening for gesture events.
   * Call once on mount.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.gestureListener = (e: Event) => {
      const detail = (e as CustomEvent<{ gesture: GestureClass; pointerX: number; pointerY: number }>).detail;
      this.handleGesture(detail.gesture, detail.pointerX, detail.pointerY);
    };

    window.addEventListener('jarvis-gesture', this.gestureListener);
    console.log('[GraphController] Started — listening for jarvis-gesture events');
  }

  /**
   * Stop listening and release drag state.
   */
  stop(): void {
    if (this.gestureListener) {
      window.removeEventListener('jarvis-gesture', this.gestureListener);
      this.gestureListener = null;
    }
    if (this.cursor.dragging) {
      this.emitDragEnd();
    }
    this.cursor.active = false;
    this.started = false;
    console.log('[GraphController] Stopped');
  }

  /**
   * Feed raw landmarks at ~30fps for continuous cursor tracking.
   * Called from the landmark pipeline (not from gesture events).
   * Applies EMA smoothing over the last 5 frames and emits move commands
   * when in POINT mode, cursor has moved enough, and PINCH freeze is not active.
   */
  updateLandmarks(landmarks: Landmark[]): void {
    if (landmarks.length < 21) return;

    // Index fingertip = landmark 8 (already normalized 0–1)
    const tip = landmarks[8];

    // Mirror horizontally so hand movement maps naturally to screen direction
    const rawX = 1 - tip.x;
    const rawY = tip.y;

    // EMA smoothing: for the first frame, seed with raw value;
    // afterwards apply exponential moving average weighted by alpha.
    if (this.emaFrameCount < EMA_BUFFER_SIZE) {
      // Ramp alpha from 1.0 → EMA_ALPHA over the first N frames
      // so the cursor converges quickly on startup.
      this.emaFrameCount++;
      const rampAlpha = Math.max(EMA_ALPHA, 1 / this.emaFrameCount);
      this.emaX = this.emaX + rampAlpha * (rawX - this.emaX);
      this.emaY = this.emaY + rampAlpha * (rawY - this.emaY);
    } else {
      this.emaX = this.emaX + EMA_ALPHA * (rawX - this.emaX);
      this.emaY = this.emaY + EMA_ALPHA * (rawY - this.emaY);
    }

    this.cursor.x = this.emaX;
    this.cursor.y = this.emaY;

    // Freeze move emissions during PINCH to prevent micro-drags
    const now = Date.now();
    if (now < this.moveFrozenUntil) return;

    // Emit move on every frame — no threshold gate (temp debug, remove deadzone)
    this.emitMouseCommand('move', this.emaX, this.emaY);
  }

  /**
   * Called when hand is lost — release any drag and deactivate cursor.
   * Resets EMA state so the next hand appearance starts fresh.
   */
  handleHandLost(): void {
    if (this.cursor.dragging) {
      this.emitDragEnd();
    }
    this.cursor.active = false;
    this.emaFrameCount = 0;
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private handleGesture(gesture: GestureClass, pointerX: number, pointerY: number): void {
    this.cursor.x = pointerX;
    this.cursor.y = pointerY;

    switch (gesture) {
      case 'POINT':
        this.onPoint();
        break;
      case 'PINCH':
        this.onPinch();
        break;
      case 'FIST':
        this.onFist();
        break;
      case 'SWIPE_RIGHT':
        this.onSwipeRight();
        break;
      case 'ZOOM_IN':
        this.onZoomIn();
        break;
      case 'ZOOM_OUT':
        this.onZoomOut();
        break;
      case 'SCROLL_UP':
        this.onScrollUp();
        break;
      case 'SCROLL_DOWN':
        this.onScrollDown();
        break;
      case 'DWELL_CLICK':
        this.onDwellClick();
        break;
      case 'OPEN_PALM':
        this.onOpenPalm();
        break;
    }
  }

  /**
   * POINT → activate cursor tracking mode.
   * Continuous move commands are driven by updateLandmarks().
   */
  private onPoint(): void {
    if (this.cursor.dragging) {
      this.emitDragEnd();
    }
    this.cursor.active = true;
  }

  /**
   * PINCH → click left at current cursor position.
   * Freezes move emissions for PINCH_FREEZE_MS to prevent micro-drags
   * while the click is being registered by the OS.
   */
  private onPinch(): void {
    const now = Date.now();
    if (now - this.lastClickAt < CLICK_COOLDOWN_MS) return;
    this.lastClickAt = now;

    // Freeze cursor movement so the click doesn't become a micro-drag
    this.moveFrozenUntil = now + PINCH_FREEZE_MS;

    const { x, y } = this.cursor;
    console.log(`[GraphController] PINCH — click_left at (${x.toFixed(3)}, ${y.toFixed(3)})`);
    this.emitMouseCommand('click_left', x, y);
  }

  /**
   * FIST → start drag at current cursor position.
   * Drag ends when gesture changes away from FIST (via handleHandLost or onPoint).
   */
  private onFist(): void {
    if (this.cursor.dragging) return;

    this.cursor.active = true;
    this.cursor.dragging = true;

    const { x, y } = this.cursor;
    console.log(`[GraphController] FIST — drag_start at (${x.toFixed(3)}, ${y.toFixed(3)})`);
    this.emitMouseCommand('drag_start', x, y);
  }

  /**
   * OPEN_PALM → reset / center graph view.
   */
  private onOpenPalm(): void {
    if (this.cursor.dragging) {
      this.emitDragEnd();
    }
    this.cursor.active = false;
    console.log('[GraphController] OPEN_PALM — reset_view');
    this.emitMouseCommand('reset_view', 0.5, 0.5);
  }

  /**
   * SWIPE_RIGHT → scroll out.
   */
  private onSwipeRight(): void {
    const now = Date.now();
    if (now - this.lastScrollAt < SCROLL_COOLDOWN_MS) return;
    this.lastScrollAt = now;

    const { x, y } = this.cursor;
    console.log('[GraphController] SWIPE_RIGHT — scroll_out');
    this.emitMouseCommand('scroll_out', x, y);
  }

  /**
   * ZOOM_IN → two-hand spread apart → scroll in (zoom in).
   */
  private onZoomIn(): void {
    const now = Date.now();
    if (now - this.lastScrollAt < SCROLL_COOLDOWN_MS) return;
    this.lastScrollAt = now;

    const { x, y } = this.cursor;
    console.log('[GraphController] ZOOM_IN — scroll_in');
    this.emitMouseCommand('scroll_in', x, y);
  }

  /**
   * ZOOM_OUT → two-hand pinch together → scroll out (zoom out).
   */
  private onZoomOut(): void {
    const now = Date.now();
    if (now - this.lastScrollAt < SCROLL_COOLDOWN_MS) return;
    this.lastScrollAt = now;

    const { x, y } = this.cursor;
    console.log('[GraphController] ZOOM_OUT — scroll_out');
    this.emitMouseCommand('scroll_out', x, y);
  }

  /**
   * SCROLL_UP → two-finger swipe up.
   */
  private onScrollUp(): void {
    const now = Date.now();
    if (now - this.lastScrollAt < SCROLL_COOLDOWN_MS) return;
    this.lastScrollAt = now;

    const { x, y } = this.cursor;
    this.emitMouseCommand('scroll_up', x, y);
  }

  /**
   * SCROLL_DOWN → two-finger swipe down.
   */
  private onScrollDown(): void {
    const now = Date.now();
    if (now - this.lastScrollAt < SCROLL_COOLDOWN_MS) return;
    this.lastScrollAt = now;

    const { x, y } = this.cursor;
    this.emitMouseCommand('scroll_down', x, y);
  }

  /**
   * DWELL_CLICK → finger held still for 500ms → auto-click.
   */
  private onDwellClick(): void {
    const now = Date.now();
    if (now - this.lastClickAt < CLICK_COOLDOWN_MS) return;
    this.lastClickAt = now;

    this.moveFrozenUntil = now + PINCH_FREEZE_MS;

    const { x, y } = this.cursor;
    this.emitMouseCommand('click_left', x, y);
  }

  /** End an active drag at the current cursor position. */
  private emitDragEnd(): void {
    const { x, y } = this.cursor;
    console.log(`[GraphController] drag_end at (${x.toFixed(3)}, ${y.toFixed(3)})`);
    this.emitMouseCommand('drag_end', x, y);
    this.cursor.dragging = false;
  }

  /** Emit an OS mouse command to the Python Orchestrator via Socket.IO. */
  private emitMouseCommand(action: string, x: number, y: number): void {
    if (action === 'move') {
      console.log('MOVE:', x, y);
    }
    socket.emit('os_mouse_command', { action, x, y });
  }
}
