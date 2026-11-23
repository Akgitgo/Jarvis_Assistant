"""
obsidian_bridge.py — HTTP client for obsidian-local-rest-api (port 27123)

Wraps the obsidian-local-rest-api endpoints:
  GET  /vault/{path}          read a note
  PUT  /vault/{path}          create or overwrite a note
  POST /vault/{path}          append to a note
  DELETE /vault/{path}        delete a note
  POST /search/simple/        full-text search
  GET  /active/               get the active note
  POST /commands/execute/     execute an Obsidian command

Requires OBSIDIAN_API_KEY env var (set in Obsidian plugin settings).
"""

import logging
import os
from typing import Optional
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

OBSIDIAN_HOST = os.environ.get("OBSIDIAN_HOST", "http://127.0.0.1")
OBSIDIAN_PORT = int(os.environ.get("OBSIDIAN_PORT", "27123"))
OBSIDIAN_API_KEY = os.environ.get("OBSIDIAN_API_KEY", "")

BASE_URL = f"{OBSIDIAN_HOST}:{OBSIDIAN_PORT}"
REQUEST_TIMEOUT = 10.0


def _headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if OBSIDIAN_API_KEY:
        headers["Authorization"] = f"Bearer {OBSIDIAN_API_KEY}"
    return headers


def _encode_path(vault_path: str) -> str:
    """URL-encode each segment of a vault path, preserving slashes."""
    return "/".join(quote(segment, safe="") for segment in vault_path.split("/"))


# ── Note CRUD ─────────────────────────────────────────────────────────────────

def read_note(vault_path: str) -> str:
    """Return the raw markdown content of a note. Raises on HTTP error."""
    url = f"{BASE_URL}/vault/{_encode_path(vault_path)}"
    try:
        response = httpx.get(url, headers=_headers(), timeout=REQUEST_TIMEOUT, verify=False)
        response.raise_for_status()
        return response.text
    except httpx.HTTPError as exc:
        logger.error("read_note(%r) failed: %s", vault_path, exc)
        raise


def write_note(vault_path: str, content: str) -> None:
    """Create or overwrite a note with *content*."""
    url = f"{BASE_URL}/vault/{_encode_path(vault_path)}"
    try:
        response = httpx.put(
            url,
            content=content.encode("utf-8"),
            headers={**_headers(), "Content-Type": "text/markdown"},
            timeout=REQUEST_TIMEOUT,
            verify=False,
        )
        response.raise_for_status()
        logger.info("write_note(%r) OK", vault_path)
    except httpx.HTTPError as exc:
        logger.error("write_note(%r) failed: %s", vault_path, exc)
        raise


def append_to_note(vault_path: str, content: str) -> None:
    """Append *content* to an existing note (creates it if absent)."""
    url = f"{BASE_URL}/vault/{_encode_path(vault_path)}"
    try:
        response = httpx.post(
            url,
            content=content.encode("utf-8"),
            headers={**_headers(), "Content-Type": "text/markdown"},
            timeout=REQUEST_TIMEOUT,
            verify=False,
        )
        response.raise_for_status()
        logger.info("append_to_note(%r) OK", vault_path)
    except httpx.HTTPError as exc:
        logger.error("append_to_note(%r) failed: %s", vault_path, exc)
        raise


def delete_note(vault_path: str) -> None:
    """Delete a note from the vault."""
    url = f"{BASE_URL}/vault/{_encode_path(vault_path)}"
    try:
        response = httpx.delete(url, headers=_headers(), timeout=REQUEST_TIMEOUT, verify=False)
        response.raise_for_status()
        logger.info("delete_note(%r) OK", vault_path)
    except httpx.HTTPError as exc:
        logger.error("delete_note(%r) failed: %s", vault_path, exc)
        raise


# ── Search ────────────────────────────────────────────────────────────────────

def search(query: str, context_length: int = 100) -> list[dict]:
    """
    Full-text search across the vault.
    Returns a list of dicts: {filename, score, matches: [{context, match}]}.
    """
    url = f"{BASE_URL}/search/simple/"
    try:
        response = httpx.post(
            url,
            json={"query": query, "contextLength": context_length},
            headers=_headers(),
            timeout=REQUEST_TIMEOUT,
            verify=False,
        )
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, list) else data.get("results", [])
    except httpx.HTTPError as exc:
        logger.error("search(%r) failed: %s", query, exc)
        raise


# ── Active note ───────────────────────────────────────────────────────────────

def get_active_note() -> Optional[dict]:
    """
    Return metadata + content for the currently open note in Obsidian.
    Returns None if nothing is open.
    """
    url = f"{BASE_URL}/active/"
    try:
        response = httpx.get(url, headers=_headers(), timeout=REQUEST_TIMEOUT, verify=False)
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        logger.error("get_active_note() failed: %s", exc)
        raise


# ── Commands ──────────────────────────────────────────────────────────────────

def execute_command(command_id: str) -> dict:
    """
    Execute an Obsidian command by its id (e.g. 'editor:save-file').
    Returns the API response dict.
    """
    url = f"{BASE_URL}/commands/execute/"
    try:
        response = httpx.post(
            url,
            json={"commandId": command_id},
            headers=_headers(),
            timeout=REQUEST_TIMEOUT,
            verify=False,
        )
        response.raise_for_status()
        logger.info("execute_command(%r) OK", command_id)
        return response.json()
    except httpx.HTTPError as exc:
        logger.error("execute_command(%r) failed: %s", command_id, exc)
        raise
