"""
paperclip_client.py — Paperclip API integration for JARVIS

Handles creating issues, polling task status, and fetching results
from the Paperclip control plane so voice commands like "create task"
or "check status" translate into real Paperclip operations.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

_API_URL = os.environ.get("PAPERCLIP_API_URL", "http://127.0.0.1:3100")
_API_KEY = os.environ.get("PAPERCLIP_API_KEY", "")
_COMPANY_ID = os.environ.get("PAPERCLIP_COMPANY_ID", "")


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {_API_KEY}",
        "Content-Type": "application/json",
    }


async def create_issue(
    title: str,
    description: str = "",
    priority: str = "medium",
    project_id: str | None = None,
    goal_id: str | None = None,
    parent_id: str | None = None,
    assignee_agent_id: str | None = None,
) -> dict[str, Any]:
    """Create a new issue in Paperclip and return the created issue object."""
    payload: dict[str, Any] = {
        "title": title,
        "description": description,
        "priority": priority,
        "status": "in_progress",
    }
    if project_id:
        payload["projectId"] = project_id
    if goal_id:
        payload["goalId"] = goal_id
    if parent_id:
        payload["parentId"] = parent_id
    if assignee_agent_id:
        payload["assigneeAgentId"] = assignee_agent_id

    url = f"{_API_URL}/api/companies/{_COMPANY_ID}/issues"
    logger.info("Assigning to agent: %s", assignee_agent_id)
    logger.info("Sending request to Paperclip: POST %s", url)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(url, headers=_headers(), json=payload)
            logger.info("Response: %s %s", resp.status_code, resp.text[:500])
            resp.raise_for_status()
            issue = resp.json()
            logger.info("Created Paperclip issue %s: %s", issue.get("identifier"), title)
            return issue
    except Exception as e:
        logger.error("Paperclip create_issue failed: %s", e)
        return {"success": False, "message": str(e)}


async def get_issue(issue_id: str) -> dict[str, Any]:
    """Fetch a single issue by id."""
    url = f"{_API_URL}/api/issues/{issue_id}"
    logger.info("Sending request to Paperclip: GET %s", url)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers=_headers())
            logger.info("Response: %s", resp.status_code)
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.error("Paperclip get_issue failed: %s", e)
        return {"success": False, "message": str(e)}


async def poll_issue_until_done(
    issue_id: str,
    interval: float = 3.0,
    max_polls: int = 60,
) -> dict[str, Any]:
    """Poll an issue until it reaches a terminal status or max_polls is hit.

    Terminal statuses: done, cancelled, blocked.
    Returns the final issue object.
    """
    terminal = {"done", "cancelled", "blocked"}
    for i in range(max_polls):
        issue = await get_issue(issue_id)
        status = issue.get("status", "unknown")
        logger.info("Poll %d/%d — issue %s status: %s", i + 1, max_polls, issue_id, status)
        if status in terminal:
            return issue
        await asyncio.sleep(interval)

    logger.warning("Polling timed out for issue %s after %d polls", issue_id, max_polls)
    return await get_issue(issue_id)


async def search_issues(query: str, status: str | None = None) -> list[dict[str, Any]]:
    """Search issues by query string, optionally filtered by status."""
    params: dict[str, str] = {"q": query}
    if status:
        params["status"] = status

    url = f"{_API_URL}/api/companies/{_COMPANY_ID}/issues"
    logger.info("Sending request to Paperclip: GET %s params=%s", url, params)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers=_headers(), params=params)
            logger.info("Response: %s", resp.status_code)
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, list) else data.get("items", data.get("issues", []))
    except Exception as e:
        logger.error("Paperclip search_issues failed: %s", e)
        return []


async def list_projects() -> list[dict[str, Any]]:
    """List all projects in the company."""
    url = f"{_API_URL}/api/companies/{_COMPANY_ID}/projects"
    logger.info("Sending request to Paperclip: GET %s", url)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers=_headers())
            logger.info("Response: %s", resp.status_code)
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, list) else data.get("items", data.get("projects", []))
    except Exception as e:
        logger.error("Paperclip list_projects failed: %s", e)
        return []


async def add_comment(issue_id: str, body: str) -> dict[str, Any]:
    """Add a comment to an issue."""
    url = f"{_API_URL}/api/issues/{issue_id}/comments"
    logger.info("Sending request to Paperclip: POST %s", url)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, headers=_headers(), json={"body": body})
            logger.info("Response: %s", resp.status_code)
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.error("Paperclip add_comment failed: %s", e)
        return {"success": False, "message": str(e)}


async def update_issue(issue_id: str, **fields: Any) -> dict[str, Any]:
    """Update an issue with the given fields."""
    url = f"{_API_URL}/api/issues/{issue_id}"
    logger.info("Sending request to Paperclip: PATCH %s", url)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.patch(url, headers=_headers(), json=fields)
            logger.info("Response: %s", resp.status_code)
            resp.raise_for_status()
            return resp.json()
    except Exception as e:
        logger.error("Paperclip update_issue failed: %s", e)
        return {"success": False, "message": str(e)}
