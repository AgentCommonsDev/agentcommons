from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.post_dashboards_render_body_variables_additional_property_type_0_type_0 import (
    PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type0,
    check_post_dashboards_render_body_variables_additional_property_type_0_type_0,
)

if TYPE_CHECKING:
    from ..models.post_dashboards_render_body_variables_additional_property_type_0_type_1 import (
        PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type1,
    )


T = TypeVar("T", bound="PostDashboardsRenderBodyVariables")


@_attrs_define
class PostDashboardsRenderBodyVariables:
    additional_properties: dict[
        str,
        list[str]
        | PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type0
        | PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type1
        | str,
    ] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_dashboards_render_body_variables_additional_property_type_0_type_1 import (
            PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type1,  # noqa: PLC0415
        )

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, str):
                field_dict[prop_name] = prop
            elif isinstance(
                prop, PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type1
            ):
                field_dict[prop_name] = prop.to_dict()
            elif isinstance(prop, list):
                field_dict[prop_name] = prop

            else:
                field_dict[prop_name] = prop

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_dashboards_render_body_variables_additional_property_type_0_type_1 import (
            PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type1,  # noqa: PLC0415
        )

        d = dict(src_dict)
        post_dashboards_render_body_variables = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(
                data: object,
            ) -> (
                list[str]
                | PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type0
                | PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type1
                | str
            ):
                try:
                    if not isinstance(data, str):
                        raise TypeError()
                    additional_property_type_0_type_0 = check_post_dashboards_render_body_variables_additional_property_type_0_type_0(
                        data
                    )

                    return additional_property_type_0_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    additional_property_type_0_type_1 = PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type1.from_dict(
                        data
                    )

                    return additional_property_type_0_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, list):
                        raise TypeError()
                    additional_property_type_1 = cast(list[str], data)

                    return additional_property_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                return cast(
                    list[str]
                    | PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type0
                    | PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type1
                    | str,
                    data,
                )

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        post_dashboards_render_body_variables.additional_properties = (
            additional_properties
        )
        return post_dashboards_render_body_variables

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(
        self, key: str
    ) -> (
        list[str]
        | PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type0
        | PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type1
        | str
    ):
        return self.additional_properties[key]

    def __setitem__(
        self,
        key: str,
        value: list[str]
        | PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type0
        | PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type1
        | str,
    ) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
