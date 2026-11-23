import React from 'react';
import { AgentStatus } from './AgentStatus';
import type { AgentState } from './AgentStatus';
import { ProjectBadge } from './ProjectBadge';
import { TranscriptDisplay } from './TranscriptDisplay';
import type { TranscriptLine } from './TranscriptDisplay';
import { TaskStatusPanel } from './TaskStatusPanel';
import type { TaskInfo } from './TaskStatusPanel';

interface HUDProps {
  agentState: AgentState;
  projectId: string | null;
  projectName?: string | null;
  transcriptLines: TranscriptLine[];
  tasks: TaskInfo[];
  /** Optional slot rendered in the top-center (e.g. GestureHUD). */
  gestureSlot?: React.ReactNode;
}

/**
 * HUD — full-screen fixed overlay composing all JARVIS status widgets.
 *
 * Top-left:  ProjectBadge (active project)
 * Top-right: AgentStatus (voice engine state)
 * Bottom-left: TranscriptDisplay (voice transcript + agent replies)
 *
 * pointer-events: none so the underlying graph view remains interactive.
 */
export function HUD({ agentState, projectId, projectName, transcriptLines, tasks, gestureSlot }: HUDProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '16px',
        boxSizing: 'border-box',
      }}
    >
      {/* Top bar: left=project, center=gesture HUD, right=agent status */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '12px',
        }}
      >
        <ProjectBadge projectId={projectId} projectName={projectName} />
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          {gestureSlot}
        </div>
        <AgentStatus state={agentState} />
      </div>

      {/* Bottom row: left=transcript, right=task pipeline */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <TranscriptDisplay lines={transcriptLines} />
        <TaskStatusPanel tasks={tasks} />
      </div>
    </div>
  );
}
