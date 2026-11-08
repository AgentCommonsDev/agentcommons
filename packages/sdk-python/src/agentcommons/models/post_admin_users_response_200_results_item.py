from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_admin_users_response_200_results_item_status import (
    PostAdminUsersResponse200ResultsItemStatus,
    check_post_admin_users_response_200_results_item_status,
)

T = TypeVar("T", bound="PostAdminUsersResponse200ResultsItem")


@_attrs_define
class PostAdminUsersResponse200ResultsItem:
    """
    Attributes:
        email (str):
        status (PostAdminUsersResponse200ResultsItemStatus):
        user_id (None | str):
        setup_url (None | str):
        error (None | str):
    """

    email: str
    status: PostAdminUsersResponse200ResultsItemStatus
    user_id: None | str
    setup_url: None | str
    error: None | str

    def to_dict(self) -> dict[str, Any]:
        email = self.email

        status: str = self.status

        user_id: None | str
        user_id = self.user_id

        setup_url: None | str
        setup_url = self.setup_url

        error: None | str
        error = self.error

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "email": email,
                "status": status,
                "user_id": user_id,
                "setup_url": setup_url,
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        email = d.pop("email")

        status = check_post_admin_users_response_200_results_item_status(
            d.pop("status")
        )

        def _parse_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        user_id = _parse_user_id(d.pop("user_id"))

        def _parse_setup_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        setup_url = _parse_setup_url(d.pop("setup_url"))

        def _parse_error(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        error = _parse_error(d.pop("error"))

        post_admin_users_response_200_results_item = cls(
            email=email,
            status=status,
            user_id=user_id,
            setup_url=setup_url,
            error=error,
        )

        return post_admin_users_response_200_results_item
