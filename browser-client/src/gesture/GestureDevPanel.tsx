import { useState, useCallback } from 'react';
import type { GestureEngine, GestureClass } from '../GestureEngine';

interface GestureDevPanelProps {
  engine: GestureEngine;
}

const TUNABLE_GESTURES: GestureClass[] = [
  'PINCH',
  'POINT',
  'TWO_FINGER_POINT',
  'OPEN_PALM',
  'FIST',
  'SWIPE_RIGHT',
];

/**
 * GestureDevPanel — floating dev-only panel for tuning gesture sensitivity.
 * Only renders when `import.meta.env.DEV` is true.
 */
export function GestureDevPanel({ engine }: GestureDevPanelProps) {
  if (!import.meta.env.DEV) return null;

  const [collapsed, setCollapsed] = useState(true);
  const [, forceUpdate] = useState(0);

  const handleChange = useCallback(
    (gesture: GestureClass, value: number) => {
      engine.setSensitivity(gesture, value);
      forceUpdate((n) => n + 1);
    },
    [engine]
  );

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '12px',
        left: '12px',
        zIndex: 99999,
        background: 'rgba(0, 0, 0, 0.85)',
        border: '1px solid rgba(0, 229, 255, 0.3)',
        borderRadius: '8px',
        padding: '8px 12px',
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#00E5FF',
        pointerEvents: 'auto',
        minWidth: collapsed ? 'auto' : '220px',
      }}
    >
      <div
        style={{ cursor: 'pointer', userSelect: 'none', marginBottom: collapsed ? 0 : '8px' }}
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? '+ Gesture Dev' : '- Gesture Dev Panel'}
      </div>

      {!collapsed && (
        <>
          <div style={{ marginBottom: '6px', color: 'rgba(0, 229, 255, 0.6)' }}>
            Calibrated: {engine.isCalibrated ? 'YES' : 'NO'}
            {engine.isCalibrated && ` (span: ${engine.baselineHandSpan.toFixed(4)})`}
          </div>

          {TUNABLE_GESTURES.map((gesture) => {
            const value = engine.getSensitivity(gesture);
            return (
              <div key={gesture} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ width: '110px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {gesture}
                </span>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={value}
                  onChange={(e) => handleChange(gesture, parseFloat(e.target.value))}
                  style={{ width: '80px', accentColor: '#00E5FF' }}
                />
                <span style={{ width: '30px', textAlign: 'right' }}>{value.toFixed(2)}</span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
