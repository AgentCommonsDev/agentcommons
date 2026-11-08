from typing import Literal

GetSessionsIdResponse200HeaderType0Harness = Literal[
    "CLAUDE_CODE", "CODEX", "GEMINI_CLI", "PI"
]

GET_SESSIONS_ID_RESPONSE_200_HEADER_TYPE_0_HARNESS_VALUES: set[
    GetSessionsIdResponse200HeaderType0Harness
] = {
    "CLAUDE_CODE",
    "CODEX",
    "GEMINI_CLI",
    "PI",
}


def check_get_sessions_id_response_200_header_type_0_harness(
    value: str,
) -> GetSessionsIdResponse200HeaderType0Harness:
    if value in GET_SESSIONS_ID_RESPONSE_200_HEADER_TYPE_0_HARNESS_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_SESSIONS_ID_RESPONSE_200_HEADER_TYPE_0_HARNESS_VALUES!r}"
    )
