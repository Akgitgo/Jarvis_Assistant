import type { Results } from "@mediapipe/hands";

declare global {
  interface Window {
    Hands: any;
  }
}

export type GestureClass =
  | 'PINCH'
  | 'POINT'
  | 'TWO_FINGER_POINT'
  | 'OPEN_PALM'
  | 'FIST'
  | 'SWIPE_RIGHT'
  | 'ZOOM_IN'
  | 'ZOOM_OUT'
  | 'SCROLL_UP'
  | 'SCROLL_DOWN'
  | 'DWELL_CLICK';

export type Landmark = { x: number; y: number; z: number };

type GestureCallback = (gesture: GestureClass, landmarks: Landmark[]) => void;
type RawLandmarksCallback = (landmarks: Landmark[]) => void;
type MultiHandLandmarksCallback = (hands: Landmark[][]) => void;
type HandLostCallback = () => void;

const MIN_DETECTION_CONFIDENCE = 0.65;
const MIN_TRACKING_CONFIDENCE = 0.50;
const HAND_LOST_GRACE_MS = 750;
const TARGET_FRAME_MS = 50; // 20 FPS
const WARMUP_MS = 1500; // ignore first 1.5s of frames (camera stabilisation)

// Complex gestures requiring multi-hand or swipe logic — disabled for stability
const DISABLED_GESTURES = new Set<GestureClass>(['SWIPE_RIGHT', 'DWELL_CLICK', 'ZOOM_IN', 'ZOOM_OUT', 'SCROLL_UP', 'SCROLL_DOWN']);

function dist(a: Landmark, b: Landmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

// Angle-based finger extension detection.
// Computes the angle between the mcp->pip and pip->tip vectors.
// A finger is extended when these segments are nearly collinear (small angle).
// Threshold < 40 degrees — relaxed for reliable detection across hand sizes/angles.
function isFingerExtended(tip: Landmark, pip: Landmark, mcp: Landmark): boolean {
  const v1x = pip.x - mcp.x;
  const v1y = pip.y - mcp.y;
  const v1z = pip.z - mcp.z;
  const v2x = tip.x - pip.x;
  const v2y = tip.y - pip.y;
  const v2z = tip.z - pip.z;

  const mag1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z);
  const mag2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z);

  if (mag1 < 1e-6 || mag2 < 1e-6) return false;

  const dot = (v1x * v2x + v1y * v2y + v1z * v2z) / (mag1 * mag2);
  const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);

  return angleDeg < 40;
}

function classifyGesture(landmarks: Landmark[]): GestureClass | null {
  if (landmarks.length < 21) return null;

  const lm = landmarks;

  const indexExtended  = isFingerExtended(lm[8],  lm[6],  lm[5]);
  const middleExtended = isFingerExtended(lm[12], lm[10], lm[9]);
  const ringExtended   = isFingerExtended(lm[16], lm[14], lm[13]);
  const pinkyExtended  = isFingerExtended(lm[20], lm[18], lm[17]);
  const thumbExtended  = isFingerExtended(lm[4],  lm[3],  lm[2]);

  // FIST: check FIRST to avoid being stolen by PINCH.
  // All four fingers curled regardless of thumb position.
  if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return 'FIST';
  }

  // PINCH: thumb tip close to index tip, middle/ring/pinky curled.
  const handRef = dist(lm[0], lm[9]); // wrist to middle MCP as hand-size reference
  const pinchDist = dist(lm[4], lm[8]);
  if (pinchDist < handRef * 0.35 && !middleExtended && !ringExtended && !pinkyExtended) {
    return 'PINCH';
  }

  // OPEN_PALM: four fingers extended; thumb not required (relaxed threshold).
  if (indexExtended && middleExtended && ringExtended && pinkyExtended) {
    return 'OPEN_PALM';
  }

  // TWO_FINGER_POINT (peace sign): index + middle extended, ring + pinky curled, no thumb.
  if (indexExtended && middleExtended && !ringExtended && !pinkyExtended && !thumbExtended) {
    return 'TWO_FINGER_POINT';
  }

  // POINT: index only extended.
  if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return 'POINT';
  }

  return null;
}

export class GestureEngine {
  private hands: any = null;
  private videoEl: HTMLVideoElement | null = null;
  private animFrameId: number | null = null;
  private callback: GestureCallback | null = null;
  private rawLandmarksCallback: RawLandmarksCallback | null = null;
  private multiHandLandmarksCallback: MultiHandLandmarksCallback | null = null;
  private handLostCallback: HandLostCallback | null = null;
  private running = false;
  private initializing = false;
  private handLostTimer: ReturnType<typeof setTimeout> | null = null;

  /** Pending send guard — prevents queuing sends before prior frame completes */
  private sendPending = false;
  private readonly TARGET_FRAME_MS = TARGET_FRAME_MS;
  private lastSendTime = 0;
  private startTime = 0;

  /** Consecutive-frame gesture threshold (1 = fire on first confident frame) */
  private lastGesture: GestureClass | null = null;
  private consecutiveFrames = 0;
  private readonly GESTURE_FRAME_THRESHOLD = 1;

  onGesture(cb: GestureCallback): void {
    this.callback = cb;
  }

