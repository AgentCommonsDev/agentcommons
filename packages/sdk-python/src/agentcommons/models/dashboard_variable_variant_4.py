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

T = TypeVar("T", bound="DashboardVariableVariant4")


@_attrs_define
class DashboardVariableVariant4:
    """
    Attributes:
        name (str):
        type_ (Literal['text']):
        default (str):  Default: ''.
        label (str | Unset):
    """

    name: str
    type_: Literal["text"]
    default: str = ""
    label: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_

        default = self.default

        label = self.label

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "type": type_,
                "default": default,
            }
        )
        if label is not UNSET:
            field_dict["label"] = label

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = cast(Literal["text"], d.pop("type"))
        if type_ != "text":
            raise ValueError(f"type must match const 'text', got '{type_}'")

        default = d.pop("default")

        label = d.pop("label", UNSET)

        dashboard_variable_variant_4 = cls(
            name=name,
            type_=type_,
            default=default,
            label=label,
        )

        return dashboard_variable_variant_4
