from typing import Literal

DashboardChartInputSeriesItemType = Literal[
    "bar", "gauge", "heatmap", "line", "pie", "scatter"
]

DASHBOARD_CHART_INPUT_SERIES_ITEM_TYPE_VALUES: set[
    DashboardChartInputSeriesItemType
] = {
    "bar",
    "gauge",
    "heatmap",
    "line",
    "pie",
    "scatter",
}


def check_dashboard_chart_input_series_item_type(
    value: str,
) -> DashboardChartInputSeriesItemType:
    if value in DASHBOARD_CHART_INPUT_SERIES_ITEM_TYPE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {DASHBOARD_CHART_INPUT_SERIES_ITEM_TYPE_VALUES!r}"
    )
