"""Voyage AI embeddings client (docs/decisions.md: embedding similarity is
the baseline confidence-threshold mechanism)."""

from __future__ import annotations

import voyageai

from landfall_pipeline.config import EMBEDDING_MODEL, voyage_api_key


class EmbeddingClient:
    def __init__(self) -> None:
        self._client = voyageai.Client(api_key=voyage_api_key())

    def embed(self, texts: list[str], input_type: str) -> list[list[float]]:
        """input_type is "document" for chunks going into the index, or
        "query" for a step's claim being scored against it — Voyage's
        asymmetric models expect this distinction for best results."""
        if not texts:
            return []
        result = self._client.embed(texts, model=EMBEDDING_MODEL, input_type=input_type)
        return result.embeddings
