"""Local, file-based retrieval index (docs/decisions.md: "Local/file-based
vector store" — no hosted vector DB needed at this scale).

Persists chunks + embeddings as a single JSON file under DATA_DIR and does
cosine-similarity search in memory. Fine for a few thousand chunks from
four whitelisted domains, re-read once per nightly run.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass

import numpy as np

from landfall_pipeline.config import DATA_DIR
from landfall_pipeline.generation.chunker import Chunk

INDEX_PATH = os.path.join(DATA_DIR, "retrieval_index.json")


@dataclass
class IndexedChunk:
    chunk: Chunk
    embedding: list[float]


class RetrievalIndex:
    def __init__(self) -> None:
        self._items: list[IndexedChunk] = []

    def add(self, chunk: Chunk, embedding: list[float]) -> None:
        self._items.append(IndexedChunk(chunk=chunk, embedding=embedding))

    def search(self, query_embedding: list[float], top_k: int = 5) -> list[tuple[IndexedChunk, float]]:
        if not self._items:
            return []
        matrix = np.array([item.embedding for item in self._items])
        query = np.array(query_embedding)
        similarities = matrix @ query / (np.linalg.norm(matrix, axis=1) * np.linalg.norm(query) + 1e-9)
        ranked = np.argsort(-similarities)[:top_k]
        return [(self._items[i], float(similarities[i])) for i in ranked]

    def save(self, path: str = INDEX_PATH) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        payload = [
            {
                "chunk": {**asdict(item.chunk), "fetched_at": item.chunk.fetched_at.isoformat()},
                "embedding": item.embedding,
            }
            for item in self._items
        ]
        with open(path, "w") as f:
            json.dump(payload, f)

    @classmethod
    def load(cls, path: str = INDEX_PATH) -> "RetrievalIndex":
        index = cls()
        if not os.path.exists(path):
            return index
        from datetime import datetime

        with open(path) as f:
            payload = json.load(f)
        for row in payload:
            chunk_data = dict(row["chunk"])
            chunk_data["fetched_at"] = datetime.fromisoformat(chunk_data["fetched_at"])
            index.add(Chunk(**chunk_data), row["embedding"])
        return index
