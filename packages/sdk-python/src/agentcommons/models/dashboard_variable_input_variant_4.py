from __future__ import annotations

from collections.abc import Mapping
from typing import (
    Any,
    Literal,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="DashboardVariableInputVariant4")


@_attrs_define
class DashboardVariableInputVariant4:
    """
    Attributes:
        name (str):
        type_ (Literal['text']):
        label (str | Unset):
        default (str | Unset):  Default: ''.
    """

    name: str
    type_: Literal["text"]
    label: str | Unset = UNSET
    default: str | Unset = ""

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_

        label = self.label

        default = self.default

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "type": type_,
            }
        )
        if label is not UNSET:
            field_dict["label"] = label
        if default is not UNSET:
            field_dict["default"] = default

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = cast(Literal["text"], d.pop("type"))
        if type_ != "text":
            raise ValueError(f"type must match const 'text', got '{type_}'")

        label = d.pop("label", UNSET)

        default = d.pop("default", UNSET)

        dashboard_variable_input_variant_4 = cls(
            name=name,
            type_=type_,
            label=label,
            default=default,
        )

        return dashboard_variable_input_variant_4
