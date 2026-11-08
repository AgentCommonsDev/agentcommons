from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_sessions_id_response_200_header_type_0 import (
        GetSessionsIdResponse200HeaderType0,
    )
    from ..models.get_sessions_id_response_200_messages_item import (
        GetSessionsIdResponse200MessagesItem,
    )
    from ..models.get_sessions_id_response_200_next_type_0 import (
        GetSessionsIdResponse200NextType0,
    )


T = TypeVar("T", bound="GetSessionsIdResponse200")


@_attrs_define
class GetSessionsIdResponse200:
    """
    Attributes:
        header (GetSessionsIdResponse200HeaderType0 | None): Who ran the session, where and when, with message, tool,
            token, file and reuse counts and related sessions; null when the REST caller asked for messages only
            (header=false)
        messages (list[GetSessionsIdResponse200MessagesItem]): Messages in seq order within the requested range
        next_ (GetSessionsIdResponse200NextType0 | None): Cursor for the following page: the next message, or the rest
            of the last message when the range ends inside it; null when the range is complete
    """

    header: GetSessionsIdResponse200HeaderType0 | None
    messages: list[GetSessionsIdResponse200MessagesItem]
    next_: GetSessionsIdResponse200NextType0 | None

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_sessions_id_response_200_header_type_0 import (
            GetSessionsIdResponse200HeaderType0,  # noqa: PLC0415
        )
        from ..models.get_sessions_id_response_200_next_type_0 import (
            GetSessionsIdResponse200NextType0,  # noqa: PLC0415
        )

        header: dict[str, Any] | None
        if isinstance(self.header, GetSessionsIdResponse200HeaderType0):
            header = self.header.to_dict()
        else:
            header = self.header

        messages = []
        for messages_item_data in self.messages:
            messages_item = messages_item_data.to_dict()
            messages.append(messages_item)

        next_: dict[str, Any] | None
        if isinstance(self.next_, GetSessionsIdResponse200NextType0):
            next_ = self.next_.to_dict()
        else:
            next_ = self.next_

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "header": header,
                "messages": messages,
                "next": next_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_sessions_id_response_200_header_type_0 import (
            GetSessionsIdResponse200HeaderType0,  # noqa: PLC0415
        )
        from ..models.get_sessions_id_response_200_messages_item import (
            GetSessionsIdResponse200MessagesItem,  # noqa: PLC0415
        )
        from ..models.get_sessions_id_response_200_next_type_0 import (
            GetSessionsIdResponse200NextType0,  # noqa: PLC0415
        )

        d = dict(src_dict)

        def _parse_header(data: object) -> GetSessionsIdResponse200HeaderType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                header_type_0 = GetSessionsIdResponse200HeaderType0.from_dict(data)

                return header_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetSessionsIdResponse200HeaderType0 | None, data)

        header = _parse_header(d.pop("header"))

        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:
            messages_item = GetSessionsIdResponse200MessagesItem.from_dict(
                messages_item_data
            )

            messages.append(messages_item)

        def _parse_next_(data: object) -> GetSessionsIdResponse200NextType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                next_type_0 = GetSessionsIdResponse200NextType0.from_dict(data)

                return next_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetSessionsIdResponse200NextType0 | None, data)

        next_ = _parse_next_(d.pop("next"))

        get_sessions_id_response_200 = cls(
            header=header,
            messages=messages,
            next_=next_,
        )

        return get_sessions_id_response_200
