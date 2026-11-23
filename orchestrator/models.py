"""
models.py — JARVIS shared Pydantic models

Centralised request/response schemas used across main.py and other modules.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class VoiceParseRequest(BaseModel):
    transcript: str = Field(..., description="Raw speech transcript to parse")


class VoiceParseResponse(BaseModel):
    intent: str = Field(..., description="Parsed intent label")
    entities: dict = Field(default_factory=dict, description="Extracted entities")
    raw: str = Field(..., description="Original transcript unchanged")


class TaskPayload(BaseModel):
    task_id: str = Field(..., description="Unique task identifier")
    intent: str = Field(..., description="Intent that generated this task")
    entities: dict = Field(default_factory=dict, description="Intent entities")
    project_id: str | None = Field(None, description="Active project id when task was created")


class AgentStatusUpdate(BaseModel):
    agent_id: str = Field(..., description="Agent identifier")
    status: str = Field(..., description="New status string")
