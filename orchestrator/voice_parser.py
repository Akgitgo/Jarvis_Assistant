"""
voice_parser.py — JARVIS voice transcript parser

All voice commands are routed directly to Paperclip task creation.
No LLM/OpenAI calls are made.

Wake word validation is handled by the frontend; backend trusts all incoming
transcripts.
"""

from __future__ import annotations

import logging
from typing import TypedDict

logger = logging.getLogger(__name__)


class ParsedIntent(TypedDict):
    intent: str
    entities: dict
    raw: str


async def parse(transcript: str) -> ParsedIntent | None:
    """Parse a voice transcript into a create_task intent (no LLM).

    Trusts that the frontend has already validated the wake word.

    Raises:
        ValueError: if transcript is empty.
    """
    transcript = transcript.strip()
    if not transcript:
        raise ValueError("transcript must not be empty")

    print("VOICE COMMAND ACCEPTED:", transcript)

    return ParsedIntent(
        intent="create_task",
        entities={"title": transcript},
        raw=transcript,
    )
