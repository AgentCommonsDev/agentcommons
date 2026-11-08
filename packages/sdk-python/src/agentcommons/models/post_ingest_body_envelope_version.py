from typing import Literal

PostIngestBodyEnvelopeVersion = Literal[2]

POST_INGEST_BODY_ENVELOPE_VERSION_VALUES: set[PostIngestBodyEnvelopeVersion] = {
    2,
}


def check_post_ingest_body_envelope_version(
    value: int,
) -> PostIngestBodyEnvelopeVersion:
    if value in POST_INGEST_BODY_ENVELOPE_VERSION_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_INGEST_BODY_ENVELOPE_VERSION_VALUES!r}"
    )
