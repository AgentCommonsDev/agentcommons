from typing import Literal

GetSessionsFiltersWhereItemType2Op = Literal["starts_with"]

GET_SESSIONS_FILTERS_WHERE_ITEM_TYPE_2_OP_VALUES: set[
    GetSessionsFiltersWhereItemType2Op
] = {
    "starts_with",
}


def check_get_sessions_filters_where_item_type_2_op(
    value: str,
) -> GetSessionsFiltersWhereItemType2Op:
    if value in GET_SESSIONS_FILTERS_WHERE_ITEM_TYPE_2_OP_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_FILTERS_WHERE_ITEM_TYPE_2_OP_VALUES!r}"
    )
