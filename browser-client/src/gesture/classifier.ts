/**
 * classifier.ts — JARVIS gesture classifier
 *
 * Wraps the landmark-level classification logic from GestureEngine so it can
 * be imported and tested in isolation.
 */

import type { GestureClass, Landmark } from '../GestureEngine';

export type { GestureClass, Landmark };

/** Euclidean distance between two landmarks. */
function dist(a: Landmark, b: Landmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

/** Returns true when the finger tip is clearly extended beyond the PIP joint. */
function isExtended(tip: Landmark, pip: Landmark, mcp: Landmark): boolean {
  return dist(tip, mcp) > dist(pip, mcp) * 1.15;
}

/**
 * Classify a single hand pose from 21 MediaPipe landmarks.
 *
 * @param landmarks  21-element array of {x, y, z} in normalised image space.
 * @param prevWrist  Wrist position from the previous frame (for swipe detection).
 * @returns The detected GestureClass, or null when no gesture is recognised.
 */
export function classifyLandmarks(
  landmarks: Landmark[],
  prevWrist: Landmark | null
): GestureClass | null {
  if (landmarks.length < 21) return null;

  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const indexPip = landmarks[6];
  const indexMcp = landmarks[5];
  const middleTip = landmarks[12];
  const middlePip = landmarks[10];
  const middleMcp = landmarks[9];
  const ringTip = landmarks[16];
  const ringPip = landmarks[14];
  const ringMcp = landmarks[13];
  const pinkyTip = landmarks[20];
  const pinkyPip = landmarks[18];
  const pinkyMcp = landmarks[17];

  const indexExt = isExtended(indexTip, indexPip, indexMcp);
  const middleExt = isExtended(middleTip, middlePip, middleMcp);
  const ringExt = isExtended(ringTip, ringPip, ringMcp);
  const pinkyExt = isExtended(pinkyTip, pinkyPip, pinkyMcp);

  // PINCH: thumb tip close to index tip, other fingers not extended
  if (dist(thumbTip, indexTip) < 0.06 && !middleExt && !ringExt && !pinkyExt) {
    return 'PINCH';
  }

  // TWO_FINGER_POINT: index + middle extended, others curled — check for scroll
  if (indexExt && middleExt && !ringExt && !pinkyExt) {
    if (prevWrist) {
      const dy = wrist.y - prevWrist.y;
      if (dy > 0.04) return 'SCROLL_DOWN';
      if (dy < -0.04) return 'SCROLL_UP';
    }
    return 'TWO_FINGER_POINT';
  }

  // POINT: only index extended
  if (indexExt && !middleExt && !ringExt && !pinkyExt) {
    return 'POINT';
  }

  // OPEN_PALM: all four fingers extended
  if (indexExt && middleExt && ringExt && pinkyExt) {
    return 'OPEN_PALM';
  }

  // FIST: no fingers extended
  if (!indexExt && !middleExt && !ringExt && !pinkyExt) {
    return 'FIST';
  }

  // SWIPE_RIGHT: wrist moved significantly to the right since last frame
  if (prevWrist && wrist.x - prevWrist.x > 0.08) {
    return 'SWIPE_RIGHT';
  }

  return null;
}
