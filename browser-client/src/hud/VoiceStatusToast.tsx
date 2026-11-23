import { useState, useEffect, useRef } from 'react';

export type VoiceToastKind = 'listening' | 'command_accepted' | 'ignored';

interface VoiceStatusToastProps {
  kind: VoiceToastKind | null;
}

const TOAST_CONFIG: Record<VoiceToastKind, { label: string; color: string; duration: number }> = {
  listening: { label: 'LISTENING', color: '#3b82f6', duration: 2000 },
  command_accepted: { label: 'COMMAND ACCEPTED', color: '#22c55e', duration: 1500 },
  ignored: { label: 'IGNORED (NO WAKE WORD)', color: '#6b7280', duration: 1200 },
};

/**
 * VoiceStatusToast — transient bottom-center toast showing voice engine status.
 *
 * Displays brief feedback when:
 *   - Wake word detected → "LISTENING"
 *   - Command processed → "COMMAND ACCEPTED"
 *   - Speech without wake word → "IGNORED (NO WAKE WORD)"
 */
export function VoiceStatusToast({ kind }: VoiceStatusToastProps) {
  const [visible, setVisible] = useState(false);
  const [activeKind, setActiveKind] = useState<VoiceToastKind | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!kind) return;

    setActiveKind(kind);
    setVisible(true);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setVisible(false);
    }, TOAST_CONFIG[kind].duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [kind]);

  if (!visible || !activeKind) return null;

  const config = TOAST_CONFIG[activeKind];

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '140px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 20px',
        borderRadius: '20px',
        background: 'rgba(0, 0, 0, 0.7)',
        border: `1px solid ${config.color}60`,
        backdropFilter: 'blur(8px)',
        fontFamily: 'monospace',
        fontSize: '12px',
        letterSpacing: '0.08em',
        color: config.color,
        animation: 'jarvis-toast-in 0.25s ease-out',
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: config.color,
          flexShrink: 0,
        }}
      />
      {config.label}
      <style>{`
        @keyframes jarvis-toast-in {
          0% { opacity: 0; transform: translateX(-50%) translateY(8px); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
}
