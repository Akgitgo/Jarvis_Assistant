export type AgentState = 'idle' | 'listening' | 'awake' | 'recording' | 'processing' | 'error';

interface AgentStatusProps {
  state: AgentState;
  agentName?: string;
}

const STATE_LABELS: Record<AgentState, string> = {
  idle: 'Idle',
  listening: 'Listening…',
  awake: 'Awake',
  recording: 'Recording…',
  processing: 'Processing…',
  error: 'Error',
};

const STATE_COLORS: Record<AgentState, string> = {
  idle: '#6b7280',
  listening: '#3b82f6',
  awake: '#f59e0b',
  recording: '#ef4444',
  processing: '#8b5cf6',
  error: '#dc2626',
};

export function AgentStatus({ state, agentName = 'JARVIS' }: AgentStatusProps) {
  const color = STATE_COLORS[state];
  const label = STATE_LABELS[state];
  const isPulsing = state === 'listening' || state === 'recording' || state === 'processing';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 12px',
        borderRadius: '20px',
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(8px)',
        border: `1px solid ${color}40`,
        color: '#fff',
        fontSize: '13px',
        fontFamily: 'monospace',
        userSelect: 'none',
      }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          animation: isPulsing ? 'jarvis-pulse 1.2s ease-in-out infinite' : 'none',
        }}
      />
      <span style={{ color: '#9ca3af', marginRight: '2px' }}>{agentName}</span>
      <span style={{ color }}>{label}</span>
      <style>{`
        @keyframes jarvis-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.3); }
        }
      `}</style>
    </div>
  );
}
