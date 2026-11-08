from typing import Literal

PostIngestBodyContextParentHintType0Relation = Literal["SPAWNED", "SUBAGENT"]

POST_INGEST_BODY_CONTEXT_PARENT_HINT_TYPE_0_RELATION_VALUES: set[
    PostIngestBodyContextParentHintType0Relation
] = {
    "SPAWNED",
    "SUBAGENT",
}


def check_post_ingest_body_context_parent_hint_type_0_relation(
    value: str,
) -> PostIngestBodyContextParentHintType0Relation:
    if value in POST_INGEST_BODY_CONTEXT_PARENT_HINT_TYPE_0_RELATION_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_INGEST_BODY_CONTEXT_PARENT_HINT_TYPE_0_RELATION_VALUES!r}"
    )
