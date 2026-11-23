import { useState, useEffect, useRef, useCallback } from 'react';
import { GestureTrailCanvas } from './GestureTrailCanvas';
import { GestureOverlay } from './GestureOverlay';
import { CameraPreview } from './CameraPreview';
import { LandmarkCanvas } from './LandmarkCanvas';
import type { LandmarkCanvasHandle } from './LandmarkCanvas';
import { HUD } from './hud/HUD';
import { GestureHUD } from './hud/GestureHUD';
import { VoiceEngine } from './VoiceEngine';
import { VoiceFeedback } from './VoiceFeedback';
import { GraphController } from './gesture/GraphController';
import { VoiceStatusToast } from './hud/VoiceStatusToast';
import type { VoiceToastKind } from './hud/VoiceStatusToast';
import { socket } from './socket';
import { GestureDevPanel } from './gesture/GestureDevPanel';
import { DemoSimulator } from './DemoSimulator';

/** Notify the orchestrator when gesture mode toggles so it can gate cursor moves. */
function emitGestureMode(active: boolean): void {
  socket.emit('gesture_mode', { active });
}
import type { GestureEngine, GestureClass, Landmark } from './GestureEngine';
import type { AgentState } from './hud/AgentStatus';
import type { TranscriptLine } from './hud/TranscriptDisplay';
import type { TaskInfo, TaskStatus } from './hud/TaskStatusPanel';

// How long to keep the gesture badge and GestureHUD visible after last detection (ms).
const GESTURE_CLEAR_MS = 1500;

