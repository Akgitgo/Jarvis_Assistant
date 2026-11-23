"""
intent_router.py — JARVIS voice intent routing

Maps parsed voice intents to concrete backend actions:
  - create_task  -> create a Paperclip issue
  - check_status -> search/poll Paperclip issues
  - set_project  -> update the active project in Redis state
  - open_note    -> emit obsidian open command via Socket.IO
  - search_vault -> emit obsidian search via Socket.IO
  - unknown      -> return helpful error

Each handler returns a result dict that the caller (main.py) can
forward to the frontend HUD and/or Obsidian plugin.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Callable, Awaitable

import paperclip_client
import state

logger = logging.getLogger(__name__)

# Type for route handlers
RouteHandler = Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]

# Registry of intent -> handler
_routes: dict[str, RouteHandler] = {}


def route(intent: str):
    """Decorator to register an intent handler."""
    def decorator(fn: RouteHandler) -> RouteHandler:
        _routes[intent] = fn
        return fn
    return decorator


async def dispatch(intent: str, entities: dict[str, Any], raw: str) -> dict[str, Any]:
    """Route a parsed intent to its handler and return the result.

    Returns a dict with at least:
      - success (bool)
      - intent (str)
      - message (str)  — human-readable result for HUD / voice feedback
    """
    handler = _routes.get(intent)
    if handler is None:
        return {
            "success": False,
            "intent": intent,
            "message": f"I don't know how to handle the intent '{intent}'. Try rephrasing.",
        }

    try:
        result = await handler({"intent": intent, "entities": entities, "raw": raw})
        result.setdefault("success", True)
        result.setdefault("intent", intent)
        return result
    except Exception as exc:
        logger.error("Intent handler for '%s' failed: %s", intent, exc)
        return {
            "success": False,
            "intent": intent,
            "message": f"Error executing '{intent}': {exc}",
        }


# ── Intent Handlers ──────────────────────────────────────────────────────────


@route("create_task")
async def handle_create_task(ctx: dict[str, Any]) -> dict[str, Any]:
    """Create a Paperclip issue from voice command."""
    entities = ctx["entities"]
    title = entities.get("title") or entities.get("task") or ctx["raw"]
    description = entities.get("description", "")
    priority = entities.get("priority", "medium")
    project_id = entities.get("project_id") or state.get_active_project()

    ceo_agent_id = os.environ.get("PAPERCLIP_CEO_AGENT_ID")
    issue = await paperclip_client.create_issue(
        title=title,
        description=f"Created via JARVIS voice command.\n\nOriginal: {ctx['raw']}",
        priority=priority,
        project_id=project_id,
        assignee_agent_id=ceo_agent_id,
    )

    identifier = issue.get("identifier", issue.get("id", "unknown"))
    return {
        "message": f"Task {identifier} created: {title}",
        "issue": issue,
    }


@route("check_status")
async def handle_check_status(ctx: dict[str, Any]) -> dict[str, Any]:
    """Check status of Paperclip issues matching a query."""
    entities = ctx["entities"]
    query = entities.get("query") or entities.get("task") or entities.get("project") or ""
    status_filter = entities.get("status")

    if not query:
        return {
            "success": False,
            "message": "What task or project should I check the status of?",
        }

    issues = await paperclip_client.search_issues(query, status=status_filter)
    if not issues:
        return {"message": f"No issues found matching '{query}'."}

    summaries = []
    for iss in issues[:5]:
        summaries.append(f"- {iss.get('identifier', '?')}: {iss.get('title', '?')} [{iss.get('status', '?')}]")

    return {
        "message": f"Found {len(issues)} issue(s):\n" + "\n".join(summaries),
        "issues": issues[:5],
    }


@route("set_project")
async def handle_set_project(ctx: dict[str, Any]) -> dict[str, Any]:
    """Set the active project by name or id."""
    entities = ctx["entities"]
    project_name = entities.get("project") or entities.get("name") or ""

    if not project_name:
        return {
            "success": False,
            "message": "Which project should I set as active?",
        }

    # Try to find the project in Paperclip
    try:
        projects = await paperclip_client.list_projects()
        match = None
        for p in projects:
            if project_name.lower() in (p.get("name", "").lower(), p.get("id", "").lower()):
                match = p
                break
            if project_name.lower() in p.get("name", "").lower():
                match = p
                break

        if match:
            state.set_active_project(match["id"])
            return {"message": f"Active project set to '{match['name']}'."}
        else:
            # Fall back to using the name as the project id
            state.set_active_project(project_name)
            return {"message": f"Active project set to '{project_name}' (not found in Paperclip, stored as-is)."}
    except Exception:
        # Redis-only fallback if Paperclip API is unreachable
        state.set_active_project(project_name)
        return {"message": f"Active project set to '{project_name}' (Paperclip unavailable, stored locally)."}


@route("open_note")
async def handle_open_note(ctx: dict[str, Any]) -> dict[str, Any]:
    """Signal frontend/Obsidian to open a specific note."""
    entities = ctx["entities"]
    note = entities.get("note") or entities.get("name") or ""

    if not note:
        return {
            "success": False,
            "message": "Which note should I open?",
        }

    # The actual Obsidian open is handled via Socket.IO emit from main.py
    return {
        "message": f"Opening note: {note}",
        "action": "obsidian_open",
        "note": note,
    }


@route("search_vault")
async def handle_search_vault(ctx: dict[str, Any]) -> dict[str, Any]:
    """Signal frontend/Obsidian to search the vault."""
    entities = ctx["entities"]
    query = entities.get("query") or entities.get("search") or ""

    if not query:
        return {
            "success": False,
            "message": "What should I search for in the vault?",
        }

    return {
        "message": f"Searching vault for: {query}",
        "action": "obsidian_search",
        "query": query,
    }


@route("list_tasks")
async def handle_list_tasks(ctx: dict[str, Any]) -> dict[str, Any]:
    """List recent/active tasks from Paperclip."""
    issues = await paperclip_client.search_issues("", status="todo,in_progress")

    if not issues:
        return {"message": "No active tasks found."}

    summaries = []
    for iss in issues[:5]:
        summaries.append(f"- {iss.get('identifier', '?')}: {iss.get('title', '?')} [{iss.get('status', '?')}]")

    return {
        "message": f"{len(issues)} active task(s):\n" + "\n".join(summaries),
        "issues": issues[:5],
    }


def get_supported_intents() -> list[str]:
    """Return the list of registered intent names."""
    return sorted(_routes.keys())
