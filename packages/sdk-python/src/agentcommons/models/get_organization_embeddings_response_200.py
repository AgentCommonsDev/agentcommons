from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_organization_embeddings_response_200_last_attempt_type_0 import (
    GetOrganizationEmbeddingsResponse200LastAttemptType0,
    check_get_organization_embeddings_response_200_last_attempt_type_0,
)
from ..models.get_organization_embeddings_response_200_provider_type_0 import (
    GetOrganizationEmbeddingsResponse200ProviderType0,
    check_get_organization_embeddings_response_200_provider_type_0,
)

T = TypeVar("T", bound="GetOrganizationEmbeddingsResponse200")


@_attrs_define
class GetOrganizationEmbeddingsResponse200:
    """
    Attributes:
        enabled (bool):
        available (bool):
        entitled (bool):
        effective (bool):
        provider (GetOrganizationEmbeddingsResponse200ProviderType0 | None):
        model (None | str):
        sessions_total (int):
        sessions_indexed (int):
        sessions_pending (int):
        last_attempt (GetOrganizationEmbeddingsResponse200LastAttemptType0 | None):
    """

    enabled: bool
    available: bool
    entitled: bool
    effective: bool
    provider: GetOrganizationEmbeddingsResponse200ProviderType0 | None
    model: None | str
    sessions_total: int
    sessions_indexed: int
    sessions_pending: int
    last_attempt: GetOrganizationEmbeddingsResponse200LastAttemptType0 | None

    def to_dict(self) -> dict[str, Any]:
        enabled = self.enabled

        available = self.available

        entitled = self.entitled

        effective = self.effective

        provider: None | str
        if isinstance(self.provider, str):
            provider = self.provider
        else:
            provider = self.provider

        model: None | str
        model = self.model

        sessions_total = self.sessions_total

        sessions_indexed = self.sessions_indexed

        sessions_pending = self.sessions_pending

        last_attempt: None | str
        if isinstance(self.last_attempt, str):
            last_attempt = self.last_attempt
        else:
            last_attempt = self.last_attempt

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "enabled": enabled,
                "available": available,
                "entitled": entitled,
                "effective": effective,
                "provider": provider,
                "model": model,
                "sessions_total": sessions_total,
                "sessions_indexed": sessions_indexed,
                "sessions_pending": sessions_pending,
                "last_attempt": last_attempt,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        enabled = d.pop("enabled")

        available = d.pop("available")

        entitled = d.pop("entitled")

        effective = d.pop("effective")

        def _parse_provider(
            data: object,
        ) -> GetOrganizationEmbeddingsResponse200ProviderType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                provider_type_0 = (
                    check_get_organization_embeddings_response_200_provider_type_0(data)
                )

                return provider_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetOrganizationEmbeddingsResponse200ProviderType0 | None, data)

        provider = _parse_provider(d.pop("provider"))

        def _parse_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model = _parse_model(d.pop("model"))

        sessions_total = d.pop("sessions_total")

        sessions_indexed = d.pop("sessions_indexed")

        sessions_pending = d.pop("sessions_pending")

        def _parse_last_attempt(
            data: object,
        ) -> GetOrganizationEmbeddingsResponse200LastAttemptType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_attempt_type_0 = (
                    check_get_organization_embeddings_response_200_last_attempt_type_0(
                        data
                    )
                )

                return last_attempt_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                GetOrganizationEmbeddingsResponse200LastAttemptType0 | None, data
            )

        last_attempt = _parse_last_attempt(d.pop("last_attempt"))

        get_organization_embeddings_response_200 = cls(
            enabled=enabled,
            available=available,
            entitled=entitled,
            effective=effective,
            provider=provider,
            model=model,
            sessions_total=sessions_total,
            sessions_indexed=sessions_indexed,
            sessions_pending=sessions_pending,
            last_attempt=last_attempt,
        )

        return get_organization_embeddings_response_200
