from typing import Literal

GetReposOrder = Literal["asc", "desc"]

GET_REPOS_ORDER_VALUES: set[GetReposOrder] = {
    "asc",
    "desc",
}


def check_get_repos_order(value: str) -> GetReposOrder:
    if value in GET_REPOS_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_REPOS_ORDER_VALUES!r}"
    )