function App() {
  const [gesture, setGesture] = useState<GestureClass | null>(null);
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [voiceToast, setVoiceToast] = useState<{ kind: VoiceToastKind; seq: number } | null>(null);
  const [gestureEngine, setGestureEngine] = useState<GestureEngine | null>(null);
  const toastSeqRef = useRef(0);

  // sourceVideo uses state (triggers CameraPreview re-render once on camera ready).
  // landmarkCanvasRef is imperative — landmarks never go through React state.
  const [sourceVideo, setSourceVideo] = useState<HTMLVideoElement | null>(null);
  const landmarkCanvasRef = useRef<LandmarkCanvasHandle | null>(null);
  const graphControllerRef = useRef<GraphController | null>(null);
  const voiceFeedbackRef = useRef<VoiceFeedback | null>(null);

  const gestureModeRef = useRef(false);
  const gestureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineIdCounter = useRef(0);
  const taskIdCounter = useRef(0);

  const addLine = useCallback((text: string, isFinal: boolean, source: 'user' | 'jarvis') => {
    const id = String(++lineIdCounter.current);
    setTranscriptLines((prev) => [
      ...prev.slice(-19),
      { id, text, isFinal, source, timestamp: Date.now() },
    ]);
  }, []);

  const addTask = useCallback((intent: string, text: string, status: TaskStatus = 'submitted'): string => {
    const id = String(++taskIdCounter.current);
    setTasks((prev) => [
      ...prev.slice(-9),
      { id, intent, status, text, timestamp: Date.now() },
    ]);
    return id;
  }, []);

  const updateTask = useCallback((taskId: string, status: TaskStatus) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status, timestamp: Date.now() } : t))
    );
  }, []);

  const showToast = useCallback((kind: VoiceToastKind) => {
    setVoiceToast({ kind, seq: ++toastSeqRef.current });
  }, []);

  // ── Send voice command to orchestrator via Socket.IO ─────────────────────
  const sendCommandToOrchestrator = useCallback((text: string) => {
    const taskId = addTask('pending', text, 'submitted');

    if (!socket.connected) {
      updateTask(taskId, 'failed');
      voiceFeedbackRef.current?.speak('Sorry, the orchestrator is not reachable.');
      return;
    }

    // Send raw transcript to backend — it handles NLU parsing + intent routing
    socket.emit('voice_command_event', {
      transcript: text,
      taskId,
      projectId,
      timestamp: Date.now(),
    });

    voiceFeedbackRef.current?.speak('Processing command.');
  }, [addTask, updateTask, projectId]);

  // ── GestureTrailCanvas callbacks ─────────────────────────────────────────────
  const handleVideoReady = useCallback((video: HTMLVideoElement) => {
    setSourceVideo(video);
  }, []);

  const handleEngineReady = useCallback((engine: GestureEngine) => {
    setGestureEngine(engine);
  }, []);

  const handleLandmarks = useCallback((landmarks: Landmark[]) => {
    landmarkCanvasRef.current?.setLandmarks(landmarks);

    // Drive cursor on every frame — no gesture mode gate, no dead zone (temp debug)
    graphControllerRef.current?.updateLandmarks(landmarks);
  }, []);

  const handleHandLost = useCallback(() => {
    landmarkCanvasRef.current?.clearLandmarks();
    graphControllerRef.current?.handleHandLost();
  }, []);

  // ── Gesture handler ──────────────────────────────────────────────────────────
  const handleGesture = useCallback((g: GestureClass) => {
    setGesture(g);
    if (gestureTimerRef.current) clearTimeout(gestureTimerRef.current);
    gestureTimerRef.current = setTimeout(() => {
      setGesture(null);
      landmarkCanvasRef.current?.clearLandmarks();
    }, GESTURE_CLEAR_MS);
  }, []);

  // ── VoiceFeedback lifecycle ─────────────────────────────────────────────────
  useEffect(() => {
    const feedback = new VoiceFeedback();
    voiceFeedbackRef.current = feedback;

    const unsub = feedback.on((event) => {
      if (event.type === 'speaking') {
        addLine(event.text, true, 'jarvis');
      }
    });

    return () => {
      unsub();
      feedback.cancel();
      voiceFeedbackRef.current = null;
    };
  }, [addLine]);

  // ── VoiceEngine lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    const engine = new VoiceEngine();

    const unsub = engine.on((event) => {
      switch (event.type) {
        case 'stateChange':
          setAgentState(event.state as AgentState);
          break;

        case 'wakeWordDetected':
          setAgentState('awake');
          showToast('listening');
          break;

        case 'transcript':
          if (event.isFinal) {
            addLine(event.text, true, 'user');
            // Show "ignored" toast when final transcript arrives while still listening
            // (i.e. wake word was not detected in this utterance)
            if (engine.getState() === 'listening') {
              showToast('ignored');
            }
          }
          break;

        case 'commandReady':
          setAgentState('processing');
          addLine(event.text, true, 'user');
          showToast('command_accepted');
          // Send voice command to orchestrator for intent parsing + execution
          sendCommandToOrchestrator(event.text);
          setTimeout(() => {
            setAgentState((prev) => (prev === 'processing' ? 'listening' : prev));
          }, 2000);
          break;

        case 'error':
          setAgentState('error');
          console.error('[JARVIS] VoiceEngine error:', event.error);
          break;
      }
    });

    engine.start().catch((err: unknown) => {
      console.error('[JARVIS] VoiceEngine failed to start:', err);
    });

    return () => {
      unsub();
      engine.stop();
    };
  }, [addLine, sendCommandToOrchestrator, showToast]);

  // ── Socket events ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onConnect = () => {
      setProjectId('jarvis-default');
    };

    const onProjectSelected = (data: { projectId: string; projectName?: string }) => {
      console.log('[JARVIS] project_selected:', data);
      setProjectId(data.projectId);
      setProjectName(data.projectName ?? null);
      voiceFeedbackRef.current?.speak(`Project activated: ${data.projectName ?? data.projectId}.`);
    };

    const onTaskStatus = (data: { taskId: string; status: TaskStatus; message?: string }) => {
      console.log('[JARVIS] task_status:', data);
      updateTask(data.taskId, data.status);

      if (data.status === 'completed' && data.message) {
        addLine(data.message, true, 'jarvis');
        voiceFeedbackRef.current?.speak(data.message);
      } else if (data.status === 'failed' && data.message) {
        addLine(`Error: ${data.message}`, true, 'jarvis');
        voiceFeedbackRef.current?.speak(`Task failed: ${data.message}`);
      }
    };

    const onCommandResult = (data: Record<string, unknown>) => {
      console.log('[JARVIS] command_result:', data);
      const parsed = data.parsed as { intent?: string; entities?: Record<string, string> } | undefined;
      const message = String(data.message ?? data.response ?? '');
      const success = data.success !== false;
      const intent = parsed?.intent ?? 'unknown';

      // Update task if we can match by intent
      if (success && message) {
        addLine(message, true, 'jarvis');
        voiceFeedbackRef.current?.speak(message);
      }

      // Handle project changes from backend
      if (intent === 'set_project' && parsed?.entities?.project) {
        setProjectId(parsed.entities.project);
        setProjectName(parsed.entities.project);
      }
    };

    const onVoiceResponse = (data: { text: string; speak?: boolean }) => {
      console.log('[JARVIS] voice_response:', data);
      addLine(data.text, true, 'jarvis');
      if (data.speak !== false) {
        voiceFeedbackRef.current?.speak(data.text);
      }
    };

    const handleTaskReplay = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      const title = String(detail.title ?? detail.task ?? '');
      if (title) addLine(title, true, 'jarvis');
    };

    socket.on('connect', onConnect);
    socket.on('project_selected', onProjectSelected);
    socket.on('task_status', onTaskStatus);
    socket.on('command_result', onCommandResult);
    socket.on('voice_response', onVoiceResponse);
    document.addEventListener('jarvis:task_replay', handleTaskReplay);

    return () => {
      socket.off('connect', onConnect);
      socket.off('project_selected', onProjectSelected);
      socket.off('task_status', onTaskStatus);
      socket.off('command_result', onCommandResult);
      socket.off('voice_response', onVoiceResponse);
      document.removeEventListener('jarvis:task_replay', handleTaskReplay);
    };
  }, [addLine, updateTask]);

  // ── Gesture mode toggle (G key) ──────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'g' || e.key === 'G') {
        gestureModeRef.current = !gestureModeRef.current;
        document.body.style.cursor = gestureModeRef.current ? 'none' : '';
        emitGestureMode(gestureModeRef.current);
      }
    };
    const onBlur = () => {
      gestureModeRef.current = false;
      document.body.style.cursor = '';
      emitGestureMode(false);
    };

    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
      document.body.style.cursor = '';
    };
  }, []);

  // ── Cleanup gesture timer on unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (gestureTimerRef.current) clearTimeout(gestureTimerRef.current);
    };
  }, []);

  // ── GraphController lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    const controller = new GraphController();
    controller.start();
    graphControllerRef.current = controller;
    return () => {
      controller.stop();
      graphControllerRef.current = null;
    };
  }, []);

  // ── Demo / Simulation Mode (?demo=true) ────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === 'true') {
      console.log('[JARVIS] Running in Demo Simulation Mode');
      setProjectId('demo-project');
      setProjectName('Autonomous Workspace Demo');
      setAgentState('awake');

      // Populate sample initial transcript & task
      addLine('jarvis activate autonomous graph exploration', true, 'user');
      const sampleTaskId = addTask('create_task', 'Exploring knowledge base & indexing notes', 'submitted');
      setTimeout(() => updateTask(sampleTaskId, 'processing'), 1500);
      setTimeout(() => updateTask(sampleTaskId, 'completed'), 4000);

      const simulator = new DemoSimulator({
        onLandmarks: (lms) => {
          handleLandmarks(lms);
          landmarkCanvasRef.current?.setLandmarks(lms);
        },
        onGesture: (g) => {
          handleGesture(g);
        },
      });
      simulator.start();

      return () => {
        simulator.stop();
      };
    }
  }, [addLine, addTask, updateTask, handleLandmarks, handleGesture]);

  return (
    <>
      {/* Three.js gesture trail — owns camera + GestureEngine, no reinit */}
      <GestureTrailCanvas
        onGesture={handleGesture}
        onVideoReady={handleVideoReady}
        onLandmarks={handleLandmarks}
        onHandLost={handleHandLost}
        onEngineReady={handleEngineReady}
      />

      {/* 2D canvas — 21 landmarks + cursor tracking at 30fps */}
      <LandmarkCanvas ref={landmarkCanvasRef} />

      {/* Floating webcam preview — mirrors stream, no second getUserMedia */}
      <CameraPreview sourceVideo={sourceVideo} />

      {/* Gesture class badge — bottom-right */}
      <GestureOverlay gesture={gesture} />

      {/* Voice status toast — bottom-center */}
      <VoiceStatusToast kind={voiceToast?.kind ?? null} key={voiceToast?.seq} />

      {/* HUD overlay — agent status, project badge, voice transcript, task pipeline + gesture HUD */}
      <HUD
        agentState={agentState}
        projectId={projectId}
        projectName={projectName}
        transcriptLines={transcriptLines}
        tasks={tasks}
        gestureSlot={<GestureHUD gesture={gesture} />}
      />

      {/* Phase 5: Dev panel for gesture sensitivity tuning (DEV mode only) */}
      {gestureEngine && <GestureDevPanel engine={gestureEngine} />}
    </>
  );
}

export default App;
