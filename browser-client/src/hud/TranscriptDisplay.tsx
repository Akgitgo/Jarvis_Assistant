import { useEffect, useRef } from 'react';

export interface TranscriptLine {
  id: string;
  text: string;
  isFinal: boolean;
  source: 'user' | 'jarvis';
  timestamp: number;
}

interface TranscriptDisplayProps {
  lines: TranscriptLine[];
  maxLines?: number;
}

export function TranscriptDisplay({ lines, maxLines = 6 }: TranscriptDisplayProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const visible = lines.slice(-maxLines);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  if (visible.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '10px 14px',
        borderRadius: '12px',
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(10px)',
        border: '1px solid #1f2937',
        maxWidth: '480px',
        maxHeight: '200px',
        overflowY: 'auto',
      }}
    >
      {visible.map((line) => (
        <div
          key={line.id}
          style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-start',
          }}
        >
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'monospace',
              color: line.source === 'user' ? '#60a5fa' : '#34d399',
              flexShrink: 0,
              paddingTop: '2px',
            }}
          >
            {line.source === 'user' ? 'YOU' : 'JAR'}
          </span>
          <span
            style={{
              fontSize: '13px',
              color: line.isFinal ? '#f9fafb' : '#9ca3af',
              fontStyle: line.isFinal ? 'normal' : 'italic',
              lineHeight: 1.4,
              wordBreak: 'break-word',
            }}
          >
            {line.text}
          </span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
