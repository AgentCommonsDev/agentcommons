from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_me_keys_response_200_metadata import (
        PostMeKeysResponse200Metadata,
    )


T = TypeVar("T", bound="PostMeKeysResponse200")


@_attrs_define
class PostMeKeysResponse200:
    """
    Attributes:
        key (str):
        metadata (PostMeKeysResponse200Metadata):
    """

    key: str
    metadata: PostMeKeysResponse200Metadata

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        metadata = self.metadata.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "key": key,
                "metadata": metadata,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_me_keys_response_200_metadata import (
            PostMeKeysResponse200Metadata,  # noqa: PLC0415
        )

        d = dict(src_dict)
        key = d.pop("key")

        metadata = PostMeKeysResponse200Metadata.from_dict(d.pop("metadata"))

        post_me_keys_response_200 = cls(
            key=key,
            metadata=metadata,
        )

        return post_me_keys_response_200
