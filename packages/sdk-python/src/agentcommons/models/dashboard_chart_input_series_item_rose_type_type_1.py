from typing import Literal

DashboardChartInputSeriesItemRoseTypeType1 = Literal["area", "radius"]

DASHBOARD_CHART_INPUT_SERIES_ITEM_ROSE_TYPE_TYPE_1_VALUES: set[
    DashboardChartInputSeriesItemRoseTypeType1
] = {
    "area",
    "radius",
}


def check_dashboard_chart_input_series_item_rose_type_type_1(
    value: str,
) -> DashboardChartInputSeriesItemRoseTypeType1:
    if value in DASHBOARD_CHART_INPUT_SERIES_ITEM_ROSE_TYPE_TYPE_1_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {DASHBOARD_CHART_INPUT_SERIES_ITEM_ROSE_TYPE_TYPE_1_VALUES!r}"
    )
