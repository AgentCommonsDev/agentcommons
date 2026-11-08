from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_health_response_200_status import (
    GetHealthResponse200Status,
    check_get_health_response_200_status,
)

T = TypeVar("T", bound="GetHealthResponse200")


@_attrs_define
class GetHealthResponse200:
    """
    Attributes:
        status (GetHealthResponse200Status):
    """

    status: GetHealthResponse200Status

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
        status = check_get_health_response_200_status(d.pop("status"))

        get_health_response_200 = cls(
            status=status,
        )

        return get_health_response_200
