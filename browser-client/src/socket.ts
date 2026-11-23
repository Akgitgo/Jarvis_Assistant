import { io, Socket } from 'socket.io-client';

const ORCHESTRATOR_HOST = window.location.hostname || 'localhost';
const ORCHESTRATOR_PORT = 8000;
const ORCHESTRATOR_URL = `http://${ORCHESTRATOR_HOST}:${ORCHESTRATOR_PORT}`;
const NAMESPACE = '/jarvis';

const WAKE_RECONNECT_DELAY_MS = 250;
const CONNECTION_ERROR_LOG_INTERVAL_MS = 30_000;

let lastConnectionErrorLog = 0;
let connectionErrorCount = 0;

const socket: Socket = io(`${ORCHESTRATOR_URL}${NAMESPACE}`, {
  reconnection: true,
  reconnectionAttempts: 3,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 4000,
  autoConnect: true,
  timeout: 5000,
  transports: ['websocket', 'polling'],
});

// TEMP DEBUG (remove later)
;(window as any).socket = socket;

socket.on('connect', () => {
  console.log('[JARVIS] Socket connected:', socket.id);
  connectionErrorCount = 0;
  lastConnectionErrorLog = 0;
  document.dispatchEvent(new CustomEvent('jarvis:connection', { detail: { connected: true } }));

  const payload = {
    projectId: 'jarvis-default',
    timestamp: Date.now(),
  };

  socket.emit('project_activated', payload);
  console.log('[JARVIS] Emitted project_activated:', payload);

  socket.emit('client_reconnect', { timestamp: Date.now() });

  // Fix 4: Ensure cursor pipeline is active on connect so the backend
  // processes gesture cursor commands from the first frame.
  socket.emit('gesture_mode', { active: true });
  console.log('[JARVIS] Emitted gesture_mode: active');

  // TEMP DEBUG: verify os_mouse_command routing — remove after confirmed
  socket.emit('os_mouse_command', { action: 'move', x: 0.5, y: 0.5 });
  console.log('[JARVIS] Emitted test os_mouse_command move (0.5, 0.5)');
});

socket.on('disconnect', (reason: string) => {
  console.warn('[JARVIS] Socket disconnected:', reason);
  document.dispatchEvent(new CustomEvent('jarvis:connection', { detail: { connected: false } }));
});

socket.io.on('reconnect_failed', () => {
  console.warn(
    '[JARVIS] Backend unreachable after 3 retries — continuing in offline mode (gesture/cursor still active)'
  );
  document.dispatchEvent(
    new CustomEvent('jarvis:connection', { detail: { connected: false, offline: true } })
  );
});

socket.on('connect_error', (err: Error) => {
  connectionErrorCount++;
  const now = Date.now();
  if (err.message.includes('ECONNREFUSED') || err.message.includes('xhr poll error')) {
    // Only log periodically to avoid console spam during extended outages
    if (now - lastConnectionErrorLog >= CONNECTION_ERROR_LOG_INTERVAL_MS) {
      console.warn(
        `[JARVIS] Orchestrator not reachable at ${ORCHESTRATOR_URL} — retrying (attempt ${connectionErrorCount})`
      );
      lastConnectionErrorLog = now;
    }
  } else {
    console.error('[JARVIS] Connection error:', err.message);
  }
});

socket.on('task_replay', (task: Record<string, unknown>) => {
  console.log('[JARVIS] task_replay received:', task);
  document.dispatchEvent(new CustomEvent('jarvis:task_replay', { detail: task }));
});


// 🔥 ── NEW: Obsidian → Browser → Backend bridge ───────────────────────────────

window.addEventListener('message', (event) => {
  if (event.data?.type === 'JARVIS_PROJECT_SELECTED') {
    console.log('[JARVIS] Project selected from Obsidian:', event.data.projectId);

    socket.emit('project_activated', {
      projectId: event.data.projectId,
      timestamp: Date.now(),
    });
  }
});


// ── Sleep / wake reconnect ────────────────────────────────────────────────────

function reconnectOnWake(): void {
  if (!socket.connected) {
    console.log('[JARVIS] Wake detected — reconnecting socket');
    setTimeout(() => {
      if (!socket.connected) {
        // Reset reconnection state so the 3-retry backoff starts fresh
        socket.io.opts.reconnection = true;
        socket.connect();
      }
    }, WAKE_RECONNECT_DELAY_MS);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    reconnectOnWake();
  }
});

window.addEventListener('online', reconnectOnWake);

export { socket };