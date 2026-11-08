from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_admin_sessions_id_purge_response_200_manifest_deleted import (
        PostAdminSessionsIdPurgeResponse200ManifestDeleted,
    )


T = TypeVar("T", bound="PostAdminSessionsIdPurgeResponse200Manifest")


@_attrs_define
class PostAdminSessionsIdPurgeResponse200Manifest:
    """
    Attributes:
        deleted (PostAdminSessionsIdPurgeResponse200ManifestDeleted):
        nulled_fields (list[str]):
        reset_fields (list[str]):
        retained (list[str]):
    """

    deleted: PostAdminSessionsIdPurgeResponse200ManifestDeleted
    nulled_fields: list[str]
    reset_fields: list[str]
    retained: list[str]

    def to_dict(self) -> dict[str, Any]:
        deleted = self.deleted.to_dict()

        nulled_fields = self.nulled_fields

        reset_fields = self.reset_fields

        retained = self.retained

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "deleted": deleted,
                "nulled_fields": nulled_fields,
                "reset_fields": reset_fields,
                "retained": retained,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_admin_sessions_id_purge_response_200_manifest_deleted import (
            PostAdminSessionsIdPurgeResponse200ManifestDeleted,  # noqa: PLC0415
        )

        d = dict(src_dict)
        deleted = PostAdminSessionsIdPurgeResponse200ManifestDeleted.from_dict(
            d.pop("deleted")
        )

        nulled_fields = cast(list[str], d.pop("nulled_fields"))

        reset_fields = cast(list[str], d.pop("reset_fields"))

        retained = cast(list[str], d.pop("retained"))

        post_admin_sessions_id_purge_response_200_manifest = cls(
            deleted=deleted,
            nulled_fields=nulled_fields,
            reset_fields=reset_fields,
            retained=retained,
        )

        return post_admin_sessions_id_purge_response_200_manifest
