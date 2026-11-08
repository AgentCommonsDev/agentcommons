from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_admin_metrics_group_response_200_items_item_metric import (
    GetAdminMetricsGroupResponse200ItemsItemMetric,
    check_get_admin_metrics_group_response_200_items_item_metric,
)
from ..models.get_admin_metrics_group_response_200_items_item_unit import (
    GetAdminMetricsGroupResponse200ItemsItemUnit,
    check_get_admin_metrics_group_response_200_items_item_unit,
)

T = TypeVar("T", bound="GetAdminMetricsGroupResponse200ItemsItem")


@_attrs_define
class GetAdminMetricsGroupResponse200ItemsItem:
    """
    Attributes:
        metric (GetAdminMetricsGroupResponse200ItemsItemMetric):
        date (datetime.date | None):
        repo_name (None | str):
        harness (None | str):
        user_id (None | str):
        tool (None | str):
        policy_id (None | str):
        tools_enabled (bool | None):
        value (float | None):
        numerator (float | None):
        denominator (float | None):
        unit (GetAdminMetricsGroupResponse200ItemsItemUnit):
        truncated_fields (list[str]): Fields shortened to fit the response
    """

    metric: GetAdminMetricsGroupResponse200ItemsItemMetric
    date: datetime.date | None
    repo_name: None | str
    harness: None | str
    user_id: None | str
    tool: None | str
    policy_id: None | str
    tools_enabled: bool | None
    value: float | None
    numerator: float | None
    denominator: float | None
    unit: GetAdminMetricsGroupResponse200ItemsItemUnit
    truncated_fields: list[str]

    def to_dict(self) -> dict[str, Any]:
        metric: str = self.metric

        date: None | str
        if isinstance(self.date, datetime.date):
            date = self.date.isoformat()
        else:
            date = self.date

        repo_name: None | str
        repo_name = self.repo_name

        harness: None | str
        harness = self.harness

        user_id: None | str
        user_id = self.user_id

        tool: None | str
        tool = self.tool

        policy_id: None | str
        policy_id = self.policy_id

        tools_enabled: bool | None
        tools_enabled = self.tools_enabled

        value: float | None
        value = self.value

        numerator: float | None
        numerator = self.numerator

        denominator: float | None
        denominator = self.denominator

        unit: str = self.unit

        truncated_fields = self.truncated_fields

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "metric": metric,
                "date": date,
                "repo_name": repo_name,
                "harness": harness,
                "user_id": user_id,
                "tool": tool,
                "policy_id": policy_id,
                "tools_enabled": tools_enabled,
                "value": value,
                "numerator": numerator,
                "denominator": denominator,
                "unit": unit,
                "truncated_fields": truncated_fields,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        metric = check_get_admin_metrics_group_response_200_items_item_metric(
            d.pop("metric")
        )

        def _parse_date(data: object) -> datetime.date | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                date_type_0 = datetime.date.fromisoformat(data)

                return date_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.date | None, data)

        date = _parse_date(d.pop("date"))

        def _parse_repo_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        repo_name = _parse_repo_name(d.pop("repo_name"))

        def _parse_harness(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        harness = _parse_harness(d.pop("harness"))

        def _parse_user_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        user_id = _parse_user_id(d.pop("user_id"))

        def _parse_tool(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        tool = _parse_tool(d.pop("tool"))

        def _parse_policy_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        policy_id = _parse_policy_id(d.pop("policy_id"))

        def _parse_tools_enabled(data: object) -> bool | None:
            if data is None:
                return data
            return cast(bool | None, data)

        tools_enabled = _parse_tools_enabled(d.pop("tools_enabled"))

        def _parse_value(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        value = _parse_value(d.pop("value"))

        def _parse_numerator(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        numerator = _parse_numerator(d.pop("numerator"))

        def _parse_denominator(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        denominator = _parse_denominator(d.pop("denominator"))

        unit = check_get_admin_metrics_group_response_200_items_item_unit(d.pop("unit"))

        truncated_fields = cast(list[str], d.pop("truncated_fields"))

        get_admin_metrics_group_response_200_items_item = cls(
            metric=metric,
            date=date,
            repo_name=repo_name,
            harness=harness,
            user_id=user_id,
            tool=tool,
            policy_id=policy_id,
            tools_enabled=tools_enabled,
            value=value,
            numerator=numerator,
            denominator=denominator,
            unit=unit,
            truncated_fields=truncated_fields,
        )

        return get_admin_metrics_group_response_200_items_item
