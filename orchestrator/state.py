"""
state.py — JARVIS Redis state manager

Keys managed:
  jarvis:active_project   STRING  currently active project id
  jarvis:task_queue       LIST    pending task payloads (JSON strings, LPUSH / RPOP)
  jarvis:agent_status     HASH    agent_id -> status string
"""

import json
import logging
import os
from typing import Optional

import redis

logger = logging.getLogger(__name__)

_client: Optional[redis.Redis] = None

KEY_ACTIVE_PROJECT = "jarvis:active_project"
KEY_TASK_QUEUE = "jarvis:task_queue"
KEY_AGENT_STATUS = "jarvis:agent_status"


def get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis(host=os.environ.get("REDIS_HOST", "localhost"), port=int(os.environ.get("REDIS_PORT", "6379")), decode_responses=True)
        try:
            _client.ping()
            logger.info("Redis state manager connected on localhost:6379")
        except redis.ConnectionError as exc:
            logger.error("Redis connection failed: %s", exc)
            raise
    return _client


# ── active_project ────────────────────────────────────────────────────────────

def set_active_project(project_id: str) -> None:
    """Set the currently active project."""
    try:
        get_client().set(KEY_ACTIVE_PROJECT, project_id)
        logger.info("active_project set to %r", project_id)
    except redis.RedisError as exc:
        logger.error("set_active_project failed: %s", exc)
        raise


def get_active_project() -> Optional[str]:
    """Return the currently active project id, or None if not set."""
    try:
        return get_client().get(KEY_ACTIVE_PROJECT)
    except redis.RedisError as exc:
        logger.error("get_active_project failed: %s", exc)
        raise


def clear_active_project() -> None:
    """Clear the active project key."""
    try:
        get_client().delete(KEY_ACTIVE_PROJECT)
        logger.info("active_project cleared")
    except redis.RedisError as exc:
        logger.error("clear_active_project failed: %s", exc)
        raise


# ── task_queue ────────────────────────────────────────────────────────────────

def enqueue_task(task: dict) -> int:
    """Push a task dict to the left of the queue. Returns new queue length."""
    try:
        length = get_client().lpush(KEY_TASK_QUEUE, json.dumps(task))
        logger.info("task enqueued (queue length=%d): %s", length, task)
        return length
    except redis.RedisError as exc:
        logger.error("enqueue_task failed: %s", exc)
        raise


def dequeue_task() -> Optional[dict]:
    """Pop and return the next task from the right of the queue, or None if empty."""
    try:
        raw = get_client().rpop(KEY_TASK_QUEUE)
        if raw is None:
            return None
        task = json.loads(raw)
        logger.info("task dequeued: %s", task)
        return task
    except (redis.RedisError, json.JSONDecodeError) as exc:
        logger.error("dequeue_task failed: %s", exc)
        raise


def peek_tasks(count: int = 10) -> list[dict]:
    """Return up to *count* tasks from the queue without removing them (oldest first)."""
    try:
        items = get_client().lrange(KEY_TASK_QUEUE, -count, -1)
        return [json.loads(i) for i in reversed(items)]
    except (redis.RedisError, json.JSONDecodeError) as exc:
        logger.error("peek_tasks failed: %s", exc)
        raise


def queue_length() -> int:
    """Return the current task queue length."""
    try:
        return get_client().llen(KEY_TASK_QUEUE)
    except redis.RedisError as exc:
        logger.error("queue_length failed: %s", exc)
        raise


def drain_task_queue() -> list[dict]:
    """Atomically pop and return ALL tasks from the queue (oldest first).

    Uses a pipeline to RPOP every item in a single round-trip.  Returns an
    empty list if the queue is empty or Redis is unavailable.
    """
    try:
        client = get_client()
        length = client.llen(KEY_TASK_QUEUE)
        if length == 0:
            return []
        pipe = client.pipeline(transaction=True)
        for _ in range(length):
            pipe.rpop(KEY_TASK_QUEUE)
        raw_items = pipe.execute()
        tasks = [json.loads(raw) for raw in raw_items if raw is not None]
        logger.info("task_queue drained: %d task(s)", len(tasks))
        return tasks
    except (redis.RedisError, json.JSONDecodeError) as exc:
        logger.error("drain_task_queue failed: %s", exc)
        raise


def clear_task_queue() -> None:
    """Remove all tasks from the queue."""
    try:
        get_client().delete(KEY_TASK_QUEUE)
        logger.info("task_queue cleared")
    except redis.RedisError as exc:
        logger.error("clear_task_queue failed: %s", exc)
        raise


# ── agent_status ──────────────────────────────────────────────────────────────

def set_agent_status(agent_id: str, status: str) -> None:
    """Set the status for a specific agent."""
    try:
        get_client().hset(KEY_AGENT_STATUS, agent_id, status)
        logger.info("agent_status[%s] = %r", agent_id, status)
    except redis.RedisError as exc:
        logger.error("set_agent_status failed: %s", exc)
        raise


def get_agent_status(agent_id: str) -> Optional[str]:
    """Return the status for a specific agent, or None if not set."""
    try:
        return get_client().hget(KEY_AGENT_STATUS, agent_id)
    except redis.RedisError as exc:
        logger.error("get_agent_status failed: %s", exc)
        raise


def get_all_agent_statuses() -> dict[str, str]:
    """Return all agent statuses as a dict."""
    try:
        return get_client().hgetall(KEY_AGENT_STATUS)
    except redis.RedisError as exc:
        logger.error("get_all_agent_statuses failed: %s", exc)
        raise


def remove_agent_status(agent_id: str) -> None:
    """Remove a specific agent's status entry."""
    try:
        get_client().hdel(KEY_AGENT_STATUS, agent_id)
        logger.info("agent_status[%s] removed", agent_id)
    except redis.RedisError as exc:
        logger.error("remove_agent_status failed: %s", exc)
        raise


def clear_agent_statuses() -> None:
    """Remove all agent status entries."""
    try:
        get_client().delete(KEY_AGENT_STATUS)
        logger.info("agent_status cleared")
    except redis.RedisError as exc:
        logger.error("clear_agent_statuses failed: %s", exc)
        raise
