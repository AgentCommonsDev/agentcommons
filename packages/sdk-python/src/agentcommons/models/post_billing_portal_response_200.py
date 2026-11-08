from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostBillingPortalResponse200")


@_attrs_define
class PostBillingPortalResponse200:
    """
    Attributes:
        url (None | str):
    """

    url: None | str

    def to_dict(self) -> dict[str, Any]:
        url: None | str
        url = self.url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "url": url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        url = _parse_url(d.pop("url"))

        post_billing_portal_response_200 = cls(
            url=url,
        )

        return post_billing_portal_response_200
