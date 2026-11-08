from typing import Literal

GetSessionsSort = Literal[
    "agentcommons_search_calls",
    "branch",
    "duration_seconds",
    "harness",
    "harness_version",
    "installation_hostname",
    "last_activity_at",
    "message_count",
    "model",
    "observed_commit_count",
    "repo_name",
    "reuse_count",
    "reuses_made",
    "started_at",
    "status",
    "title",
    "tool_call_count",
    "user_email",
]

GET_SESSIONS_SORT_VALUES: set[GetSessionsSort] = {
    "agentcommons_search_calls",
    "branch",
    "duration_seconds",
    "harness",
    "harness_version",
    "installation_hostname",
    "last_activity_at",
    "message_count",
    "model",
    "observed_commit_count",
    "repo_name",
    "reuse_count",
    "reuses_made",
    "started_at",
    "status",
    "title",
    "tool_call_count",
    "user_email",
}


def check_get_sessions_sort(value: str) -> GetSessionsSort:
    if value in GET_SESSIONS_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_SORT_VALUES!r}"
    )
