from typing import Literal

DashboardChartSeriesItemStepType1 = Literal["end", "middle", "start"]

DASHBOARD_CHART_SERIES_ITEM_STEP_TYPE_1_VALUES: set[
    DashboardChartSeriesItemStepType1
] = {
    "end",
    "middle",
    "start",
}


def check_dashboard_chart_series_item_step_type_1(
    value: str,
) -> DashboardChartSeriesItemStepType1:
    if value in DASHBOARD_CHART_SERIES_ITEM_STEP_TYPE_1_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {DASHBOARD_CHART_SERIES_ITEM_STEP_TYPE_1_VALUES!r}"
    )
