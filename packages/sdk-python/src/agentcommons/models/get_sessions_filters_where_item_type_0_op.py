from typing import Literal

GetSessionsFiltersWhereItemType0Op = Literal["eq"]

GET_SESSIONS_FILTERS_WHERE_ITEM_TYPE_0_OP_VALUES: set[
    GetSessionsFiltersWhereItemType0Op
] = {
    "eq",
}


def check_get_sessions_filters_where_item_type_0_op(
    value: str,
) -> GetSessionsFiltersWhereItemType0Op:
    if value in GET_SESSIONS_FILTERS_WHERE_ITEM_TYPE_0_OP_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_FILTERS_WHERE_ITEM_TYPE_0_OP_VALUES!r}"
    )
