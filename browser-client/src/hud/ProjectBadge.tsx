interface ProjectBadgeProps {
  projectId: string | null;
  projectName?: string | null;
}

export function ProjectBadge({ projectId, projectName }: ProjectBadgeProps) {
  if (!projectId) {
    return (
      <div
        style={{
          padding: '4px 10px',
          borderRadius: '12px',
          background: 'rgba(0,0,0,0.4)',
          border: '1px solid #374151',
          color: '#6b7280',
          fontSize: '12px',
          fontFamily: 'monospace',
          userSelect: 'none',
        }}
      >
        No active project
      </div>
    );
  }

  const displayName = projectName ?? projectId;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        borderRadius: '12px',
        background: 'rgba(16, 185, 129, 0.15)',
        border: '1px solid rgba(16, 185, 129, 0.4)',
        color: '#6ee7b7',
        fontSize: '12px',
        fontFamily: 'monospace',
        userSelect: 'none',
        maxWidth: '200px',
      }}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <circle cx="5" cy="5" r="4" stroke="#10b981" strokeWidth="1.5" />
        <circle cx="5" cy="5" r="2" fill="#10b981" />
      </svg>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={displayName}
      >
        {displayName}
      </span>
    </div>
  );
}
