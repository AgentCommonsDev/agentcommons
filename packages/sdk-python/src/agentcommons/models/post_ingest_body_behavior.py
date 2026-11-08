from typing import Literal

PostIngestBodyBehavior = Literal["end", "start", "sync"]

POST_INGEST_BODY_BEHAVIOR_VALUES: set[PostIngestBodyBehavior] = {
    "end",
    "start",
    "sync",
}


def check_post_ingest_body_behavior(value: str) -> PostIngestBodyBehavior:
    if value in POST_INGEST_BODY_BEHAVIOR_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_INGEST_BODY_BEHAVIOR_VALUES!r}"
    )
