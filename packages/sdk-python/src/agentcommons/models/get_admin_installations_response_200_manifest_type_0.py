from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetAdminInstallationsResponse200ManifestType0")


@_attrs_define
class GetAdminInstallationsResponse200ManifestType0:
    """
    Attributes:
        version (str): The served bundle version label
        sha256 (str): The served hook.js digest
    """

    version: str
    sha256: str

    def to_dict(self) -> dict[str, Any]:
        version = self.version

        sha256 = self.sha256

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "version": version,
                "sha256": sha256,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        version = d.pop("version")

        sha256 = d.pop("sha256")

        get_admin_installations_response_200_manifest_type_0 = cls(
            version=version,
            sha256=sha256,
        )

        return get_admin_installations_response_200_manifest_type_0
