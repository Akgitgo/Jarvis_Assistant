import * as THREE from 'three';
import type { Landmark } from './GestureEngine';

const TRAIL_MAX_POINTS = 60;
const TRAIL_FADE_DURATION_MS = 800;
const TRAIL_COLOR = 0x00eeff;
const TRAIL_OPACITY_MAX = 0.85;

interface TrailSegment {
  line: THREE.Line;
  material: THREE.LineBasicMaterial;
  createdAt: number;
}

/**
 * GestureTrailOverlay renders a fading 3D trail of hand-landmark positions
 * using Three.js inside a WebXR session.
 *
 * Usage:
 *   const overlay = new GestureTrailOverlay();
 *   await overlay.start(renderer, referenceSpace);
 *   // In GestureEngine callback:
 *   overlay.addPoint(landmarks[8]); // track index fingertip
 *   // After gesture ends:
 *   overlay.clearTrail();
 *   // On teardown:
 *   overlay.dispose();
 */
export class GestureTrailOverlay {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;
  private animFrameId: number | null = null;
  private running = false;

  // Current active trail geometry
  private trailPoints: THREE.Vector3[] = [];
  private trailLine: THREE.Line | null = null;
  private trailMaterial: THREE.LineBasicMaterial | null = null;
  private trailGeometry: THREE.BufferGeometry | null = null;

  // Completed trail segments awaiting fade-out
  private fadingSegments: TrailSegment[] = [];

  constructor() {
    this.scene = new THREE.Scene();
    // Camera used for non-XR fallback rendering
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.camera.position.set(0, 0, 1);
  }

  /**
   * Attach an existing WebGLRenderer that already has an active WebXR session.
   * Call this after `renderer.xr.setSession(session)`.
   */
  start(renderer: THREE.WebGLRenderer): void {
    if (this.running) return;
    this.renderer = renderer;
    this.running = true;

    renderer.xr.enabled = true;
    this._initActiveLine();
    this._renderLoop();
  }

  /**
   * Record a new hand-landmark position into the active trail.
   * Pass any landmark (e.g. index fingertip = landmarks[8]).
   * Coordinates are normalised [0,1] from MediaPipe; we map them to
   * WebXR world space centred around the origin at arm's reach.
   */
  addPoint(landmark: Landmark): void {
    if (!this.running) return;

    // Map normalised landmark coords to a world-space vector.
    // x: flip horizontal so motion matches mirror view
    // y: flip vertical (MediaPipe top=0, Three.js up=+y)
    // z: scale depth to a comfortable AR depth range
    const worldPos = new THREE.Vector3(
      -(landmark.x - 0.5) * 1.5,
       (0.5 - landmark.y) * 1.0,
      -0.6 + landmark.z * 0.5,
    );

    this.trailPoints.push(worldPos);

    if (this.trailPoints.length > TRAIL_MAX_POINTS) {
      this.trailPoints.shift();
    }

    this._updateActiveLineGeometry();
  }

  /**
   * Freeze the current trail into a fading segment and start a fresh line.
   * Call this when a gesture ends.
   */
  clearTrail(): void {
    if (this.trailLine && this.trailMaterial) {
      this.fadingSegments.push({
        line: this.trailLine,
        material: this.trailMaterial,
        createdAt: performance.now(),
      });
      // Detach from shared geometry ownership — fading segment keeps its own copy
      this.trailLine = null;
      this.trailMaterial = null;
      this.trailGeometry = null;
    }
    this.trailPoints = [];
    this._initActiveLine();
  }

  /** Stop rendering and free all GPU resources. */
  dispose(): void {
    this.running = false;

    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    this._disposeActiveLine();

    for (const seg of this.fadingSegments) {
      this.scene.remove(seg.line);
      seg.line.geometry.dispose();
      seg.material.dispose();
    }
    this.fadingSegments = [];
    this.renderer = null;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _initActiveLine(): void {
    this._disposeActiveLine();

    this.trailGeometry = new THREE.BufferGeometry();
    this.trailMaterial = new THREE.LineBasicMaterial({
      color: TRAIL_COLOR,
      transparent: true,
      opacity: TRAIL_OPACITY_MAX,
      linewidth: 2, // Only effective in WebGL1 or with LineSegments2
    });
    this.trailLine = new THREE.Line(this.trailGeometry, this.trailMaterial);
    this.scene.add(this.trailLine);
  }

  private _disposeActiveLine(): void {
    if (this.trailLine) {
      this.scene.remove(this.trailLine);
    }
    if (this.trailGeometry) {
      this.trailGeometry.dispose();
      this.trailGeometry = null;
    }
    if (this.trailMaterial) {
      this.trailMaterial.dispose();
      this.trailMaterial = null;
    }
    this.trailLine = null;
  }

  private _updateActiveLineGeometry(): void {
    if (!this.trailGeometry || this.trailPoints.length < 2) return;

    const positions = new Float32Array(this.trailPoints.length * 3);
    for (let i = 0; i < this.trailPoints.length; i++) {
      positions[i * 3]     = this.trailPoints[i].x;
      positions[i * 3 + 1] = this.trailPoints[i].y;
      positions[i * 3 + 2] = this.trailPoints[i].z;
    }
    this.trailGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    );
    this.trailGeometry.setDrawRange(0, this.trailPoints.length);
    this.trailGeometry.attributes.position.needsUpdate = true;
    this.trailGeometry.computeBoundingSphere();
  }

  private _tickFadingSegments(): void {
    const now = performance.now();
    this.fadingSegments = this.fadingSegments.filter((seg) => {
      const elapsed = now - seg.createdAt;
      if (elapsed >= TRAIL_FADE_DURATION_MS) {
        this.scene.remove(seg.line);
        seg.line.geometry.dispose();
        seg.material.dispose();
        return false; // remove from list
      }
      const progress = elapsed / TRAIL_FADE_DURATION_MS;
      seg.material.opacity = TRAIL_OPACITY_MAX * (1 - progress);
      return true;
    });
  }

  private _renderLoop(): void {
    if (!this.running || !this.renderer) return;

    const renderer = this.renderer;

    const frame = () => {
      if (!this.running) return;
      this._tickFadingSegments();
      renderer.render(this.scene, this.camera);
      this.animFrameId = renderer.xr.isPresenting
        ? renderer.setAnimationLoop(null) as unknown as number // XR loop below
        : requestAnimationFrame(frame);
    };

    if (renderer.xr.isPresenting) {
      // Hand off to WebXR's requestAnimationFrame equivalent
      renderer.setAnimationLoop((_timestamp: number, _frame: XRFrame) => {
        if (!this.running) {
          renderer.setAnimationLoop(null);
          return;
        }
        this._tickFadingSegments();
        renderer.render(this.scene, this.camera);
      });
    } else {
      // Non-XR fallback (desktop preview)
      this.animFrameId = requestAnimationFrame(frame);
    }
  }
}
