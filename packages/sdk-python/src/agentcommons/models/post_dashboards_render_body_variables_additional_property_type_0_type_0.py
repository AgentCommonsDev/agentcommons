from typing import Literal

PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type0 = Literal[
    "14d", "24h", "30d", "7d", "90d", "all", "last_week", "this_month", "this_week"
]

POST_DASHBOARDS_RENDER_BODY_VARIABLES_ADDITIONAL_PROPERTY_TYPE_0_TYPE_0_VALUES: set[
    PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type0
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


def check_post_dashboards_render_body_variables_additional_property_type_0_type_0(
    value: str,
) -> PostDashboardsRenderBodyVariablesAdditionalPropertyType0Type0:
    if (
        value
        in POST_DASHBOARDS_RENDER_BODY_VARIABLES_ADDITIONAL_PROPERTY_TYPE_0_TYPE_0_VALUES
    ):
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {POST_DASHBOARDS_RENDER_BODY_VARIABLES_ADDITIONAL_PROPERTY_TYPE_0_TYPE_0_VALUES!r}"
    )
