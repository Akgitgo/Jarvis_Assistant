/**
 * GestureCalibration.ts — Hysteresis stabilizer, hand-size normalizer,
 * and per-gesture sensitivity map for JARVIS gesture engine.
 */

import type { GestureClass, Landmark } from '../GestureEngine';

// ── Feature 1: Hysteresis Stabilizer ────────────────────────────────────────
// Prevents gesture flickering (e.g. POINT → null oscillation) by requiring
// null to persist for >3 consecutive frames before clearing the active gesture.

export class GestureStabilizer {
  private activeGesture: GestureClass | null = null;
  private nullFrames = 0;

  stabilize(newGesture: GestureClass | null): GestureClass | null {
    if (newGesture === this.activeGesture) {
      this.nullFrames = 0;
      return this.activeGesture;
    }
    if (newGesture === null) {
      this.nullFrames++;
      if (this.nullFrames > 3) {
        this.activeGesture = null;
      }
      return this.activeGesture;
    }
    this.nullFrames = 0;
    this.activeGesture = newGesture;
    return newGesture;
  }

  reset(): void {
    this.activeGesture = null;
    this.nullFrames = 0;
  }
}

// ── Feature 2: Hand Size Normalizer ─────────────────────────────────────────
// Captures handSpan (dist(lm[0], lm[9])) over the first 60 frames and computes
// a stable baseline via median. All ratio thresholds use this baseline instead
// of the per-frame handSpan, eliminating z-depth instability.

function dist(a: Landmark, b: Landmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export class HandSizeNormalizer {
  private samples: number[] = [];
  private _baseline: number | null = null;
  private readonly calibrationFrames: number;

  constructor(calibrationFrames = 60) {
    this.calibrationFrames = calibrationFrames;
  }

  get isCalibrated(): boolean {
    return this._baseline !== null;
  }

  get baselineHandSpan(): number {
    return this._baseline ?? 0;
  }

  /** Feed a frame of landmarks. Returns the handSpan to use for thresholds. */
  update(landmarks: Landmark[]): number {
    if (landmarks.length < 10) return 0;

    const handSpan = dist(landmarks[0], landmarks[9]);

    if (this._baseline !== null) {
      return this._baseline;
    }

    this.samples.push(handSpan);

    if (this.samples.length >= this.calibrationFrames) {
      this._baseline = median(this.samples);
      console.log(
        `[HandSizeNormalizer] Calibrated — baseline handSpan: ${this._baseline.toFixed(4)} ` +
        `(${this.samples.length} samples)`
      );
      return this._baseline;
    }

    // During calibration, use per-frame handSpan as fallback
    return handSpan;
  }

  reset(): void {
    this.samples = [];
    this._baseline = null;
  }
}

// ── Feature 3: Per-Gesture Sensitivity Map ──────────────────────────────────
// Allows runtime adjustment of ratio thresholds per gesture.
// 1.0 = default threshold, 0.5 = half as sensitive (requires stronger gesture).
// The engine multiplies its base threshold by (1 / sensitivity) so that lower
// sensitivity values make the threshold stricter.

export class GestureSensitivityMap {
  private sensitivities: Map<GestureClass, number> = new Map();

  /** Set sensitivity for a gesture (0.0–1.0 scale, default 1.0). */
  setSensitivity(gesture: GestureClass, value: number): void {
    const clamped = Math.max(0.01, Math.min(1.0, value));
    this.sensitivities.set(gesture, clamped);
  }

  /** Get the sensitivity multiplier for a gesture. */
  getSensitivity(gesture: GestureClass): number {
    return this.sensitivities.get(gesture) ?? 1.0;
  }

  /**
   * Apply sensitivity to a threshold value.
   * Lower sensitivity → higher effective threshold → harder to trigger.
   */
  applyToThreshold(gesture: GestureClass, baseThreshold: number): number {
    const sensitivity = this.getSensitivity(gesture);
    return baseThreshold / sensitivity;
  }

  /** Get all current sensitivities as a plain object. */
  getAll(): Partial<Record<GestureClass, number>> {
    const result: Partial<Record<GestureClass, number>> = {};
    for (const [gesture, value] of this.sensitivities) {
      result[gesture] = value;
    }
    return result;
  }

  reset(): void {
    this.sensitivities.clear();
  }
}
