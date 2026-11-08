from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_v1_ready_response_200_status import (
    GetApiV1ReadyResponse200Status,
    check_get_api_v1_ready_response_200_status,
)

T = TypeVar("T", bound="GetApiV1ReadyResponse200")


@_attrs_define
class GetApiV1ReadyResponse200:
    """
    Attributes:
        status (GetApiV1ReadyResponse200Status):
    """

    status: GetApiV1ReadyResponse200Status

    def to_dict(self) -> dict[str, Any]:
        status: str = self.status

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        status = check_get_api_v1_ready_response_200_status(d.pop("status"))

        get_api_v1_ready_response_200 = cls(
            status=status,
        )

        return get_api_v1_ready_response_200
