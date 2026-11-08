from typing import Literal

DashboardChartInputSeriesItemStepType1 = Literal["end", "middle", "start"]

DASHBOARD_CHART_INPUT_SERIES_ITEM_STEP_TYPE_1_VALUES: set[
    DashboardChartInputSeriesItemStepType1
] = {
    "end",
    "middle",
    "start",
}


def check_dashboard_chart_input_series_item_step_type_1(
    value: str,
) -> DashboardChartInputSeriesItemStepType1:
    if value in DASHBOARD_CHART_INPUT_SERIES_ITEM_STEP_TYPE_1_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {DASHBOARD_CHART_INPUT_SERIES_ITEM_STEP_TYPE_1_VALUES!r}"
    )
