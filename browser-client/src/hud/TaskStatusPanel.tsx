export type TaskStatus = 'submitted' | 'processing' | 'completed' | 'failed';

export interface TaskInfo {
  id: string;
  intent: string;
  status: TaskStatus;
  text: string;
  timestamp: number;
}

interface TaskStatusPanelProps {
  tasks: TaskInfo[];
  maxVisible?: number;
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  submitted: '#f59e0b',
  processing: '#8b5cf6',
  completed: '#10b981',
  failed: '#ef4444',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  submitted: 'SENT',
  processing: 'EXEC',
  completed: 'DONE',
  failed: 'FAIL',
};

export function TaskStatusPanel({ tasks, maxVisible = 4 }: TaskStatusPanelProps) {
  const visible = tasks.slice(-maxVisible);

  if (visible.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '8px 12px',
        borderRadius: '12px',
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(10px)',
        border: '1px solid #1f2937',
        maxWidth: '280px',
        fontFamily: 'monospace',
        fontSize: '11px',
      }}
    >
      <span
        style={{
          color: '#6b7280',
          fontSize: '9px',
          letterSpacing: '0.1em',
          fontWeight: 700,
          marginBottom: '2px',
        }}
      >
        TASK PIPELINE
      </span>
      {visible.map((task) => {
        const color = STATUS_COLORS[task.status];
        const label = STATUS_LABELS[task.status];
        const isPulsing = task.status === 'submitted' || task.status === 'processing';

        return (
          <div
            key={task.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: color,
                flexShrink: 0,
                animation: isPulsing ? 'jarvis-pulse 1.2s ease-in-out infinite' : 'none',
              }}
            />
            <span
              style={{
                color,
                fontWeight: 700,
                fontSize: '9px',
                letterSpacing: '0.08em',
                minWidth: '30px',
              }}
            >
              {label}
            </span>
            <span
              style={{
                color: '#d1d5db',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
              title={task.text}
            >
              {task.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}
