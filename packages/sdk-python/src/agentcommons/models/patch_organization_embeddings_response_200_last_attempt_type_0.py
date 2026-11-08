from typing import Literal

PatchOrganizationEmbeddingsResponse200LastAttemptType0 = Literal[
    "completed", "failed", "reserved"
]

PATCH_ORGANIZATION_EMBEDDINGS_RESPONSE_200_LAST_ATTEMPT_TYPE_0_VALUES: set[
    PatchOrganizationEmbeddingsResponse200LastAttemptType0
] = {
    "completed",
    "failed",
    "reserved",
}


def check_patch_organization_embeddings_response_200_last_attempt_type_0(
    value: str,
) -> PatchOrganizationEmbeddingsResponse200LastAttemptType0:
    if value in PATCH_ORGANIZATION_EMBEDDINGS_RESPONSE_200_LAST_ATTEMPT_TYPE_0_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {PATCH_ORGANIZATION_EMBEDDINGS_RESPONSE_200_LAST_ATTEMPT_TYPE_0_VALUES!r}"
    )
