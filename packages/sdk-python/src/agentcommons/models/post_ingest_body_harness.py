from typing import Literal

PostIngestBodyHarness = Literal["CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"]

POST_INGEST_BODY_HARNESS_VALUES: set[PostIngestBodyHarness] = {
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
}


def check_post_ingest_body_harness(value: str) -> PostIngestBodyHarness:
    if value in POST_INGEST_BODY_HARNESS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_INGEST_BODY_HARNESS_VALUES!r}"
    )
