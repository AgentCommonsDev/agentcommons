from typing import Literal

DashboardChartSeriesItemType = Literal[
    "bar", "gauge", "heatmap", "line", "pie", "scatter"
]

DASHBOARD_CHART_SERIES_ITEM_TYPE_VALUES: set[DashboardChartSeriesItemType] = {
    "bar",
    "gauge",
    "heatmap",
    "line",
    "pie",
    "scatter",
}


def check_dashboard_chart_series_item_type(value: str) -> DashboardChartSeriesItemType:
    if value in DASHBOARD_CHART_SERIES_ITEM_TYPE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {DASHBOARD_CHART_SERIES_ITEM_TYPE_VALUES!r}"
    )
