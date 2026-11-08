from typing import Literal

GetReposFormat = Literal["csv", "json"]

GET_REPOS_FORMAT_VALUES: set[GetReposFormat] = {
    "csv",
    "json",
}


def check_get_repos_format(value: str) -> GetReposFormat:
    if value in GET_REPOS_FORMAT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_REPOS_FORMAT_VALUES!r}"
    )
