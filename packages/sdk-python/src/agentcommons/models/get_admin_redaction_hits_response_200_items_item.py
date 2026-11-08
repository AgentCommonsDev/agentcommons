from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_admin_redaction_hits_response_200_items_item_source import (
    GetAdminRedactionHitsResponse200ItemsItemSource,
    check_get_admin_redaction_hits_response_200_items_item_source,
)

T = TypeVar("T", bound="GetAdminRedactionHitsResponse200ItemsItem")


@_attrs_define
class GetAdminRedactionHitsResponse200ItemsItem:
    """
    Attributes:
        id (UUID):
        session_id (UUID):
        ingest_batch_id (UUID):
        run_id (None | UUID):
        source (GetAdminRedactionHitsResponse200ItemsItemSource):
        policy_id (UUID):
        policy_name (None | str):
        seq (int | None):
        count (int):
        masked_preview (None | str):
        fingerprint (None | str):
        match_length (int | None):
        redacted_at (datetime.datetime):
    """

    id: UUID
    session_id: UUID
    ingest_batch_id: UUID
    run_id: None | UUID
    source: GetAdminRedactionHitsResponse200ItemsItemSource
    policy_id: UUID
    policy_name: None | str
    seq: int | None
    count: int
    masked_preview: None | str
    fingerprint: None | str
    match_length: int | None
    redacted_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        session_id = str(self.session_id)

        ingest_batch_id = str(self.ingest_batch_id)

        run_id: None | str
        if isinstance(self.run_id, UUID):
            run_id = str(self.run_id)
        else:
            run_id = self.run_id

        source: str = self.source

        policy_id = str(self.policy_id)

        policy_name: None | str
        policy_name = self.policy_name

        seq: int | None
        seq = self.seq

        count = self.count

        masked_preview: None | str
        masked_preview = self.masked_preview

        fingerprint: None | str
        fingerprint = self.fingerprint

        match_length: int | None
        match_length = self.match_length

        redacted_at = self.redacted_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "session_id": session_id,
                "ingest_batch_id": ingest_batch_id,
                "run_id": run_id,
                "source": source,
                "policy_id": policy_id,
                "policy_name": policy_name,
                "seq": seq,
                "count": count,
                "masked_preview": masked_preview,
                "fingerprint": fingerprint,
                "match_length": match_length,
                "redacted_at": redacted_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        session_id = UUID(d.pop("session_id"))

        ingest_batch_id = UUID(d.pop("ingest_batch_id"))

        def _parse_run_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                run_id_type_0 = UUID(data)

                return run_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        run_id = _parse_run_id(d.pop("run_id"))

        source = check_get_admin_redaction_hits_response_200_items_item_source(
            d.pop("source")
        )

        policy_id = UUID(d.pop("policy_id"))

        def _parse_policy_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        policy_name = _parse_policy_name(d.pop("policy_name"))

        def _parse_seq(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        seq = _parse_seq(d.pop("seq"))

        count = d.pop("count")

        def _parse_masked_preview(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        masked_preview = _parse_masked_preview(d.pop("masked_preview"))

        def _parse_fingerprint(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        fingerprint = _parse_fingerprint(d.pop("fingerprint"))

        def _parse_match_length(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        match_length = _parse_match_length(d.pop("match_length"))

        redacted_at = datetime.datetime.fromisoformat(d.pop("redacted_at"))

        get_admin_redaction_hits_response_200_items_item = cls(
            id=id,
            session_id=session_id,
            ingest_batch_id=ingest_batch_id,
            run_id=run_id,
            source=source,
            policy_id=policy_id,
            policy_name=policy_name,
            seq=seq,
            count=count,
            masked_preview=masked_preview,
            fingerprint=fingerprint,
            match_length=match_length,
            redacted_at=redacted_at,
        )

        return get_admin_redaction_hits_response_200_items_item
