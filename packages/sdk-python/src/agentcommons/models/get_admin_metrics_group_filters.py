from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.get_admin_metrics_group_filters_metric import (
    GetAdminMetricsGroupFiltersMetric,
    check_get_admin_metrics_group_filters_metric,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetAdminMetricsGroupFilters")


@_attrs_define
class GetAdminMetricsGroupFilters:
    """
    Attributes:
        date_from (datetime.datetime | Unset):
        date_to (datetime.datetime | Unset):
        repo_name (str | Unset):
        metric (GetAdminMetricsGroupFiltersMetric | Unset):
    """

    date_from: datetime.datetime | Unset = UNSET
    date_to: datetime.datetime | Unset = UNSET
    repo_name: str | Unset = UNSET
    metric: GetAdminMetricsGroupFiltersMetric | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        date_from: str | Unset = UNSET
        if not isinstance(self.date_from, Unset):
            date_from = self.date_from.isoformat()

        date_to: str | Unset = UNSET
        if not isinstance(self.date_to, Unset):
            date_to = self.date_to.isoformat()

        repo_name = self.repo_name

        metric: str | Unset = UNSET
        if not isinstance(self.metric, Unset):
            metric = self.metric

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if date_from is not UNSET:
            field_dict["date_from"] = date_from
        if date_to is not UNSET:
            field_dict["date_to"] = date_to
        if repo_name is not UNSET:
            field_dict["repo_name"] = repo_name
        if metric is not UNSET:
            field_dict["metric"] = metric

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _date_from = d.pop("date_from", UNSET)
        date_from: datetime.datetime | Unset
        if isinstance(_date_from, Unset):
            date_from = UNSET
        else:
            date_from = datetime.datetime.fromisoformat(_date_from)

        _date_to = d.pop("date_to", UNSET)
        date_to: datetime.datetime | Unset
        if isinstance(_date_to, Unset):
            date_to = UNSET
        else:
            date_to = datetime.datetime.fromisoformat(_date_to)

        repo_name = d.pop("repo_name", UNSET)

        _metric = d.pop("metric", UNSET)
        metric: GetAdminMetricsGroupFiltersMetric | Unset
        if isinstance(_metric, Unset):
            metric = UNSET
        else:
            metric = check_get_admin_metrics_group_filters_metric(_metric)

        get_admin_metrics_group_filters = cls(
            date_from=date_from,
            date_to=date_to,
            repo_name=repo_name,
            metric=metric,
        )

        return get_admin_metrics_group_filters
