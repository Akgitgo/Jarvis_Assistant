import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GestureEngine } from './GestureEngine';
import type { GestureClass, Landmark } from './GestureEngine';
import { GestureTrailOverlay } from './GestureTrailOverlay';

/**
 * GestureTrailCanvas mounts an invisible, pointer-events-none canvas over the
 * entire viewport. It starts the camera + GestureEngine, feeds hand-landmark
 * positions into GestureTrailOverlay, and renders the 3D trail via Three.js.
 *
 * The canvas is transparent (alpha: true, premultipliedAlpha: false) so the
 * Obsidian graph view shows through underneath.
 */

interface GestureTrailCanvasProps {
  onGesture?: (gesture: GestureClass) => void;
  /** Called once when the hidden camera video element is ready (stream attached). */
  onVideoReady?: (video: HTMLVideoElement) => void;
  /** Called with raw 21-point landmarks at ~30 fps. */
  onLandmarks?: (landmarks: Landmark[]) => void;
  /** Called when the hand leaves the camera frame. */
  onHandLost?: () => void;
  /** Called once when the GestureEngine instance is created (for dev panel access). */
  onEngineReady?: (engine: GestureEngine) => void;
}

export function GestureTrailCanvas({ onGesture, onVideoReady, onLandmarks, onHandLost, onEngineReady }: GestureTrailCanvasProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // ── Three.js renderer (transparent canvas) ─────────────────────────────
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    renderer.setClearColor(0x000000, 0); // fully transparent background
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;

    // ── GestureTrailOverlay (handles scene / render loop) ──────────────────
    const overlay = new GestureTrailOverlay();
    overlay.start(renderer);

    // ── Camera feed ────────────────────────────────────────────────────────
    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.muted = true;
    video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;transform:translateZ(0);will-change:transform;backface-visibility:hidden;';
    document.body.appendChild(video);

    let gestureEngine: GestureEngine | null = null;
    // 30 fps throttle for onLandmarks
    let lastLandmarkFrame = 0;
    const LANDMARK_FRAME_MS = 1000 / 30;

    navigator.mediaDevices
      .getUserMedia({
        video: {
          width:     { ideal: 640 },
          height:    { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
          facingMode: 'user',
        },
      })
      .then((stream) => {
        video.srcObject = stream;
        const settings = stream.getVideoTracks()[0].getSettings();
        console.log('[Camera]', settings.width, settings.height, settings.frameRate);
        return video.play();
      })
      .then(() => {
        onVideoReady?.(video);

        gestureEngine = new GestureEngine();
        onEngineReady?.(gestureEngine);

        gestureEngine.onRawLandmarks((landmarks) => {
          // Track index fingertip (landmark 8) for the gesture trail
          overlay.addPoint(landmarks[8]);

          // Forward all 21 landmarks at 30 fps
          const now = performance.now();
          if (now - lastLandmarkFrame >= LANDMARK_FRAME_MS) {
            lastLandmarkFrame = now;
            onLandmarks?.(landmarks);
          }
        });

        gestureEngine.onHandLost(() => {
          overlay.clearTrail();
          onHandLost?.();
        });

        gestureEngine.onGesture((gesture, landmarks) => {
          // Dispatch DOM event so GraphController and other listeners can react.
          // Use index fingertip (landmark 8) for pointer position — matches
          // GraphController.updateLandmarks() which also tracks landmark 8.
          // Mirror X so hand movement maps naturally to screen direction.
          const tip = landmarks[8];
          const pointerX = 1 - tip.x;
          const pointerY = tip.y;
          window.dispatchEvent(
            new CustomEvent('jarvis-gesture', {
              detail: { gesture, pointerX, pointerY },
            })
          );
          onGesture?.(gesture);
        });

        gestureEngine.start(video);
      })
      .catch((err) => {
        console.warn('[GestureTrailCanvas] Camera unavailable:', err);
      });

    // ── Resize handler ─────────────────────────────────────────────────────
    const onResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      gestureEngine?.stop();
      overlay.dispose();
      renderer.dispose();

      const stream = video.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
      video.remove();
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
        zIndex: 9999,
        transform: 'translateZ(0)',
        willChange: 'transform',
        backfaceVisibility: 'hidden',
      }}
    />
  );
}
