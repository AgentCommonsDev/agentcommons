from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostIngestBodyStartType0")


@_attrs_define
class PostIngestBodyStartType0:
    """
    Attributes:
        resume (bool):
    """

    resume: bool

    def to_dict(self) -> dict[str, Any]:
        resume = self.resume

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "resume": resume,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        resume = d.pop("resume")

        post_ingest_body_start_type_0 = cls(
            resume=resume,
        )

        return post_ingest_body_start_type_0
