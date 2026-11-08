from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostIngestBodyHook")


@_attrs_define
class PostIngestBodyHook:
    """
    Attributes:
        sha256 (str):
        extension_sha_256 (None | str):
    """

    sha256: str
    extension_sha_256: None | str

    def to_dict(self) -> dict[str, Any]:
        sha256 = self.sha256

        extension_sha_256: None | str
        extension_sha_256 = self.extension_sha_256

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sha256": sha256,
                "extensionSha256": extension_sha_256,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        sha256 = d.pop("sha256")

        def _parse_extension_sha_256(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        extension_sha_256 = _parse_extension_sha_256(d.pop("extensionSha256"))

        post_ingest_body_hook = cls(
            sha256=sha256,
            extension_sha_256=extension_sha_256,
        )

        return post_ingest_body_hook
