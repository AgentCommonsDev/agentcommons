from typing import Literal

GetAdminRedactionRescanIdResponse200State = Literal[
    "completed", "failed", "queued", "running"
]

GET_ADMIN_REDACTION_RESCAN_ID_RESPONSE_200_STATE_VALUES: set[
    GetAdminRedactionRescanIdResponse200State
] = {
    "completed",
    "failed",
    "queued",
    "running",
}


def check_get_admin_redaction_rescan_id_response_200_state(
    value: str,
) -> GetAdminRedactionRescanIdResponse200State:
    if value in GET_ADMIN_REDACTION_RESCAN_ID_RESPONSE_200_STATE_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_REDACTION_RESCAN_ID_RESPONSE_200_STATE_VALUES!r}"
    )
