import type { GestureClass } from './GestureEngine';

const GESTURE_LABELS: Record<GestureClass, string> = {
  PINCH: 'PINCH',
  POINT: 'POINT',
  TWO_FINGER_POINT: 'TWO FINGER POINT',
  OPEN_PALM: 'OPEN PALM',
  FIST: 'FIST',
  SWIPE_RIGHT: 'SWIPE RIGHT',
  ZOOM_IN: 'ZOOM IN',
  ZOOM_OUT: 'ZOOM OUT',
  SCROLL_UP: 'SCROLL UP',
  SCROLL_DOWN: 'SCROLL DOWN',
  DWELL_CLICK: 'DWELL CLICK',
};

interface GestureOverlayProps {
  gesture: GestureClass | null;
}

/**
 * GestureOverlay — bottom-right badge showing the currently detected gesture.
 *
 * Renders nothing when no gesture is active. pointer-events: none so the
 * underlying Three.js canvas and graph view remain interactive.
 */
export function GestureOverlay({ gesture }: GestureOverlayProps) {
  if (!gesture) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: '70px',
        right: '20px',
        zIndex: 9998,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 16px',
        borderRadius: '24px',
        background: 'rgba(0, 238, 255, 0.10)',
        border: '1px solid rgba(0, 238, 255, 0.45)',
        color: '#00eeff',
        fontFamily: 'monospace',
        fontSize: '13px',
        letterSpacing: '0.05em',
        backdropFilter: 'blur(8px)',
      }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: '#00eeff',
          flexShrink: 0,
          animation: 'jarvis-gesture-pulse 0.6s ease-out forwards',
        }}
      />
      <span>{GESTURE_LABELS[gesture]}</span>
      <style>{`
        @keyframes jarvis-gesture-pulse {
          0%   { opacity: 1; transform: scale(1); }
          50%  { opacity: 0.6; transform: scale(1.4); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
