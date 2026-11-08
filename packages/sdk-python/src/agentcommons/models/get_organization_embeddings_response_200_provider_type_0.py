from typing import Literal

GetOrganizationEmbeddingsResponse200ProviderType0 = Literal["fake", "openai"]

GET_ORGANIZATION_EMBEDDINGS_RESPONSE_200_PROVIDER_TYPE_0_VALUES: set[
    GetOrganizationEmbeddingsResponse200ProviderType0
] = {
    "fake",
    "openai",
}


def check_get_organization_embeddings_response_200_provider_type_0(
    value: str,
) -> GetOrganizationEmbeddingsResponse200ProviderType0:
    if value in GET_ORGANIZATION_EMBEDDINGS_RESPONSE_200_PROVIDER_TYPE_0_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ORGANIZATION_EMBEDDINGS_RESPONSE_200_PROVIDER_TYPE_0_VALUES!r}"
    )
