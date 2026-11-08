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

T = TypeVar("T", bound="DashboardVariableInputVariant1")


@_attrs_define
class DashboardVariableInputVariant1:
    """
    Attributes:
        name (str):
        type_ (Literal['repo']):
        label (str | Unset):
    """

    name: str
    type_: Literal["repo"]
    label: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_

        label = self.label

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "type": type_,
            }
        )
        if label is not UNSET:
            field_dict["label"] = label

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        type_ = cast(Literal["repo"], d.pop("type"))
        if type_ != "repo":
            raise ValueError(f"type must match const 'repo', got '{type_}'")

        label = d.pop("label", UNSET)

        dashboard_variable_input_variant_1 = cls(
            name=name,
            type_=type_,
            label=label,
        )

        return dashboard_variable_input_variant_1
