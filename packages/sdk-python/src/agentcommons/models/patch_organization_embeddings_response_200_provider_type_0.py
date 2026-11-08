from typing import Literal

PatchOrganizationEmbeddingsResponse200ProviderType0 = Literal["fake", "openai"]

PATCH_ORGANIZATION_EMBEDDINGS_RESPONSE_200_PROVIDER_TYPE_0_VALUES: set[
    PatchOrganizationEmbeddingsResponse200ProviderType0
] = {
    "fake",
    "openai",
}


def check_patch_organization_embeddings_response_200_provider_type_0(
    value: str,
) -> PatchOrganizationEmbeddingsResponse200ProviderType0:
    if value in PATCH_ORGANIZATION_EMBEDDINGS_RESPONSE_200_PROVIDER_TYPE_0_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {PATCH_ORGANIZATION_EMBEDDINGS_RESPONSE_200_PROVIDER_TYPE_0_VALUES!r}"
    )
