from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetSessionsIdResponse200NextType0")


@_attrs_define
class GetSessionsIdResponse200NextType0:
    """Position inside a session's messages for continuing a read

    Attributes:
        seq (int): Message position (seq) to continue from
        offset (int): Byte offset inside that message's content
    """

    seq: int
    offset: int

    def to_dict(self) -> dict[str, Any]:
        seq = self.seq

        offset = self.offset

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "seq": seq,
                "offset": offset,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        seq = d.pop("seq")

        offset = d.pop("offset")

        get_sessions_id_response_200_next_type_0 = cls(
            seq=seq,
            offset=offset,
        )

        return get_sessions_id_response_200_next_type_0
