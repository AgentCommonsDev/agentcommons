from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetSessionsIdRawResponse200ItemsItemPayloadFragmentType0")


@_attrs_define
class GetSessionsIdRawResponse200ItemsItemPayloadFragmentType0:
    """
    Attributes:
        offset (int):
        next_offset (int | None):
    """

    offset: int
    next_offset: int | None

    def to_dict(self) -> dict[str, Any]:
        offset = self.offset

        next_offset: int | None
        next_offset = self.next_offset

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "offset": offset,
                "next_offset": next_offset,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        offset = d.pop("offset")

        def _parse_next_offset(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        next_offset = _parse_next_offset(d.pop("next_offset"))

        get_sessions_id_raw_response_200_items_item_payload_fragment_type_0 = cls(
            offset=offset,
            next_offset=next_offset,
        )

        return get_sessions_id_raw_response_200_items_item_payload_fragment_type_0
