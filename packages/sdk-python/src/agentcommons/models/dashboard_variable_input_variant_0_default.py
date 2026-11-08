from typing import Literal

DashboardVariableInputVariant0Default = Literal[
    "14d", "24h", "30d", "7d", "90d", "all", "last_week", "this_month", "this_week"
]

DASHBOARD_VARIABLE_INPUT_VARIANT_0_DEFAULT_VALUES: set[
    DashboardVariableInputVariant0Default
] = {
    "14d",
    "24h",
    "30d",
    "7d",
    "90d",
    "all",
    "last_week",
    "this_month",
    "this_week",
}


def check_dashboard_variable_input_variant_0_default(
    value: str,
) -> DashboardVariableInputVariant0Default:
    if value in DASHBOARD_VARIABLE_INPUT_VARIANT_0_DEFAULT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {DASHBOARD_VARIABLE_INPUT_VARIANT_0_DEFAULT_VALUES!r}"
    )
