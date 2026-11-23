import type { GestureClass, Landmark } from './GestureEngine';

/**
 * DemoSimulator generates smooth, realistic hand landmark coordinates and simulated
 * gesture state changes without requiring webcam or MediaPipe Hands.
 * Perfect for portfolio demos, hiring reviews, and headless environments.
 */
export class DemoSimulator {
  private active = false;
  private animFrameId: number | null = null;
  private startTime = 0;
  private onLandmarks?: (landmarks: Landmark[]) => void;
  private onGesture?: (gesture: GestureClass) => void;

  constructor(callbacks: {
    onLandmarks?: (landmarks: Landmark[]) => void;
    onGesture?: (gesture: GestureClass) => void;
  }) {
    this.onLandmarks = callbacks.onLandmarks;
    this.onGesture = callbacks.onGesture;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.startTime = performance.now();
    this.loop();
  }

  stop(): void {
    this.active = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private loop = (): void => {
    if (!this.active) return;

    const elapsed = (performance.now() - this.startTime) / 1000;

    // Simulate hand position floating across the screen in a gentle Lissajous / circular orbit
    const baseX = 0.5 + 0.25 * Math.sin(elapsed * 1.2);
    const baseY = 0.5 + 0.2 * Math.cos(elapsed * 0.9);

    // Generate 21 hand landmarks relative to palm center
    const landmarks: Landmark[] = [];
    for (let i = 0; i < 21; i++) {
      const offsetX = ((i % 5) - 2) * 0.025;
      const offsetY = (Math.floor(i / 5) - 2) * 0.035;
      landmarks.push({
        x: Math.min(Math.max(baseX + offsetX, 0.05), 0.95),
        y: Math.min(Math.max(baseY + offsetY, 0.05), 0.95),
        z: -0.05 + 0.02 * Math.sin(elapsed * 2 + i),
      });
    }

    if (this.onLandmarks) {
      this.onLandmarks(landmarks);
    }

    // Switch between simulated gestures every 4 seconds
    const gestureCycle = Math.floor(elapsed / 4) % 4;
    const gestures: GestureClass[] = ['POINT', 'OPEN_PALM', 'PINCH', 'TWO_FINGER_POINT'];
    const currentGesture = gestures[gestureCycle];

    if (this.onGesture) {
      this.onGesture(currentGesture);
    }

    this.animFrameId = requestAnimationFrame(this.loop);
  };
}
