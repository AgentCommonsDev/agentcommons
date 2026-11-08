from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostIngestBodyRecordsItem")


@_attrs_define
class PostIngestBodyRecordsItem:
    """
    Attributes:
        pos (int):
        line (str):
        key (None | str | Unset):
        source_version (int | Unset):  Default: 0.
    """

    pos: int
    line: str
    key: None | str | Unset = UNSET
    source_version: int | Unset = 0

    def to_dict(self) -> dict[str, Any]:
        pos = self.pos

        line = self.line

        key: None | str | Unset
        if isinstance(self.key, Unset):
            key = UNSET
        else:
            key = self.key

        source_version = self.source_version

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "pos": pos,
                "line": line,
            }
        )
        if key is not UNSET:
            field_dict["key"] = key
        if source_version is not UNSET:
            field_dict["sourceVersion"] = source_version

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        pos = d.pop("pos")

        line = d.pop("line")

        def _parse_key(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        key = _parse_key(d.pop("key", UNSET))

        source_version = d.pop("sourceVersion", UNSET)

        post_ingest_body_records_item = cls(
            pos=pos,
            line=line,
            key=key,
            source_version=source_version,
        )

        return post_ingest_body_records_item
