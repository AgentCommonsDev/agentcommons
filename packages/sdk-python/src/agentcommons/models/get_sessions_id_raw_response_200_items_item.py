from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_sessions_id_raw_response_200_items_item_payload_fragment_type_0 import (
        GetSessionsIdRawResponse200ItemsItemPayloadFragmentType0,
    )


T = TypeVar("T", bound="GetSessionsIdRawResponse200ItemsItem")


@_attrs_define
class GetSessionsIdRawResponse200ItemsItem:
    """
    Attributes:
        id (UUID):
        session_id (UUID):
        organization_id (str):
        pos (str):
        key (None | str):
        source_version (int):
        record_type (str):
        payload (Any):
        payload_fragment (GetSessionsIdRawResponse200ItemsItemPayloadFragmentType0 | None):
        ingest_batch_id (UUID):
        received_at (datetime.datetime):
    """

    id: UUID
    session_id: UUID
    organization_id: str
    pos: str
    key: None | str
    source_version: int
    record_type: str
    payload: Any
    payload_fragment: GetSessionsIdRawResponse200ItemsItemPayloadFragmentType0 | None
    ingest_batch_id: UUID
    received_at: datetime.datetime

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_sessions_id_raw_response_200_items_item_payload_fragment_type_0 import (
            GetSessionsIdRawResponse200ItemsItemPayloadFragmentType0,  # noqa: PLC0415
        )

        id = str(self.id)

        session_id = str(self.session_id)

        organization_id = self.organization_id

        pos = self.pos

        key: None | str
        key = self.key

        source_version = self.source_version

        record_type = self.record_type

        payload = self.payload

        payload_fragment: dict[str, Any] | None
        if isinstance(
            self.payload_fragment,
            GetSessionsIdRawResponse200ItemsItemPayloadFragmentType0,
        ):
            payload_fragment = self.payload_fragment.to_dict()
        else:
            payload_fragment = self.payload_fragment

        ingest_batch_id = str(self.ingest_batch_id)

        received_at = self.received_at.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "session_id": session_id,
                "organization_id": organization_id,
                "pos": pos,
                "key": key,
                "source_version": source_version,
                "record_type": record_type,
                "payload": payload,
                "payload_fragment": payload_fragment,
                "ingest_batch_id": ingest_batch_id,
                "received_at": received_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_sessions_id_raw_response_200_items_item_payload_fragment_type_0 import (
            GetSessionsIdRawResponse200ItemsItemPayloadFragmentType0,  # noqa: PLC0415
        )

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        session_id = UUID(d.pop("session_id"))

        organization_id = d.pop("organization_id")

        pos = d.pop("pos")

        def _parse_key(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        key = _parse_key(d.pop("key"))

        source_version = d.pop("source_version")

        record_type = d.pop("record_type")

        payload = d.pop("payload")

        def _parse_payload_fragment(
            data: object,
        ) -> GetSessionsIdRawResponse200ItemsItemPayloadFragmentType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                payload_fragment_type_0 = (
                    GetSessionsIdRawResponse200ItemsItemPayloadFragmentType0.from_dict(
                        data
                    )
                )

                return payload_fragment_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                GetSessionsIdRawResponse200ItemsItemPayloadFragmentType0 | None, data
            )

        payload_fragment = _parse_payload_fragment(d.pop("payload_fragment"))

        ingest_batch_id = UUID(d.pop("ingest_batch_id"))

        received_at = datetime.datetime.fromisoformat(d.pop("received_at"))

        get_sessions_id_raw_response_200_items_item = cls(
            id=id,
            session_id=session_id,
            organization_id=organization_id,
            pos=pos,
            key=key,
            source_version=source_version,
            record_type=record_type,
            payload=payload,
            payload_fragment=payload_fragment,
            ingest_batch_id=ingest_batch_id,
            received_at=received_at,
        )

        return get_sessions_id_raw_response_200_items_item
