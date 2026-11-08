from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.post_ingest_body_behavior import (
    PostIngestBodyBehavior,
    check_post_ingest_body_behavior,
)
from ..models.post_ingest_body_envelope_version import (
    PostIngestBodyEnvelopeVersion,
    check_post_ingest_body_envelope_version,
)
from ..models.post_ingest_body_harness import (
    PostIngestBodyHarness,
    check_post_ingest_body_harness,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_ingest_body_context import PostIngestBodyContext
    from ..models.post_ingest_body_end_type_0 import PostIngestBodyEndType0
    from ..models.post_ingest_body_hook import PostIngestBodyHook
    from ..models.post_ingest_body_records_item import PostIngestBodyRecordsItem
    from ..models.post_ingest_body_start_type_0 import PostIngestBodyStartType0


T = TypeVar("T", bound="PostIngestBody")


@_attrs_define
class PostIngestBody:
    """
    Attributes:
        envelope_version (PostIngestBodyEnvelopeVersion):
        harness (PostIngestBodyHarness):
        harness_session_id (str):
        behavior (PostIngestBodyBehavior):
        native_event (str):
        batch_id (UUID):
        installation_id (UUID):
        hook (PostIngestBodyHook):
        sent_at (datetime.datetime):
        source_pos (int):
        context (PostIngestBodyContext):
        records (list[PostIngestBodyRecordsItem]):
        cursor (str):
        end (None | PostIngestBodyEndType0):
        start (None | PostIngestBodyStartType0 | Unset):
    """

    envelope_version: PostIngestBodyEnvelopeVersion
    harness: PostIngestBodyHarness
    harness_session_id: str
    behavior: PostIngestBodyBehavior
    native_event: str
    batch_id: UUID
    installation_id: UUID
    hook: PostIngestBodyHook
    sent_at: datetime.datetime
    source_pos: int
    context: PostIngestBodyContext
    records: list[PostIngestBodyRecordsItem]
    cursor: str
    end: None | PostIngestBodyEndType0
    start: None | PostIngestBodyStartType0 | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_ingest_body_end_type_0 import (
            PostIngestBodyEndType0,  # noqa: PLC0415
        )
        from ..models.post_ingest_body_start_type_0 import (
            PostIngestBodyStartType0,  # noqa: PLC0415
        )

        envelope_version: int = self.envelope_version

        harness: str = self.harness

        harness_session_id = self.harness_session_id

        behavior: str = self.behavior

        native_event = self.native_event

        batch_id = str(self.batch_id)

        installation_id = str(self.installation_id)

        hook = self.hook.to_dict()

        sent_at = self.sent_at.isoformat()

        source_pos = self.source_pos

        context = self.context.to_dict()

        records = []
        for records_item_data in self.records:
            records_item = records_item_data.to_dict()
            records.append(records_item)

        cursor = self.cursor

        end: dict[str, Any] | None
        if isinstance(self.end, PostIngestBodyEndType0):
            end = self.end.to_dict()
        else:
            end = self.end

        start: dict[str, Any] | None | Unset
        if isinstance(self.start, Unset):
            start = UNSET
        elif isinstance(self.start, PostIngestBodyStartType0):
            start = self.start.to_dict()
        else:
            start = self.start

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "envelopeVersion": envelope_version,
                "harness": harness,
                "harnessSessionId": harness_session_id,
                "behavior": behavior,
                "nativeEvent": native_event,
                "batchId": batch_id,
                "installationId": installation_id,
                "hook": hook,
                "sentAt": sent_at,
                "sourcePos": source_pos,
                "context": context,
                "records": records,
                "cursor": cursor,
                "end": end,
            }
        )
        if start is not UNSET:
            field_dict["start"] = start

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_ingest_body_context import (
            PostIngestBodyContext,  # noqa: PLC0415
        )
        from ..models.post_ingest_body_end_type_0 import (
            PostIngestBodyEndType0,  # noqa: PLC0415
        )
        from ..models.post_ingest_body_hook import PostIngestBodyHook  # noqa: PLC0415
        from ..models.post_ingest_body_records_item import (
            PostIngestBodyRecordsItem,  # noqa: PLC0415
        )
        from ..models.post_ingest_body_start_type_0 import (
            PostIngestBodyStartType0,  # noqa: PLC0415
        )

        d = dict(src_dict)
        envelope_version = check_post_ingest_body_envelope_version(
            d.pop("envelopeVersion")
        )

        harness = check_post_ingest_body_harness(d.pop("harness"))

        harness_session_id = d.pop("harnessSessionId")

        behavior = check_post_ingest_body_behavior(d.pop("behavior"))

        native_event = d.pop("nativeEvent")

        batch_id = UUID(d.pop("batchId"))

        installation_id = UUID(d.pop("installationId"))

        hook = PostIngestBodyHook.from_dict(d.pop("hook"))

        sent_at = datetime.datetime.fromisoformat(d.pop("sentAt"))

        source_pos = d.pop("sourcePos")

        context = PostIngestBodyContext.from_dict(d.pop("context"))

        records = []
        _records = d.pop("records")
        for records_item_data in _records:
            records_item = PostIngestBodyRecordsItem.from_dict(records_item_data)

            records.append(records_item)

        cursor = d.pop("cursor")

        def _parse_end(data: object) -> None | PostIngestBodyEndType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                end_type_0 = PostIngestBodyEndType0.from_dict(data)

                return end_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostIngestBodyEndType0, data)

        end = _parse_end(d.pop("end"))

        def _parse_start(data: object) -> None | PostIngestBodyStartType0 | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                start_type_0 = PostIngestBodyStartType0.from_dict(data)

                return start_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostIngestBodyStartType0 | Unset, data)

        start = _parse_start(d.pop("start", UNSET))

        post_ingest_body = cls(
            envelope_version=envelope_version,
            harness=harness,
            harness_session_id=harness_session_id,
            behavior=behavior,
            native_event=native_event,
            batch_id=batch_id,
            installation_id=installation_id,
            hook=hook,
            sent_at=sent_at,
            source_pos=source_pos,
            context=context,
            records=records,
            cursor=cursor,
            end=end,
            start=start,
        )

        return post_ingest_body
