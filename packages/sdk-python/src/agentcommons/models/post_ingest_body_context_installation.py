from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostIngestBodyContextInstallation")


@_attrs_define
class PostIngestBodyContextInstallation:
    """
    Attributes:
        hostname (str):
        os_user (str):
        platform (str):
        arch (str):
    """

    hostname: str
    os_user: str
    platform: str
    arch: str

    def to_dict(self) -> dict[str, Any]:
        hostname = self.hostname

        os_user = self.os_user

        platform = self.platform

        arch = self.arch

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "hostname": hostname,
                "osUser": os_user,
                "platform": platform,
                "arch": arch,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        hostname = d.pop("hostname")

        os_user = d.pop("osUser")

        platform = d.pop("platform")

        arch = d.pop("arch")

        post_ingest_body_context_installation = cls(
            hostname=hostname,
            os_user=os_user,
            platform=platform,
            arch=arch,
        )

        return post_ingest_body_context_installation
