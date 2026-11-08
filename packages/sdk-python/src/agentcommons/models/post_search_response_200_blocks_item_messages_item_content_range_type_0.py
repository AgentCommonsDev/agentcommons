from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostSearchResponse200BlocksItemMessagesItemContentRangeType0")


@_attrs_define
class PostSearchResponse200BlocksItemMessagesItemContentRangeType0:
    """
    Attributes:
        start (int): First UTF-8 byte of the excerpt inside the full content
        end (int): Byte after the excerpt's last byte
        total (int): UTF-8 bytes of the full content
    """

    start: int
    end: int
    total: int

    def to_dict(self) -> dict[str, Any]:
        start = self.start

        end = self.end

        total = self.total

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "start": start,
                "end": end,
                "total": total,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        start = d.pop("start")

        end = d.pop("end")

        total = d.pop("total")

        post_search_response_200_blocks_item_messages_item_content_range_type_0 = cls(
            start=start,
            end=end,
            total=total,
        )

        return post_search_response_200_blocks_item_messages_item_content_range_type_0
