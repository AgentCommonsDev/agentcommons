from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_search_body_filters import PostSearchBodyFilters


T = TypeVar("T", bound="PostSearchBody")


@_attrs_define
class PostSearchBody:
    """
    Attributes:
        query (str): Words to find; every word must appear (English stems match). May be empty when a filter is given
        filters (PostSearchBodyFilters | Unset): Narrow by session or message fields. Each key takes one value or a list
            (any of); every key given must hold
        context (int | Unset): Neighbouring non-thinking messages either side of each hit Default: 1.
        limit (int | Unset): Hit messages per page; at most 3 hits per session Default: 5.
        cursor (None | str | Unset): Cursor from the previous page; null for the first page
    """

    query: str
    filters: PostSearchBodyFilters | Unset = UNSET
    context: int | Unset = 1
    limit: int | Unset = 5
    cursor: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        query = self.query

        filters: dict[str, Any] | Unset = UNSET
        if not isinstance(self.filters, Unset):
            filters = self.filters.to_dict()

        context = self.context

        limit = self.limit

        cursor: None | str | Unset
        if isinstance(self.cursor, Unset):
            cursor = UNSET
        else:
            cursor = self.cursor

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "query": query,
            }
        )
        if filters is not UNSET:
            field_dict["filters"] = filters
        if context is not UNSET:
            field_dict["context"] = context
        if limit is not UNSET:
            field_dict["limit"] = limit
        if cursor is not UNSET:
            field_dict["cursor"] = cursor

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_search_body_filters import (
            PostSearchBodyFilters,  # noqa: PLC0415
        )

        d = dict(src_dict)
        query = d.pop("query")

        _filters = d.pop("filters", UNSET)
        filters: PostSearchBodyFilters | Unset
        if isinstance(_filters, Unset):
            filters = UNSET
        else:
            filters = PostSearchBodyFilters.from_dict(_filters)

        context = d.pop("context", UNSET)

        limit = d.pop("limit", UNSET)

        def _parse_cursor(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        cursor = _parse_cursor(d.pop("cursor", UNSET))

        post_search_body = cls(
            query=query,
            filters=filters,
            context=context,
            limit=limit,
            cursor=cursor,
        )

        return post_search_body
