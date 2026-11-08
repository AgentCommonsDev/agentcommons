from __future__ import annotations

from collections.abc import Mapping
from typing import (
    Any,
    Literal,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define

from ..models.dashboard_variable_input_variant_0_default import (
    DashboardVariableInputVariant0Default,
    check_dashboard_variable_input_variant_0_default,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="DashboardVariableInputVariant0")


@_attrs_define
class DashboardVariableInputVariant0:
    """
    Attributes:
        name (str):
        type_ (Literal['time_range']):
        label (str | Unset):
        default (DashboardVariableInputVariant0Default | Unset):  Default: '30d'.
    """

    name: str
    type_: Literal["time_range"]
    label: str | Unset = UNSET
    default: DashboardVariableInputVariant0Default | Unset = "30d"

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        type_ = self.type_

        label = self.label

        default: str | Unset = UNSET
        if not isinstance(self.default, Unset):
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

        type_ = cast(Literal["time_range"], d.pop("type"))
        if type_ != "time_range":
            raise ValueError(f"type must match const 'time_range', got '{type_}'")

        label = d.pop("label", UNSET)

        _default = d.pop("default", UNSET)
        default: DashboardVariableInputVariant0Default | Unset
        if isinstance(_default, Unset):
            default = UNSET
        else:
            default = check_dashboard_variable_input_variant_0_default(_default)

        dashboard_variable_input_variant_0 = cls(
            name=name,
            type_=type_,
            label=label,
            default=default,
        )

        return dashboard_variable_input_variant_0
