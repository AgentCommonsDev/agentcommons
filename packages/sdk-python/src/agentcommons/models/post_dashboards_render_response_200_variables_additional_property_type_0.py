from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar(
    "T", bound="PostDashboardsRenderResponse200VariablesAdditionalPropertyType0"
)


@_attrs_define
class PostDashboardsRenderResponse200VariablesAdditionalPropertyType0:
    """
    Attributes:
        from_ (datetime.datetime):
        to (datetime.datetime):
    """

    from_: datetime.datetime
    to: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        from_ = self.from_.isoformat()

        to = self.to.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "from": from_,
                "to": to,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        from_ = datetime.datetime.fromisoformat(d.pop("from"))

        to = datetime.datetime.fromisoformat(d.pop("to"))

        post_dashboards_render_response_200_variables_additional_property_type_0 = cls(
            from_=from_,
            to=to,
        )

        return post_dashboards_render_response_200_variables_additional_property_type_0
