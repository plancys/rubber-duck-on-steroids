"""The shape of one lesson answer, as a tree of Cognee DataPoint models.

Cognee removes its own DataPoint fields before it sends the schema to the model, so the model sees only
the fields below. A change of a field name or of a field type changes the answer schema, so it raises
PROMPT_VERSION in prompt.py. scripts/fake-model.mjs writes answers with the same field names.
"""

from __future__ import annotations

from typing import Literal

from cognee.infrastructure.engine import DataPoint


class Link(DataPoint):
    # The reference of a passage of the request, for example P1.
    passage: str
    role: Literal["explains", "mentions"]
    # An exact extract of the passage.
    quote: str


class Topic(DataPoint):
    name: str
    # One sentence.
    description: str
    # The integer reference of a known topic that names the same concept, or None.
    same_as: int | None
    links: list[Link]


class Relation(DataPoint):
    kind: Literal["prerequisite", "part_of"]
    # The names of the two topics. A prerequisite comes before the second topic.
    # With part_of, the first topic is a part of the second topic.
    from_topic: str
    to_topic: str
    reason: str
    # The reference of the passage that supports the relation.
    passage: str


class LessonGraph(DataPoint):
    topics: list[Topic]
    relations: list[Relation]
