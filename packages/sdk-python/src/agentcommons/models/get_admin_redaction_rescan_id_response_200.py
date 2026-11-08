from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_admin_redaction_rescan_id_response_200_state import (
    GetAdminRedactionRescanIdResponse200State,
    check_get_admin_redaction_rescan_id_response_200_state,
)

T = TypeVar("T", bound="GetAdminRedactionRescanIdResponse200")


@_attrs_define
class GetAdminRedactionRescanIdResponse200:
    """
    Attributes:
        job_id (str):
        state (GetAdminRedactionRescanIdResponse200State):
        total_sessions (int):
        processed_sessions (int):
        redaction_count (int):
        error (None | str):
    """

    job_id: str
    state: GetAdminRedactionRescanIdResponse200State
    total_sessions: int
    processed_sessions: int
    redaction_count: int
    error: None | str

    def to_dict(self) -> dict[str, Any]:
        job_id = self.job_id

        state: str = self.state

        total_sessions = self.total_sessions

        processed_sessions = self.processed_sessions

        redaction_count = self.redaction_count

        error: None | str
        error = self.error

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "job_id": job_id,
                "state": state,
                "total_sessions": total_sessions,
                "processed_sessions": processed_sessions,
                "redaction_count": redaction_count,
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        job_id = d.pop("job_id")

        state = check_get_admin_redaction_rescan_id_response_200_state(d.pop("state"))

        total_sessions = d.pop("total_sessions")

        processed_sessions = d.pop("processed_sessions")

        redaction_count = d.pop("redaction_count")

        def _parse_error(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        error = _parse_error(d.pop("error"))

        get_admin_redaction_rescan_id_response_200 = cls(
            job_id=job_id,
            state=state,
            total_sessions=total_sessions,
            processed_sessions=processed_sessions,
            redaction_count=redaction_count,
            error=error,
        )

        return get_admin_redaction_rescan_id_response_200
