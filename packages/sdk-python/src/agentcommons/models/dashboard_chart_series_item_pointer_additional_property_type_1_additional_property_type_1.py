from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar(
    "T",
    bound="DashboardChartSeriesItemPointerAdditionalPropertyType1AdditionalPropertyType1",
)


@_attrs_define
class DashboardChartSeriesItemPointerAdditionalPropertyType1AdditionalPropertyType1:
    additional_properties: dict[
        str, bool | float | list[bool | float | None | str] | None | str
    ] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:

        field_dict: dict[str, Any] = {}
        for prop_name, prop in self.additional_properties.items():
            if isinstance(prop, list):
                field_dict[prop_name] = []
                for additional_property_type_1_item_data in prop:
                    additional_property_type_1_item: bool | float | None | str
                    additional_property_type_1_item = (
                        additional_property_type_1_item_data
                    )
                    field_dict[prop_name].append(additional_property_type_1_item)

            else:
                field_dict[prop_name] = prop

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        dashboard_chart_series_item_pointer_additional_property_type_1_additional_property_type_1 = cls()

        additional_properties = {}
        for prop_name, prop_dict in d.items():

            def _parse_additional_property(
                data: object,
            ) -> bool | float | list[bool | float | None | str] | None | str:
                if data is None:
                    return data
                try:
                    if not isinstance(data, list):
                        raise TypeError()
                    additional_property_type_1 = []
                    _additional_property_type_1 = data
                    for (
                        additional_property_type_1_item_data
                    ) in _additional_property_type_1:

                        def _parse_additional_property_type_1_item(
                            data: object,
                        ) -> bool | float | None | str:
                            if data is None:
                                return data
                            return cast(bool | float | None | str, data)

                        additional_property_type_1_item = (
                            _parse_additional_property_type_1_item(
                                additional_property_type_1_item_data
                            )
                        )

                        additional_property_type_1.append(
                            additional_property_type_1_item
                        )

                    return additional_property_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                return cast(
                    bool | float | list[bool | float | None | str] | None | str, data
                )

            additional_property = _parse_additional_property(prop_dict)

            additional_properties[prop_name] = additional_property

        dashboard_chart_series_item_pointer_additional_property_type_1_additional_property_type_1.additional_properties = additional_properties
        return dashboard_chart_series_item_pointer_additional_property_type_1_additional_property_type_1

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(
        self, key: str
    ) -> bool | float | list[bool | float | None | str] | None | str:
        return self.additional_properties[key]

    def __setitem__(
        self,
        key: str,
        value: bool | float | list[bool | float | None | str] | None | str,
    ) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
