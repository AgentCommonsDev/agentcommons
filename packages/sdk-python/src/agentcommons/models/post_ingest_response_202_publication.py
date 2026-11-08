from typing import Literal

PostIngestResponse202Publication = Literal["published", "queued"]

POST_INGEST_RESPONSE_202_PUBLICATION_VALUES: set[PostIngestResponse202Publication] = {
    "published",
    "queued",
}


def check_post_ingest_response_202_publication(
    value: str,
) -> PostIngestResponse202Publication:
    if value in POST_INGEST_RESPONSE_202_PUBLICATION_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_INGEST_RESPONSE_202_PUBLICATION_VALUES!r}"
    )
