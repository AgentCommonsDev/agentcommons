from typing import Literal

DashboardTileInputVariant1Unit = Literal[
    "count", "milliseconds", "ratio", "seconds", "tokens", "usd"
]

DASHBOARD_TILE_INPUT_VARIANT_1_UNIT_VALUES: set[DashboardTileInputVariant1Unit] = {
    "count",
    "milliseconds",
    "ratio",
    "seconds",
    "tokens",
    "usd",
}


def check_dashboard_tile_input_variant_1_unit(
    value: str,
) -> DashboardTileInputVariant1Unit:
    if value in DASHBOARD_TILE_INPUT_VARIANT_1_UNIT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {DASHBOARD_TILE_INPUT_VARIANT_1_UNIT_VALUES!r}"
    )
