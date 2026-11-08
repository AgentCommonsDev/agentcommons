from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_admin_redaction_rescan_response_200_items_item_state import (
    GetAdminRedactionRescanResponse200ItemsItemState,
    check_get_admin_redaction_rescan_response_200_items_item_state,
)

T = TypeVar("T", bound="GetAdminRedactionRescanResponse200ItemsItem")


@_attrs_define
class GetAdminRedactionRescanResponse200ItemsItem:
    """
    Attributes:
        id (UUID):
        state (GetAdminRedactionRescanResponse200ItemsItemState):
        created_at (datetime.datetime):
        updated_at (datetime.datetime):
        total_sessions (int):
        processed_sessions (int):
        changed_sessions (int):
        redaction_count (int):
        error (None | str):
    """

    id: UUID
    state: GetAdminRedactionRescanResponse200ItemsItemState
    created_at: datetime.datetime
    updated_at: datetime.datetime
    total_sessions: int
    processed_sessions: int
    changed_sessions: int
    redaction_count: int
    error: None | str

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        state: str = self.state

        created_at = self.created_at.isoformat()

        updated_at = self.updated_at.isoformat()

        total_sessions = self.total_sessions

        processed_sessions = self.processed_sessions

        changed_sessions = self.changed_sessions

        redaction_count = self.redaction_count

        error: None | str
        error = self.error

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "state": state,
                "created_at": created_at,
                "updated_at": updated_at,
                "total_sessions": total_sessions,
                "processed_sessions": processed_sessions,
                "changed_sessions": changed_sessions,
                "redaction_count": redaction_count,
                "error": error,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        state = check_get_admin_redaction_rescan_response_200_items_item_state(
            d.pop("state")
        )

        created_at = datetime.datetime.fromisoformat(d.pop("created_at"))

        updated_at = datetime.datetime.fromisoformat(d.pop("updated_at"))

        total_sessions = d.pop("total_sessions")

        processed_sessions = d.pop("processed_sessions")

        changed_sessions = d.pop("changed_sessions")

        redaction_count = d.pop("redaction_count")

        def _parse_error(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        error = _parse_error(d.pop("error"))

        get_admin_redaction_rescan_response_200_items_item = cls(
            id=id,
            state=state,
            created_at=created_at,
            updated_at=updated_at,
            total_sessions=total_sessions,
            processed_sessions=processed_sessions,
            changed_sessions=changed_sessions,
            redaction_count=redaction_count,
            error=error,
        )

        return get_admin_redaction_rescan_response_200_items_item
