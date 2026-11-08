from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="DeleteAdminUsersIdResponse200")


@_attrs_define
class DeleteAdminUsersIdResponse200:
    """
    Attributes:
        id (str):
        updated (bool):
    """

    id: str
    updated: bool

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        updated = self.updated

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "updated": updated,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = d.pop("id")

        updated = d.pop("updated")

        delete_admin_users_id_response_200 = cls(
            id=id,
            updated=updated,
        )

        return delete_admin_users_id_response_200
