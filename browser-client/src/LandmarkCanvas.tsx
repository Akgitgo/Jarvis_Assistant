import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Landmark } from './GestureEngine';

const LANDMARK_COLOR = '#00d4ff';
const CONNECTION_COLOR = 'rgba(0,212,255,0.6)';
const FINGERTIP_COLOR = '#ffffff';
const FPS = 30;
const FRAME_MS = 1000 / FPS;

// MediaPipe Hands skeleton connections (index pairs into the 21-landmark array)
const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],       // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],       // index
  [0, 9], [9, 10], [10, 11], [11, 12],  // middle
  [0, 13], [13, 14], [14, 15], [15, 16], // ring
  [0, 17], [17, 18], [18, 19], [19, 20], // pinky
  [5, 9], [9, 13], [13, 17],            // palm arc
];

/** Index fingertip — the only landmark drawn larger (5px white). */
const INDEX_TIP = 8;

/** Validate that a landmark has finite coordinates within [0,1]. */
const isValid = (lm: Landmark): boolean =>
  lm != null &&
  isFinite(lm.x) && isFinite(lm.y) &&
  lm.x >= 0 && lm.x <= 1 && lm.y >= 0 && lm.y <= 1;

export interface LandmarkCanvasHandle {
  setLandmarks(landmarks: Landmark[]): void;
  clearLandmarks(): void;
}

/**
 * LandmarkCanvas — full-viewport 2D canvas overlay.
 *
 * Draws MediaPipe Hands 21-point skeleton in neon blue (#00E5FF) at 30 fps
 * using an imperative handle so landmark updates never trigger React re-renders.
 *
 * Cursor circle is drawn at landmark[8] (index fingertip) for live tracking.
 */
export const LandmarkCanvas = forwardRef<LandmarkCanvasHandle, object>(
  (_, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const landmarksRef = useRef<Landmark[] | null>(null);
    const rafRef = useRef<number | null>(null);
    const lastFrameRef = useRef<number>(0);

    useImperativeHandle(ref, () => ({
      setLandmarks(landmarks) {
        landmarksRef.current = landmarks;
      },
      clearLandmarks() {
        landmarksRef.current = null;
      },
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const resize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      };
      resize();
      window.addEventListener('resize', resize);

      const render = (now: number) => {
        rafRef.current = requestAnimationFrame(render);

        if (now - lastFrameRef.current < FRAME_MS) return;
        lastFrameRef.current = now;

        const landmarks = landmarksRef.current;
        // Only draw if we have exactly 21 landmarks
        if (!landmarks || landmarks.length !== 21) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const w = canvas.width;
        const h = canvas.height;

        const toCanvas = (lm: Landmark) => ({
          x: (1 - lm.x) * w,
          y: lm.y * h,
        });

        // Skeleton connections — skip if either endpoint is invalid
        ctx.strokeStyle = CONNECTION_COLOR;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 1;
        for (const [a, b] of CONNECTIONS) {
          const lA = landmarks[a];
          const lB = landmarks[b];
          if (!isValid(lA) || !isValid(lB)) continue;
          const pA = toCanvas(lA);
          const pB = toCanvas(lB);
          ctx.beginPath();
          ctx.moveTo(pA.x, pA.y);
          ctx.lineTo(pB.x, pB.y);
          ctx.stroke();
        }

        // Landmark dots — all 3px #00d4ff, except index tip (lm[8]) = 5px white
        for (let i = 0; i < landmarks.length; i++) {
          const lm = landmarks[i];
          if (!isValid(lm)) continue;
          const p = toCanvas(lm);
          const isIndexTip = i === INDEX_TIP;

          ctx.beginPath();
          ctx.arc(p.x, p.y, isIndexTip ? 5 : 3, 0, Math.PI * 2);
          ctx.fillStyle = isIndexTip ? FINGERTIP_COLOR : LANDMARK_COLOR;
          ctx.fill();
        }
      };

      rafRef.current = requestAnimationFrame(render);

      return () => {
        window.removeEventListener('resize', resize);
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      };
    }, []);

    return (
      <canvas
        ref={canvasRef}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          pointerEvents: 'none',
          zIndex: 9996,
          transform: 'translateZ(0)',
          willChange: 'transform',
          backfaceVisibility: 'hidden',
        }}
      />
    );
  }
);
