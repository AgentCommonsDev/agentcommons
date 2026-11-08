from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetSchemaResponse200ColumnsItem")


@_attrs_define
class GetSchemaResponse200ColumnsItem:
    """
    Attributes:
        view_name (str):
        column_name (str):
        data_type (str):
        ordinal_position (int):
        description (None | str):
    """

    view_name: str
    column_name: str
    data_type: str
    ordinal_position: int
    description: None | str

    def to_dict(self) -> dict[str, Any]:
        view_name = self.view_name

        column_name = self.column_name

        data_type = self.data_type

        ordinal_position = self.ordinal_position

        description: None | str
        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "view_name": view_name,
                "column_name": column_name,
                "data_type": data_type,
                "ordinal_position": ordinal_position,
                "description": description,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        view_name = d.pop("view_name")

        column_name = d.pop("column_name")

        data_type = d.pop("data_type")

        ordinal_position = d.pop("ordinal_position")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        get_schema_response_200_columns_item = cls(
            view_name=view_name,
            column_name=column_name,
            data_type=data_type,
            ordinal_position=ordinal_position,
            description=description,
        )

        return get_schema_response_200_columns_item
