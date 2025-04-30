"""
Next-Topic Engine  v2.1  –  Markdown-out
----------------------------------------
Given
  • structured_summary (JSON string produced by summary_agent)
  • recent_transcript  (plain text, last N lines)
  • presentation_outline (optional PPT outline)

Return
  markdown : "* bullet1\n* bullet2…" – next things the speaker should cover
  section_title / confidence (auxiliary)
"""

from __future__ import annotations
from typing import List, Dict, Any
import json, os, logging

from fastapi import HTTPException
from pydantic import BaseModel
from openai import OpenAI, BadRequestError

logger = logging.getLogger(__name__)

# ── Pydantic Schemas ───────────────────────────────────────────────────────


class NextTopicReq(BaseModel):
    structured_summary: str  # JSON string
    recent_transcript: str  # last few minutes transcript
    presentation_outline: str | None = None  # optional


class NextTopicResp(BaseModel):
    markdown: str  # "* bullet" list
    section_title: str | None = None
    confidence: float | None = None


# ── Core Engine ────────────────────────────────────────────────────────────


class NextTopicEngine:
    def __init__(self):
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY missing")
        self.client = OpenAI(api_key=api_key)
        logger.info("NextTopicEngine ready")

    # public ---------------------------------------------------------------
    def infer(self, req: NextTopicReq) -> NextTopicResp:
        blocks = self._parse_summary(req.structured_summary)
        unfinished = self._detect_unfinished(blocks, req.recent_transcript)[:2]

        prompt = self._make_prompt(
            unfinished=unfinished,
            outline=req.presentation_outline,
            transcript=req.recent_transcript,
        )

        try:
            res = self.client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
            )
            md = res.choices[0].message.content.strip()
            title = unfinished[0]["title"] if unfinished else None
            conf = 1.0 if unfinished else 0.3
            return NextTopicResp(markdown=md, section_title=title, confidence=conf)

        except BadRequestError as e:
            logger.error(f"OpenAI error: {e}")
            raise HTTPException(status_code=500, detail="LLM call failed")

    # helpers --------------------------------------------------------------
    def _parse_summary(self, raw: str) -> List[Dict[str, str]]:
        obj = json.loads(raw)
        if not isinstance(obj, dict) or "summary" not in obj:
            raise HTTPException(status_code=400, detail="Bad structured_summary JSON")
        return obj["summary"]

    def _detect_unfinished(self, blocks, transcript) -> List[Dict[str, str]]:
        tx = transcript.lower()
        return [b for b in blocks if b["title"].lower()[:25] not in tx]

    def _make_prompt(self, *, unfinished, outline, transcript) -> str:
        summary_ctx = (
            "\n\n".join(f"### {b['title']}\n{b['content']}" for b in unfinished)
            or "（No structured summary, free-flow speech）"
        )

        outline_ctx = f"\n\n---\nPPT Outline (full):\n{outline}" if outline else ""

        prompt = f"""You are an expert speech coach.

Structured Summary (upcoming sections):
{summary_ctx}{outline_ctx}

Recent transcript (speaker just said):
\"\"\"{transcript[-1200:]}\"\"\"

**Task**

Write what the speaker should cover *next*, as 3-6 concise bullet points
(max 15 English words each). **Output strictly in Markdown bullet list**, like:

* point one
* point two
"""
        return prompt


# ── FastAPI Adapter  ───────────────────────────────────────────────────────

engine = NextTopicEngine()


def handle_next_topic(req: NextTopicReq) -> Dict[str, Any]:
    return engine.infer(req).dict()
