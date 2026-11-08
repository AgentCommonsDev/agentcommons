from typing import Literal

GetMeKeysSort = Literal[
    "created_at", "enabled", "expires_at", "last_used_at", "name", "user_id"
]

GET_ME_KEYS_SORT_VALUES: set[GetMeKeysSort] = {
    "created_at",
    "enabled",
    "expires_at",
    "last_used_at",
    "name",
    "user_id",
}


def check_get_me_keys_sort(value: str) -> GetMeKeysSort:
    if value in GET_ME_KEYS_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ME_KEYS_SORT_VALUES!r}"
    )
