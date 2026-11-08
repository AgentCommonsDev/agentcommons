from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetDashboardsResponse200ItemsItemCreatedByType0")


@_attrs_define
class GetDashboardsResponse200ItemsItemCreatedByType0:
    """
    Attributes:
        user_id (str):
        email (None | str):
        name (None | str):
    """

    user_id: str
    email: None | str
    name: None | str

    def to_dict(self) -> dict[str, Any]:
        user_id = self.user_id

        email: None | str
        email = self.email

        name: None | str
        name = self.name

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "user_id": user_id,
                "email": email,
                "name": name,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        user_id = d.pop("user_id")

        def _parse_email(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        email = _parse_email(d.pop("email"))

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        get_dashboards_response_200_items_item_created_by_type_0 = cls(
            user_id=user_id,
            email=email,
            name=name,
        )

        return get_dashboards_response_200_items_item_created_by_type_0
