from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetAdminStatusResponse200Projection")


@_attrs_define
class GetAdminStatusResponse200Projection:
    """
    Attributes:
        queued_sessions (int):
        outbox_batches (int):
        oldest_accepted_at (datetime.datetime | None):
        failed_sessions (int):
        waiting_source_sessions (int):
        pending_audit_events (int):
    """

    queued_sessions: int
    outbox_batches: int
    oldest_accepted_at: datetime.datetime | None
    failed_sessions: int
    waiting_source_sessions: int
    pending_audit_events: int

    def to_dict(self) -> dict[str, Any]:
        queued_sessions = self.queued_sessions

        outbox_batches = self.outbox_batches

        oldest_accepted_at: None | str
        if isinstance(self.oldest_accepted_at, datetime.datetime):
            oldest_accepted_at = self.oldest_accepted_at.isoformat()
        else:
            oldest_accepted_at = self.oldest_accepted_at

        failed_sessions = self.failed_sessions

        waiting_source_sessions = self.waiting_source_sessions

        pending_audit_events = self.pending_audit_events

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "queued_sessions": queued_sessions,
                "outbox_batches": outbox_batches,
                "oldest_accepted_at": oldest_accepted_at,
                "failed_sessions": failed_sessions,
                "waiting_source_sessions": waiting_source_sessions,
                "pending_audit_events": pending_audit_events,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        queued_sessions = d.pop("queued_sessions")

        outbox_batches = d.pop("outbox_batches")

        def _parse_oldest_accepted_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                oldest_accepted_at_type_0 = datetime.datetime.fromisoformat(data)

                return oldest_accepted_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        oldest_accepted_at = _parse_oldest_accepted_at(d.pop("oldest_accepted_at"))

        failed_sessions = d.pop("failed_sessions")

        waiting_source_sessions = d.pop("waiting_source_sessions")

        pending_audit_events = d.pop("pending_audit_events")

        get_admin_status_response_200_projection = cls(
            queued_sessions=queued_sessions,
            outbox_batches=outbox_batches,
            oldest_accepted_at=oldest_accepted_at,
            failed_sessions=failed_sessions,
            waiting_source_sessions=waiting_source_sessions,
            pending_audit_events=pending_audit_events,
        )

        return get_admin_status_response_200_projection
