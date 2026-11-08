from typing import Literal

DashboardTileVariant0Unit = Literal[
    "count", "milliseconds", "ratio", "seconds", "tokens", "usd"
]

DASHBOARD_TILE_VARIANT_0_UNIT_VALUES: set[DashboardTileVariant0Unit] = {
    "count",
    "milliseconds",
    "ratio",
    "seconds",
    "tokens",
    "usd",
}


def check_dashboard_tile_variant_0_unit(value: str) -> DashboardTileVariant0Unit:
    if value in DASHBOARD_TILE_VARIANT_0_UNIT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {DASHBOARD_TILE_VARIANT_0_UNIT_VALUES!r}"
    )
