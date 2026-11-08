from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetAdminRedactionRescanIdSessionsResponse200ItemsItem")


@_attrs_define
class GetAdminRedactionRescanIdSessionsResponse200ItemsItem:
    """
    Attributes:
        run_id (UUID):
        session_id (UUID):
        processed_at (datetime.datetime | None):
        redaction_count (int):
    """

    run_id: UUID
    session_id: UUID
    processed_at: datetime.datetime | None
    redaction_count: int

    def to_dict(self) -> dict[str, Any]:
        run_id = str(self.run_id)

        session_id = str(self.session_id)

        processed_at: None | str
        if isinstance(self.processed_at, datetime.datetime):
            processed_at = self.processed_at.isoformat()
        else:
            processed_at = self.processed_at

        redaction_count = self.redaction_count

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "run_id": run_id,
                "session_id": session_id,
                "processed_at": processed_at,
                "redaction_count": redaction_count,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        run_id = UUID(d.pop("run_id"))

        session_id = UUID(d.pop("session_id"))

        def _parse_processed_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                processed_at_type_0 = datetime.datetime.fromisoformat(data)

                return processed_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        processed_at = _parse_processed_at(d.pop("processed_at"))

        redaction_count = d.pop("redaction_count")

        get_admin_redaction_rescan_id_sessions_response_200_items_item = cls(
            run_id=run_id,
            session_id=session_id,
            processed_at=processed_at,
            redaction_count=redaction_count,
        )

        return get_admin_redaction_rescan_id_sessions_response_200_items_item
