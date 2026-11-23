# JARVIS

AR/Voice-controlled AI workspace system.

- **Gesture navigation** — hand tracking via MediaPipe selects Obsidian graph nodes
- **Voice commands** — wake word "jarvis" + speech routes tasks to Paperclip agents
- **Live Obsidian sync** — agent results are written back to `.md` project files
- **HUD overlay** — React layer shows agent status, active project, voice transcript
- **3D gesture trail** — Three.js transparent canvas renders fingertip motion

## Architecture

```
Browser (React + Vite)
  GestureEngine   → MediaPipe hand tracking
  VoiceEngine     → Web Speech API / Whisper fallback
  GestureTrailCanvas → Three.js trail overlay
  HUD             → AgentStatus + ProjectBadge + TranscriptDisplay
  socket.ts       → Socket.IO /jarvis namespace

Orchestrator (FastAPI + Socket.IO)
  POST /voice/parse  → direct intent extraction (no LLM)
  Socket /jarvis     → gesture_event, project_activated, task_replay
  Redis              → task queue, event bus

Obsidian Plugin
  graph-injector.ts → highlights nodes on POINT/OPEN_PALM gesture
  note-writer.ts    → writes agent results back to .md via REST API

Paperclip Agents
  CEO → receives create_task intents, delegates to sub-agents
  Engineer / Analyst → execute and write results back to .md
```

## Requirements

- Node.js 20+
- Python 3.11+
- Redis (local or Docker)
- Obsidian with [obsidian-local-rest-api](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin

## Quick Start with JARVIS CLI

JARVIS includes a unified CLI to automate system diagnostics, environment setup, and service orchestration:

```bash
# 1. Check system requirements and port readiness
npm run jarvis doctor

# 2. Automatically configure .env, Python virtualenv, and build packages
npm run jarvis init

# 3. Launch Redis, Orchestrator (:8000), and Browser HUD (:5173) concurrently
npm run jarvis start

# 4. (Optional) Install Obsidian plugin directly into your vault
npm run jarvis obsidian-install /path/to/your/obsidian/vault
```

Interactive documentation and architecture guide available at [docs/index.html](file:///c:/Users/Admin/.paperclip/instances/default/projects/4f40d8ff-e390-4e94-9dde-8e0518e50619/e918408e-50d1-4659-af9f-339f5865cb90/_default/jarvis/docs/index.html).

---

## Manual Setup (Alternative)

```bash
cp .env.example .env
# Edit .env and fill in all required values
```

### 2. Start Redis

```bash
docker run -d -p 6379:6379 redis:7-alpine
# or: redis-server
```

### 3. Start the orchestrator

```bash
cd orchestrator
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
source ../.env && uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Start the browser client

```bash
cd browser-client
npm install
npm run dev
# Open http://localhost:5173
```

### 5. Install the Obsidian plugin (optional, for graph navigation)

```bash
cd obsidian-plugin
npm install
npm run build
# Copy the output to your vault's .obsidian/plugins/jarvis/ directory
# Enable "JARVIS" in Obsidian Settings → Community Plugins
```

### 6. Run the E2E test

```bash
# With orchestrator running
pip install httpx python-socketio
python test_e2e.py
```

## Environment Variables

See `.env.example` for the full list.

| Variable | Required | Description |
|---|---|---|
| `PAPERCLIP_API_URL` | Yes | Paperclip control plane URL |
| `PAPERCLIP_API_KEY` | Yes | Paperclip agent API key |
| `PAPERCLIP_CEO_AGENT_ID` | Yes | CEO agent ID for task delegation |
| `OBSIDIAN_API_KEY` | No | Bearer token if obsidian-local-rest-api requires auth |
| `REDIS_URL` | No | Redis connection URL (default: redis://localhost:6379) |

## Data Flow

```
Gesture → node select → project activated
Voice "jarvis, add task X" → /voice/command → Paperclip API → CEO agent
Agent result → obsidian_bridge.writeNote() → .md file updated
Obsidian auto-reloads → live dashboard
```

## Project File Structure (Mandatory)

```markdown
# Project Name

## Goal
...

## Tasks
- [ ] Task description

## Notes
...

## Updates
<!-- agent outputs appended here -->
```
