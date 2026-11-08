from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_admin_sessions_id_visibility_body_visibility import (
    PostAdminSessionsIdVisibilityBodyVisibility,
    check_post_admin_sessions_id_visibility_body_visibility,
)

T = TypeVar("T", bound="PostAdminSessionsIdVisibilityBody")


@_attrs_define
class PostAdminSessionsIdVisibilityBody:
    """
    Attributes:
        visibility (PostAdminSessionsIdVisibilityBodyVisibility):
        reason (str):
    """

    visibility: PostAdminSessionsIdVisibilityBodyVisibility
    reason: str

    def to_dict(self) -> dict[str, Any]:
        visibility: str = self.visibility

        reason = self.reason

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "visibility": visibility,
                "reason": reason,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        visibility = check_post_admin_sessions_id_visibility_body_visibility(
            d.pop("visibility")
        )

        reason = d.pop("reason")

        post_admin_sessions_id_visibility_body = cls(
            visibility=visibility,
            reason=reason,
        )

        return post_admin_sessions_id_visibility_body
