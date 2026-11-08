from typing import Literal

GetSessionsFiltersWhereItemType3Op = Literal["exists"]

GET_SESSIONS_FILTERS_WHERE_ITEM_TYPE_3_OP_VALUES: set[
    GetSessionsFiltersWhereItemType3Op
] = {
    "exists",
}


def check_get_sessions_filters_where_item_type_3_op(
    value: str,
) -> GetSessionsFiltersWhereItemType3Op:
    if value in GET_SESSIONS_FILTERS_WHERE_ITEM_TYPE_3_OP_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_FILTERS_WHERE_ITEM_TYPE_3_OP_VALUES!r}"
    )
