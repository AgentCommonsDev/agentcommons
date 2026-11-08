from typing import Literal

GetOrganizationEmbeddingsResponse200LastAttemptType0 = Literal[
    "completed", "failed", "reserved"
]

GET_ORGANIZATION_EMBEDDINGS_RESPONSE_200_LAST_ATTEMPT_TYPE_0_VALUES: set[
    GetOrganizationEmbeddingsResponse200LastAttemptType0
] = {
    "completed",
    "failed",
    "reserved",
}


def check_get_organization_embeddings_response_200_last_attempt_type_0(
    value: str,
) -> GetOrganizationEmbeddingsResponse200LastAttemptType0:
    if value in GET_ORGANIZATION_EMBEDDINGS_RESPONSE_200_LAST_ATTEMPT_TYPE_0_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ORGANIZATION_EMBEDDINGS_RESPONSE_200_LAST_ATTEMPT_TYPE_0_VALUES!r}"
    )
