from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_search_response_200_blocks_item_messages_item_kind import (
    PostSearchResponse200BlocksItemMessagesItemKind,
    check_post_search_response_200_blocks_item_messages_item_kind,
)
from ..models.post_search_response_200_blocks_item_messages_item_role import (
    PostSearchResponse200BlocksItemMessagesItemRole,
    check_post_search_response_200_blocks_item_messages_item_role,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_search_response_200_blocks_item_messages_item_content_range_type_0 import (
        PostSearchResponse200BlocksItemMessagesItemContentRangeType0,
    )


T = TypeVar("T", bound="PostSearchResponse200BlocksItemMessagesItem")


@_attrs_define
class PostSearchResponse200BlocksItemMessagesItem:
    """
    Attributes:
        seq (int): Position of the block within the session, ascending
        role (PostSearchResponse200BlocksItemMessagesItemRole): USER, ASSISTANT, TOOL_RESULT or SYSTEM
        kind (PostSearchResponse200BlocksItemMessagesItemKind): TEXT, THINKING, TOOL_USE, TOOL_RESULT or META
        content (str): Excerpt of the message text, centred on the match
        hit (bool): True for a matched message, false for surrounding context
        truncated (bool): True when content is an excerpt of a longer message
        content_range (None | PostSearchResponse200BlocksItemMessagesItemContentRangeType0): Where the excerpt sits in
            the full content when truncated; null when content is complete. Read the rest with get(session_id, cursor: {seq,
            offset: start})
        truncated_fields (list[str]): Fields shortened to fit the response
        tool_name (None | str | Unset): Tool called or answered, for TOOL_USE and TOOL_RESULT
        tool_use_id (None | str | Unset): Harness id pairing a tool call with its result
    """

    seq: int
    role: PostSearchResponse200BlocksItemMessagesItemRole
    kind: PostSearchResponse200BlocksItemMessagesItemKind
    content: str
    hit: bool
    truncated: bool
    content_range: None | PostSearchResponse200BlocksItemMessagesItemContentRangeType0
    truncated_fields: list[str]
    tool_name: None | str | Unset = UNSET
    tool_use_id: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_search_response_200_blocks_item_messages_item_content_range_type_0 import (
            PostSearchResponse200BlocksItemMessagesItemContentRangeType0,  # noqa: PLC0415
        )

        seq = self.seq

        role: str = self.role

        kind: str = self.kind

        content = self.content

        hit = self.hit

        truncated = self.truncated

        content_range: dict[str, Any] | None
        if isinstance(
            self.content_range,
            PostSearchResponse200BlocksItemMessagesItemContentRangeType0,
        ):
            content_range = self.content_range.to_dict()
        else:
            content_range = self.content_range

        truncated_fields = self.truncated_fields

        tool_name: None | str | Unset
        if isinstance(self.tool_name, Unset):
            tool_name = UNSET
        else:
            tool_name = self.tool_name

        tool_use_id: None | str | Unset
        if isinstance(self.tool_use_id, Unset):
            tool_use_id = UNSET
        else:
            tool_use_id = self.tool_use_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "seq": seq,
                "role": role,
                "kind": kind,
                "content": content,
                "hit": hit,
                "truncated": truncated,
                "content_range": content_range,
                "truncated_fields": truncated_fields,
            }
        )
        if tool_name is not UNSET:
            field_dict["tool_name"] = tool_name
        if tool_use_id is not UNSET:
            field_dict["tool_use_id"] = tool_use_id

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_search_response_200_blocks_item_messages_item_content_range_type_0 import (
            PostSearchResponse200BlocksItemMessagesItemContentRangeType0,  # noqa: PLC0415
        )

        d = dict(src_dict)
        seq = d.pop("seq")

        role = check_post_search_response_200_blocks_item_messages_item_role(
            d.pop("role")
        )

        kind = check_post_search_response_200_blocks_item_messages_item_kind(
            d.pop("kind")
        )

        content = d.pop("content")

        hit = d.pop("hit")

        truncated = d.pop("truncated")

        def _parse_content_range(
            data: object,
        ) -> None | PostSearchResponse200BlocksItemMessagesItemContentRangeType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                content_range_type_0 = PostSearchResponse200BlocksItemMessagesItemContentRangeType0.from_dict(
                    data
                )

                return content_range_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                None | PostSearchResponse200BlocksItemMessagesItemContentRangeType0,
                data,
            )

        content_range = _parse_content_range(d.pop("content_range"))

        truncated_fields = cast(list[str], d.pop("truncated_fields"))

        def _parse_tool_name(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        tool_name = _parse_tool_name(d.pop("tool_name", UNSET))

        def _parse_tool_use_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        tool_use_id = _parse_tool_use_id(d.pop("tool_use_id", UNSET))

        post_search_response_200_blocks_item_messages_item = cls(
            seq=seq,
            role=role,
            kind=kind,
            content=content,
            hit=hit,
            truncated=truncated,
            content_range=content_range,
            truncated_fields=truncated_fields,
            tool_name=tool_name,
            tool_use_id=tool_use_id,
        )

        return post_search_response_200_blocks_item_messages_item
