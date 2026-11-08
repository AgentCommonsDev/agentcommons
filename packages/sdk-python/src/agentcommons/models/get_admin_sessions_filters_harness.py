from typing import Literal

GetAdminSessionsFiltersHarness = Literal["CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"]

GET_ADMIN_SESSIONS_FILTERS_HARNESS_VALUES: set[GetAdminSessionsFiltersHarness] = {
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
}


def check_get_admin_sessions_filters_harness(
    value: str,
) -> GetAdminSessionsFiltersHarness:
    if value in GET_ADMIN_SESSIONS_FILTERS_HARNESS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_SESSIONS_FILTERS_HARNESS_VALUES!r}"
    )
