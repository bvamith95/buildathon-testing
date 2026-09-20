"""RAG step generation via Claude Opus 5.

Every step must cite at least one retrieved chunk above the confidence
threshold, or it ships in the no_source state with no generated prose —
there is no fallback to the model's own knowledge (docs/prd.md,
"Generation rules"; CLAUDE.md architectural constraints).

The confidence threshold itself is embedding similarity between the
step's claim and its best-matching chunk, with the per-bucket cutoff
tuned after the Week 1 pilot run (docs/decisions.md, item 1) — DEFAULT_
CONFIDENCE_THRESHOLD below is a placeholder starting point, not the
tuned value.
"""

from __future__ import annotations

import anthropic
from pydantic import BaseModel

from landfall_pipeline.config import GENERATION_MODEL, anthropic_api_key
from landfall_pipeline.generation.embeddings import EmbeddingClient
from landfall_pipeline.generation.retrieval_index import IndexedChunk, RetrievalIndex
from landfall_pipeline.store.schema import Source, Step, WhereToDo

DEFAULT_CONFIDENCE_THRESHOLD = 0.75


class GeneratedStepContent(BaseModel):
    """What Claude produces for one step, grounded in retrieved chunks.
    id/offset_days/phase/state are assigned by the pipeline, not generated."""

    title: str
    why: str
    prerequisites: list[str]
    cost: str | None
    time_estimate: str | None
    applies_to_rules: list[str]


class StepGenerator:
    def __init__(self, index: RetrievalIndex, embeddings: EmbeddingClient | None = None) -> None:
        self._client = anthropic.Anthropic(api_key=anthropic_api_key())
        self._index = index
        self._embeddings = embeddings or EmbeddingClient()

    def generate_step(
        self,
        step_id: str,
        phase: str,
        offset_days: int,
        claim_prompt: str,
        confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
    ) -> Step:
        """claim_prompt describes what the step should cover, e.g. "the SIN
        application step for a funded graduate student"."""
        [query_embedding] = self._embeddings.embed([claim_prompt], input_type="query")
        matches = self._index.search(query_embedding, top_k=5)

        if not matches or matches[0][1] < confidence_threshold:
            return self._no_source_step(step_id, phase, offset_days, claim_prompt)

        top_chunk, confidence = matches[0]
        content = self._generate_content(claim_prompt, [m[0] for m in matches])

        return Step(
            id=step_id,
            phase=phase,
            offset_days=offset_days,
            title=content.title,
            why=content.why,
            prerequisites=content.prerequisites,
            cost=content.cost,
            time_estimate=content.time_estimate,
            where=WhereToDo(label=top_chunk.chunk.title, host=_host(top_chunk.chunk.url), url=top_chunk.chunk.url),
            sources=[
                Source(
                    organisation=m.chunk.organisation,
                    title=m.chunk.title,
                    url=m.chunk.url,
                    last_verified=m.chunk.fetched_at.date(),
                )
                for m, _ in matches[:2]
            ],
            applies_to_rules=content.applies_to_rules,
            confidence=confidence,
            state="verified",
        )

    def _generate_content(self, claim_prompt: str, chunks: list[IndexedChunk]) -> GeneratedStepContent:
        context = "\n\n".join(
            f"[Source: {c.chunk.organisation} — {c.chunk.title} — {c.chunk.url}]\n{c.chunk.text}" for c in chunks
        )
        response = self._client.messages.parse(
            model=GENERATION_MODEL,
            max_tokens=2000,
            system=(
                "You write one onboarding checklist step for an admitted UBC "
                "international student. Use ONLY the provided sources — never "
                "add a fact that isn't in them. Be concise and specific."
            ),
            messages=[
                {
                    "role": "user",
                    "content": f"Task: {claim_prompt}\n\nSources:\n{context}",
                }
            ],
            output_format=GeneratedStepContent,
        )
        return response.parsed_output

    def _no_source_step(self, step_id: str, phase: str, offset_days: int, claim_prompt: str) -> Step:
        return Step(
            id=step_id,
            phase=phase,
            offset_days=offset_days,
            title=claim_prompt,
            why="We could not verify the specifics for this step against our sources.",
            where=WhereToDo(label="Official source", host="", url=""),
            confidence=0.0,
            state="no_source",
        )


def _host(url: str) -> str:
    from urllib.parse import urlparse

    return urlparse(url).netloc
