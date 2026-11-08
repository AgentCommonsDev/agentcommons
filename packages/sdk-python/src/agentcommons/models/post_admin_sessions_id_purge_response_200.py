from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_admin_sessions_id_purge_response_200_cleanup import (
    PostAdminSessionsIdPurgeResponse200Cleanup,
    check_post_admin_sessions_id_purge_response_200_cleanup,
)

if TYPE_CHECKING:
    from ..models.post_admin_sessions_id_purge_response_200_manifest import (
        PostAdminSessionsIdPurgeResponse200Manifest,
    )


T = TypeVar("T", bound="PostAdminSessionsIdPurgeResponse200")


@_attrs_define
class PostAdminSessionsIdPurgeResponse200:
    """
    Attributes:
        id (str):
        updated (bool):
        cleanup (PostAdminSessionsIdPurgeResponse200Cleanup):
        manifest (PostAdminSessionsIdPurgeResponse200Manifest):
    """

    id: str
    updated: bool
    cleanup: PostAdminSessionsIdPurgeResponse200Cleanup
    manifest: PostAdminSessionsIdPurgeResponse200Manifest

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        updated = self.updated

        cleanup: str = self.cleanup

        manifest = self.manifest.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "updated": updated,
                "cleanup": cleanup,
                "manifest": manifest,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_admin_sessions_id_purge_response_200_manifest import (
            PostAdminSessionsIdPurgeResponse200Manifest,  # noqa: PLC0415
        )

        d = dict(src_dict)
        id = d.pop("id")

        updated = d.pop("updated")

        cleanup = check_post_admin_sessions_id_purge_response_200_cleanup(
            d.pop("cleanup")
        )

        manifest = PostAdminSessionsIdPurgeResponse200Manifest.from_dict(
            d.pop("manifest")
        )

        post_admin_sessions_id_purge_response_200 = cls(
            id=id,
            updated=updated,
            cleanup=cleanup,
            manifest=manifest,
        )

        return post_admin_sessions_id_purge_response_200
