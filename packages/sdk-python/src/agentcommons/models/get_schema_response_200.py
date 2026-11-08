from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_schema_response_200_columns_item import (
        GetSchemaResponse200ColumnsItem,
    )
    from ..models.get_schema_response_200_functions_item import (
        GetSchemaResponse200FunctionsItem,
    )


T = TypeVar("T", bound="GetSchemaResponse200")


@_attrs_define
class GetSchemaResponse200:
    """
    Attributes:
        columns (list[GetSchemaResponse200ColumnsItem]):
        functions (list[GetSchemaResponse200FunctionsItem]):
    """

    columns: list[GetSchemaResponse200ColumnsItem]
    functions: list[GetSchemaResponse200FunctionsItem]

    def to_dict(self) -> dict[str, Any]:
        columns = []
        for columns_item_data in self.columns:
            columns_item = columns_item_data.to_dict()
            columns.append(columns_item)

        functions = []
        for functions_item_data in self.functions:
            functions_item = functions_item_data.to_dict()
            functions.append(functions_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "columns": columns,
                "functions": functions,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_schema_response_200_columns_item import (
            GetSchemaResponse200ColumnsItem,  # noqa: PLC0415
        )
        from ..models.get_schema_response_200_functions_item import (
            GetSchemaResponse200FunctionsItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        columns = []
        _columns = d.pop("columns")
        for columns_item_data in _columns:
            columns_item = GetSchemaResponse200ColumnsItem.from_dict(columns_item_data)

            columns.append(columns_item)

        functions = []
        _functions = d.pop("functions")
        for functions_item_data in _functions:
            functions_item = GetSchemaResponse200FunctionsItem.from_dict(
                functions_item_data
            )

            functions.append(functions_item)

        get_schema_response_200 = cls(
            columns=columns,
            functions=functions,
        )

        return get_schema_response_200
