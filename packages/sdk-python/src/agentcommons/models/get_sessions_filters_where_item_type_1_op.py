from typing import Literal

GetSessionsFiltersWhereItemType1Op = Literal["contains"]

GET_SESSIONS_FILTERS_WHERE_ITEM_TYPE_1_OP_VALUES: set[
    GetSessionsFiltersWhereItemType1Op
] = {
    "contains",
}


def check_get_sessions_filters_where_item_type_1_op(
    value: str,
) -> GetSessionsFiltersWhereItemType1Op:
    if value in GET_SESSIONS_FILTERS_WHERE_ITEM_TYPE_1_OP_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_FILTERS_WHERE_ITEM_TYPE_1_OP_VALUES!r}"
    )
