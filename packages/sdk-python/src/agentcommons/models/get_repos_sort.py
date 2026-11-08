from typing import Literal

GetReposSort = Literal[
    "first_seen_at", "last_activity_at", "repo_name", "session_count", "user_count"
]

GET_REPOS_SORT_VALUES: set[GetReposSort] = {
    "first_seen_at",
    "last_activity_at",
    "repo_name",
    "session_count",
    "user_count",
}


def check_get_repos_sort(value: str) -> GetReposSort:
    if value in GET_REPOS_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_REPOS_SORT_VALUES!r}"
    )
