from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetSchemaResponse200FunctionsItem")


@_attrs_define
class GetSchemaResponse200FunctionsItem:
    """
    Attributes:
        function_name (str):
        arguments (str):
        result_type (str):
        description (None | str):
    """

    function_name: str
    arguments: str
    result_type: str
    description: None | str

    def to_dict(self) -> dict[str, Any]:
        function_name = self.function_name

        arguments = self.arguments

        result_type = self.result_type

        description: None | str
        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "function_name": function_name,
                "arguments": arguments,
                "result_type": result_type,
                "description": description,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        function_name = d.pop("function_name")

        arguments = d.pop("arguments")

        result_type = d.pop("result_type")

        def _parse_description(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        description = _parse_description(d.pop("description"))

        get_schema_response_200_functions_item = cls(
            function_name=function_name,
            arguments=arguments,
            result_type=result_type,
            description=description,
        )

        return get_schema_response_200_functions_item
