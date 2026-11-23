import type { GestureClass } from '../GestureEngine';
import { GESTURE_ACTIONS } from '../gesture/actions';

interface GestureHUDProps {
  gesture?: GestureClass | null;
}

const GESTURE_ICONS: Record<GestureClass, string> = {
  OPEN_PALM: '\u270B',
  PINCH: '\uD83E\uDD0C',
  POINT: '\u261D\uFE0F',
  TWO_FINGER_POINT: '\u270C\uFE0F',
  FIST: '\u270A',
  SWIPE_RIGHT: '\uD83D\uDC49',
  ZOOM_IN: '\uD83D\uDD0D',
  ZOOM_OUT: '\uD83D\uDD0E',
  SCROLL_UP: '\u2B06\uFE0F',
  SCROLL_DOWN: '\u2B07\uFE0F',
  DWELL_CLICK: '\uD83C\uDFAF',
};

/**
 * GestureHUD — live gesture name + mapped action display.
 *
 * Appears in the top-center area of the viewport when a gesture is active.
 * pointer-events: none so it does not block the underlying UI.
 */
export function GestureHUD({ gesture }: GestureHUDProps) {
  if (!gesture) return <div>No Gesture Detected</div>;

  const action = GESTURE_ACTIONS[gesture];
  const icon = GESTURE_ICONS[gesture];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
        padding: '10px 20px',
        borderRadius: '12px',
        background: 'rgba(0, 229, 255, 0.08)',
        border: '1px solid rgba(0, 229, 255, 0.4)',
        backdropFilter: 'blur(10px)',
        color: '#00E5FF',
        fontFamily: 'monospace',
        pointerEvents: 'none',
        minWidth: '140px',
        textAlign: 'center',
      }}
    >
      <span style={{ fontSize: '22px', lineHeight: 1 }}>
        {icon ?? '🤚'}
      </span>
      <span
        style={{
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: '#00E5FF',
        }}
      >
        {action?.label ?? 'GESTURE'}
      </span>
      <span
        style={{
          fontSize: '10px',
          color: 'rgba(0, 229, 255, 0.6)',
          letterSpacing: '0.04em',
        }}
      >
        {gesture.replace(/_/g, ' ')}
      </span>
    </div>
  );
}
