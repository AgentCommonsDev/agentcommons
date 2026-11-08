from typing import Literal

GetAdminKeysSort = Literal[
    "created_at", "enabled", "expires_at", "last_used_at", "name", "user_id"
]

GET_ADMIN_KEYS_SORT_VALUES: set[GetAdminKeysSort] = {
    "created_at",
    "enabled",
    "expires_at",
    "last_used_at",
    "name",
    "user_id",
}


def check_get_admin_keys_sort(value: str) -> GetAdminKeysSort:
    if value in GET_ADMIN_KEYS_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_KEYS_SORT_VALUES!r}"
    )