  onRawLandmarks(cb: RawLandmarksCallback): void {
    this.rawLandmarksCallback = cb;
  }

  onMultiHandLandmarks(cb: MultiHandLandmarksCallback): void {
    this.multiHandLandmarksCallback = cb;
  }

  onHandLost(cb: HandLostCallback): void {
    this.handLostCallback = cb;
  }

  /** Phase 5 stubs — kept for API compatibility with GestureDevPanel */
  setSensitivity(_gesture: GestureClass, _value: number): void { /* no-op */ }
  getSensitivity(_gesture: GestureClass): number { return 1.0; }
  getAllSensitivities(): Partial<Record<GestureClass, number>> { return {}; }
  get isCalibrated(): boolean { return false; }
  get baselineHandSpan(): number { return 0; }

  async start(videoEl: HTMLVideoElement): Promise<void> {
    if (this.initializing || this.hands) return;
    this.initializing = true;

    this.videoEl = videoEl;
    this.running = true;
    this.startTime = performance.now();

    if (!window.Hands) {
      console.error(
        '[GestureEngine] window.Hands not found — ensure <script src="/mediapipe/hands.js"></script> is in index.html'
      );
      this.running = false;
      this.initializing = false;
      return;
    }

    this.hands = new window.Hands({
      locateFile: (file: string) => `/mediapipe/${file}`,
    });

    this.hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 0,
      minDetectionConfidence: MIN_DETECTION_CONFIDENCE,
      minTrackingConfidence: MIN_TRACKING_CONFIDENCE,
    });

    this.hands.onResults((results: Results) => {
      this.sendPending = false;
      this.handleResults(results);
    });

    try {
      await this.hands.initialize();
      console.log('[GestureEngine] MediaPipe Hands initialized successfully');
      this.initializing = false;
    } catch (err) {
      console.error('[GestureEngine] Failed to initialize MediaPipe Hands:', err);
      this.running = false;
      this.initializing = false;
      this.hands = null;
      return;
    }

    this.loop();
  }

  stop(): void {
    this.running = false;

    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.handLostTimer !== null) {
      clearTimeout(this.handLostTimer);
      this.handLostTimer = null;
    }

    this.hands?.close();
    this.hands = null;
    this.videoEl = null;
    this.sendPending = false;
    this.lastGesture = null;
    this.consecutiveFrames = 0;
  }

  private loop(): void {
    if (!this.running || !this.videoEl || !this.hands) return;

    const now = performance.now();

    // Throttle to ~20 FPS
    if (!this.sendPending && now - this.lastSendTime >= this.TARGET_FRAME_MS) {
      this.lastSendTime = now;
      this.sendPending = true;
      this.hands.send({ image: this.videoEl }).catch(() => {
        this.sendPending = false;
      });
    }

    this.animFrameId = requestAnimationFrame(() => {
      this.animFrameId = null;
      this.loop();
    });
  }

  private scheduleHandLost(): void {
    if (this.handLostTimer !== null) return;
    this.handLostTimer = setTimeout(() => {
      this.handLostTimer = null;
      this.handLostCallback?.();
    }, HAND_LOST_GRACE_MS);
  }

  private cancelHandLost(): void {
    if (this.handLostTimer !== null) {
      clearTimeout(this.handLostTimer);
      this.handLostTimer = null;
    }
  }

  private handleResults(results: Results): void {
    const numHands = results.multiHandLandmarks?.length ?? 0;

    // Camera warm-up: skip first WARMUP_MS of frames
    if (performance.now() - this.startTime < WARMUP_MS) {
      return;
    }

    if (numHands === 0) {
      this.scheduleHandLost();
      this.lastGesture = null;
      this.consecutiveFrames = 0;
      return;
    }

    // Hand present — cancel any pending hand-lost timer
    this.cancelHandLost();

    // Deep-copy primary hand landmarks (MediaPipe reuses its internal buffer)
    const landmarks = results.multiHandLandmarks[0].map(lm => ({
      x: lm.x, y: lm.y, z: lm.z,
    })) as Landmark[];

    // Always forward raw landmarks for cursor tracking — never skip this
    this.rawLandmarksCallback?.(landmarks);

    // Forward all detected hands for multi-hand visualization
    const allHands = results.multiHandLandmarks.map(hand =>
      hand.map(lm => ({ x: lm.x, y: lm.y, z: lm.z })) as Landmark[]
    );
    this.multiHandLandmarksCallback?.(allHands);

    // Classify gesture from primary hand
    const gesture = classifyGesture(landmarks);

    if (gesture === null || DISABLED_GESTURES.has(gesture)) {
      this.lastGesture = null;
      this.consecutiveFrames = 0;
      return;
    }

    // Require GESTURE_FRAME_THRESHOLD consecutive frames before firing
    if (gesture === this.lastGesture) {
      this.consecutiveFrames++;
    } else {
      this.lastGesture = gesture;
      this.consecutiveFrames = 1;
    }

    if (this.consecutiveFrames >= this.GESTURE_FRAME_THRESHOLD && this.callback) {
      console.log("Detected gesture:", gesture);
      this.callback(gesture, landmarks);
    }
  }
}
