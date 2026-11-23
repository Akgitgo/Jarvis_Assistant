import asyncio
import json
import logging
import os
import time

import pyautogui
import pygetwindow as gw
import pyperclip
import redis
import socketio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import paperclip_client
import state

_CEO_AGENT_ID = os.environ.get("PAPERCLIP_CEO_AGENT_ID")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# pyautogui config
pyautogui.FAILSAFE = True
screen_width, screen_height = pyautogui.size()

# Scroll amounts for gesture-based scroll/zoom actions
_SCROLL_AMOUNT = 3
_ZOOM_SCROLL_AMOUNT = 5

# ── Gesture mode state ───────────────────────────────────────────────────────
_gesture_mode_active: bool = False


# ── WebSocket receive-rate monitor ────────────────────────────────────────────
_msg_count = 0
_msg_window_start = time.monotonic()
_MSG_LOG_INTERVAL = 5.0  # seconds


def _tick_rate_monitor() -> None:
    """Increment message counter and log throughput every _MSG_LOG_INTERVAL seconds."""
    global _msg_count, _msg_window_start
    _msg_count += 1
    now = time.monotonic()
    elapsed = now - _msg_window_start
    if elapsed >= _MSG_LOG_INTERVAL:
        rate = _msg_count / elapsed
        logger.info("os_mouse_command rate: %.1f msg/s over %.0fs", rate, elapsed)
        _msg_count = 0
        _msg_window_start = now


# Redis client
try:
    redis_client = redis.Redis(host=os.environ.get("REDIS_HOST", "localhost"), port=int(os.environ.get("REDIS_PORT", "6379")), decode_responses=True)
    redis_client.ping()
    logger.info("Redis connected on localhost:6379")
except redis.ConnectionError as e:
    logger.warning("Redis not available: %s", e)
    redis_client = None

# Socket.IO server
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)

# FastAPI app (REST routes only)
fastapi_app = FastAPI(title="JARVIS Orchestrator")

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@fastapi_app.get("/health")
async def health():
    return {"status": "ok"}


# ── /voice/parse ───────────────────────────────────────────────────────────────

class VoiceParseRequest(BaseModel):
    transcript: str


class VoiceParseResponse(BaseModel):
    intent: str
    entities: dict
    raw: str


@fastapi_app.post("/voice/parse", response_model=VoiceParseResponse)
async def voice_parse(body: VoiceParseRequest):
    """Parse a voice transcript into a create_task intent (no LLM).

    Trusts that the frontend has already validated the wake word.
    """
    if not body.transcript.strip():
        raise HTTPException(status_code=400, detail="transcript must not be empty")

    transcript = body.transcript.strip()
    print("VOICE COMMAND ACCEPTED:", transcript)
    return VoiceParseResponse(
        intent="create_task",
        entities={"title": transcript} if transcript else {},
        raw=body.transcript,
    )


# ── /voice/command — create Paperclip task directly ──────────────────────────

