from typing import Literal

DashboardTileInputVariant0Unit = Literal[
    "count", "milliseconds", "ratio", "seconds", "tokens", "usd"
]

DASHBOARD_TILE_INPUT_VARIANT_0_UNIT_VALUES: set[DashboardTileInputVariant0Unit] = {
    "count",
    "milliseconds",
    "ratio",
    "seconds",
    "tokens",
    "usd",
}


def check_dashboard_tile_input_variant_0_unit(
    value: str,
) -> DashboardTileInputVariant0Unit:
    if value in DASHBOARD_TILE_INPUT_VARIANT_0_UNIT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {DASHBOARD_TILE_INPUT_VARIANT_0_UNIT_VALUES!r}"
    )
