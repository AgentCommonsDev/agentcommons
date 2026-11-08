from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_api_v1_ready_response_503_status import (
    GetApiV1ReadyResponse503Status,
    check_get_api_v1_ready_response_503_status,
)

T = TypeVar("T", bound="GetApiV1ReadyResponse503")


@_attrs_define
class GetApiV1ReadyResponse503:
    """
    Attributes:
        status (GetApiV1ReadyResponse503Status):
    """

    status: GetApiV1ReadyResponse503Status

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
        status = check_get_api_v1_ready_response_503_status(d.pop("status"))

        get_api_v1_ready_response_503 = cls(
            status=status,
        )

        return get_api_v1_ready_response_503