@fastapi_app.post("/voice/command")
async def voice_command(body: VoiceParseRequest):
    """Create a Paperclip task directly from a voice transcript (no LLM).

    Trusts that the frontend has already validated the wake word.
    """
    transcript = body.transcript.strip()
    if not transcript:
        raise HTTPException(status_code=400, detail="transcript must not be empty")

    print("VOICE COMMAND ACCEPTED:", transcript)

    try:
        issue = await paperclip_client.create_issue(
            title=transcript,
            description=transcript,
            assignee_agent_id=_CEO_AGENT_ID,
        )
        result = {"success": True, "message": "Task created", "data": issue}
        try:
            await sio.emit("command_result", result, namespace="/jarvis")
        except Exception as exc:
            logger.error("Failed to emit command_result: %s", exc)
        return result
    except Exception as exc:
        logger.error("voice_command failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# ── /tasks endpoints — direct Paperclip operations ───────────────────────────

class CreateTaskRequest(BaseModel):
    title: str
    description: str = ""
    priority: str = "medium"
    project_id: str | None = None


@fastapi_app.post("/tasks/create")
async def create_task(body: CreateTaskRequest):
    """Create a Paperclip issue directly (non-voice path)."""
    project_id = body.project_id or state.get_active_project()
    try:
        issue = await paperclip_client.create_issue(
            title=body.title,
            description=body.description,
            priority=body.priority,
            project_id=project_id,
            assignee_agent_id=_CEO_AGENT_ID,
        )
        await sio.emit("task_created", issue, namespace="/jarvis")
        return {"success": True, "issue": issue}
    except Exception as exc:
        logger.error("create_task failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@fastapi_app.get("/tasks/search")
async def search_tasks(q: str = "", status: str | None = None):
    """Search Paperclip issues."""
    try:
        issues = await paperclip_client.search_issues(q, status=status)
        return {"success": True, "issues": issues}
    except Exception as exc:
        logger.error("search_tasks failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@fastapi_app.get("/tasks/{issue_id}")
async def get_task(issue_id: str):
    """Get a single Paperclip issue by id."""
    try:
        issue = await paperclip_client.get_issue(issue_id)
        return {"success": True, "issue": issue}
    except Exception as exc:
        logger.error("get_task failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# ── /project endpoints — active project management ───────────────────────────

class SetProjectRequest(BaseModel):
    project_id: str


@fastapi_app.post("/project/set")
async def set_project(body: SetProjectRequest):
    """Set the active project in the JARVIS state."""
    state.set_active_project(body.project_id)
    await sio.emit("project_changed", {"project_id": body.project_id}, namespace="/jarvis")
    return {"success": True, "project_id": body.project_id}


@fastapi_app.get("/project/active")
async def get_active_project():
    """Get the currently active project."""
    project_id = state.get_active_project()
    return {"project_id": project_id}


# Mount Socket.IO on top of FastAPI — uvicorn serves `app`
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app)


# ── /jarvis namespace ──────────────────────────────────────────────────────────

@sio.event(namespace="/jarvis")
async def connect(sid: str, environ: dict, auth: dict | None = None):
    logger.info("Client connected: %s", sid)


@sio.event(namespace="/jarvis")
async def disconnect(sid: str):
    logger.info("Client disconnected: %s", sid)


@sio.event(namespace="/jarvis")
async def client_reconnect(sid: str, data: dict):
    """Drain the Redis command queue and replay pending tasks to the reconnected client.

    Draining is done atomically so tasks are emitted exactly once — no duplicates.
    If the queue is empty nothing is emitted.
    """
    logger.info("client_reconnect from %s: %s", sid, data)
    if not redis_client:
        logger.warning("Redis unavailable — skipping queue flush for %s", sid)
        return

    try:
        pending = state.drain_task_queue()
    except Exception as exc:
        logger.error("Failed to drain task queue on reconnect: %s", exc)
        return

    if not pending:
        logger.info("No queued tasks to replay for %s", sid)
        return

    logger.info("Replaying %d queued task(s) to %s", len(pending), sid)
    for task in pending:
        try:
            await sio.emit("task_replay", task, to=sid, namespace="/jarvis")
        except Exception as exc:
            logger.error("task_replay emit failed for task %s: %s", task, exc)


@sio.event(namespace="/jarvis")
async def project_activated(sid: str, data: dict):
    logger.info("project_activated from %s: %s", sid, data)
    if redis_client:
        try:
            redis_client.publish("jarvis:events", json.dumps({
                "event": "project_activated",
                "payload": data,
                "sid": sid,
            }))
            logger.info("Published project_activated to Redis channel jarvis:events")
        except Exception as exc:
            logger.error("Redis publish failed: %s", exc)
    else:
        logger.warning("Redis unavailable — skipping publish")


@sio.event(namespace="/jarvis")
async def voice_command_event(sid: str, data: dict):
    """Handle voice command via Socket.IO: create Paperclip task directly (no LLM).

    Trusts that the frontend has already validated the wake word.
    """
    transcript = data.get("transcript", "")
    logger.info("voice_command from %s: %s", sid, transcript)

    if not transcript.strip():
        await sio.emit("command_result", {
            "success": False, "message": "Empty transcript",
        }, to=sid, namespace="/jarvis")
        return

    transcript = transcript.strip()
    print("VOICE COMMAND ACCEPTED:", transcript)

    try:
        result = await paperclip_client.create_issue(
            title=transcript,
            description=transcript,
            assignee_agent_id=_CEO_AGENT_ID,
        )
        await sio.emit("command_result", {"success": True, "message": "Task created", "data": result}, to=sid, namespace="/jarvis")
    except Exception as exc:
        logger.error("voice_command failed: %s", exc)
        await sio.emit("command_result", {
            "success": False, "message": str(exc),
        }, to=sid, namespace="/jarvis")


@sio.event(namespace="/jarvis")
async def gesture_mode(sid: str, data: dict):
    """Toggle gesture mode on/off. When off, all cursor moves are ignored."""
    global _gesture_mode_active
    active = bool(data.get("active", False))
    _gesture_mode_active = active
    logger.info("gesture_mode set to %s by %s", active, sid)


@sio.event(namespace="/jarvis")
async def os_mouse_command(sid: str, data: dict):
    """Handle mouse control commands from the frontend.

    Runs pyautogui calls in a thread executor so they never block the
    async event loop.  Move commands are logged at DEBUG level to avoid
    flooding at 20 fps; a periodic rate summary is logged at INFO level
    by ``_tick_rate_monitor``.
    """
    print("RAW EVENT:", data)
    action = data.get("action")
    _tick_rate_monitor()

    if action == "move":
        abs_x = int(data["x"] * screen_width)
        abs_y = int(data["y"] * screen_height)

        print("MOVE RECEIVED:", abs_x, abs_y)
        logger.debug("os_mouse_command move from %s: (%d, %d)", sid, abs_x, abs_y)
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(None, lambda: pyautogui.moveTo(abs_x, abs_y, _pause=False))
        except Exception as exc:
            logger.error("os_mouse_command move error: %s", exc)
        return

    logger.info("os_mouse_command from %s: action=%s", sid, action)

    loop = asyncio.get_running_loop()
    try:
        if action == "click_left":
            await loop.run_in_executor(None, pyautogui.doubleClick)
        elif action == "reset_view":
            await loop.run_in_executor(None, lambda: pyautogui.hotkey('ctrl', 'shift', 'c'))
        elif action == "drag_start":
            await loop.run_in_executor(None, pyautogui.mouseDown)
        elif action == "drag_end":
            await loop.run_in_executor(None, pyautogui.mouseUp)
        elif action == "scroll_up":
            await loop.run_in_executor(None, lambda: pyautogui.scroll(_SCROLL_AMOUNT))
        elif action == "scroll_down":
            await loop.run_in_executor(None, lambda: pyautogui.scroll(-_SCROLL_AMOUNT))
        elif action == "scroll_in":
            await loop.run_in_executor(None, lambda: pyautogui.scroll(_ZOOM_SCROLL_AMOUNT))
        elif action == "scroll_out":
            await loop.run_in_executor(None, lambda: pyautogui.scroll(-_ZOOM_SCROLL_AMOUNT))
        elif action == "scroll":
            await loop.run_in_executor(None, lambda: pyautogui.scroll(data.get("amount", 0)))
        else:
            logger.warning("Unknown mouse action: %s", action)
    except Exception as exc:
        logger.error("os_mouse_command error: %s", exc)


@sio.event(namespace="/jarvis")
async def voice_paste(sid: str, data: dict):
    """Paste clipboard contents into Obsidian by pressing Ctrl+V."""
    print("[JARVIS] voice_paste triggered")
    logger.info("voice_paste from %s: %s", sid, data)
    try:
        windows = gw.getWindowsWithTitle("Obsidian")
        if windows:
            windows[0].activate()
            await asyncio.sleep(0.3)
        else:
            logger.warning("No Obsidian window found — pasting into active window")
        pyautogui.hotkey("ctrl", "v")
    except Exception as exc:
        logger.error("voice_paste error: %s", exc)


# ── Transcript cleaning + dedup ───────────────────────────────────────────────

_last_sent_text: str = ""


@sio.event(namespace="/jarvis")
async def voice_type(sid: str, data: dict):
    """Type transcribed text into Obsidian via clipboard paste."""
    global _last_sent_text

    raw = data.get("text", "")
    is_final = data.get("isFinal", True)
    print(f"[JARVIS] raw: {raw}")

    cleaned = raw.strip()
    print(f"[JARVIS] cleaned: {cleaned}")

    if len(cleaned) < 3:
        logger.info("voice_type: cleaned text too short, skipping")
        return

    if cleaned == _last_sent_text:
        logger.info("voice_type: duplicate, skipping")
        return

    if not is_final:
        logger.info("voice_type: partial (isFinal=false), skipping")
        return

    _last_sent_text = cleaned
    logger.info("voice_type from %s: typing '%s'", sid, cleaned)

    try:
        windows = gw.getWindowsWithTitle("Obsidian")
        if windows:
            windows[0].activate()
            await asyncio.sleep(0.4)
        else:
            logger.warning("No Obsidian window found — typing into active window")
        pyperclip.copy(cleaned + " ")
        pyautogui.hotkey("ctrl", "v")
        pyautogui.press("space")
    except Exception as exc:
        logger.error("voice_type error: %s", exc)


# Entry point: uvicorn main:app --port 8000
# (app is the Socket.IO ASGI wrapper around fastapi_app)
