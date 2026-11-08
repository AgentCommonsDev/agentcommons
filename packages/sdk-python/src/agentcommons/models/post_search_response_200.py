from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_search_response_200_blocks_item import (
        PostSearchResponse200BlocksItem,
    )
    from ..models.post_search_response_200_partial_type_0 import (
        PostSearchResponse200PartialType0,
    )
    from ..models.post_search_response_200_total import PostSearchResponse200Total


T = TypeVar("T", bound="PostSearchResponse200")


@_attrs_define
class PostSearchResponse200:
    """
    Attributes:
        blocks (list[PostSearchResponse200BlocksItem]): Message windows grouped by session, best match first
        cursor (None | str): Cursor for the next page; null when there is none
        truncated_response (bool): True when the page was cut to fit the response size limit; continue with cursor
        total (PostSearchResponse200Total): Totals over every hit the query and filters match under the caller's
            visibility, not only this page
        partial (None | PostSearchResponse200PartialType0): Set when the full search exceeded the read time or memory
            limit and this page searched only the most recently active matching sessions; null for a complete search. Narrow
            the filters to search the rest.
        next_ (None | str): What to try when this page has no hit: the shorter query, the filter to drop or the sql that
            lists the indexed repositories; null when the page has hits
    """

    blocks: list[PostSearchResponse200BlocksItem]
    cursor: None | str
    truncated_response: bool
    total: PostSearchResponse200Total
    partial: None | PostSearchResponse200PartialType0
    next_: None | str

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_search_response_200_partial_type_0 import (
            PostSearchResponse200PartialType0,  # noqa: PLC0415
        )

        blocks = []
        for blocks_item_data in self.blocks:
            blocks_item = blocks_item_data.to_dict()
            blocks.append(blocks_item)

        cursor: None | str
        cursor = self.cursor

        truncated_response = self.truncated_response

        total = self.total.to_dict()

        partial: dict[str, Any] | None
        if isinstance(self.partial, PostSearchResponse200PartialType0):
            partial = self.partial.to_dict()
        else:
            partial = self.partial

        next_: None | str
        next_ = self.next_

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "blocks": blocks,
                "cursor": cursor,
                "truncated_response": truncated_response,
                "total": total,
                "partial": partial,
                "next": next_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_search_response_200_blocks_item import (
            PostSearchResponse200BlocksItem,  # noqa: PLC0415
        )
        from ..models.post_search_response_200_partial_type_0 import (
            PostSearchResponse200PartialType0,  # noqa: PLC0415
        )
        from ..models.post_search_response_200_total import (
            PostSearchResponse200Total,  # noqa: PLC0415
        )

        d = dict(src_dict)
        blocks = []
        _blocks = d.pop("blocks")
        for blocks_item_data in _blocks:
            blocks_item = PostSearchResponse200BlocksItem.from_dict(blocks_item_data)

            blocks.append(blocks_item)

        def _parse_cursor(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        cursor = _parse_cursor(d.pop("cursor"))

        truncated_response = d.pop("truncated_response")

        total = PostSearchResponse200Total.from_dict(d.pop("total"))

        def _parse_partial(data: object) -> None | PostSearchResponse200PartialType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                partial_type_0 = PostSearchResponse200PartialType0.from_dict(data)

                return partial_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostSearchResponse200PartialType0, data)

        partial = _parse_partial(d.pop("partial"))

        def _parse_next_(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        next_ = _parse_next_(d.pop("next"))

        post_search_response_200 = cls(
            blocks=blocks,
            cursor=cursor,
            truncated_response=truncated_response,
            total=total,
            partial=partial,
            next_=next_,
        )

        return post_search_response_200
