from typing import Literal

DashboardTileVariant1Unit = Literal[
    "count", "milliseconds", "ratio", "seconds", "tokens", "usd"
]

DASHBOARD_TILE_VARIANT_1_UNIT_VALUES: set[DashboardTileVariant1Unit] = {
    "count",
    "milliseconds",
    "ratio",
    "seconds",
    "tokens",
    "usd",
}


def check_dashboard_tile_variant_1_unit(value: str) -> DashboardTileVariant1Unit:
    if value in DASHBOARD_TILE_VARIANT_1_UNIT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {DASHBOARD_TILE_VARIANT_1_UNIT_VALUES!r}"
    )
