from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_admin_status_response_200_failures_item import (
        GetAdminStatusResponse200FailuresItem,
    )
    from ..models.get_admin_status_response_200_ingest_per_day_item import (
        GetAdminStatusResponse200IngestPerDayItem,
    )
    from ..models.get_admin_status_response_200_projection import (
        GetAdminStatusResponse200Projection,
    )
    from ..models.get_admin_status_response_200_redaction_hits_item import (
        GetAdminStatusResponse200RedactionHitsItem,
    )
    from ..models.get_admin_status_response_200_server import (
        GetAdminStatusResponse200Server,
    )


T = TypeVar("T", bound="GetAdminStatusResponse200")


@_attrs_define
class GetAdminStatusResponse200:
    """
    Attributes:
        server (GetAdminStatusResponse200Server):
        projection (GetAdminStatusResponse200Projection):
        ingest_per_day (list[GetAdminStatusResponse200IngestPerDayItem]):
        redaction_hits (list[GetAdminStatusResponse200RedactionHitsItem]):
        failures (list[GetAdminStatusResponse200FailuresItem]):
        queue_depth (int):
        embedding_backlog (int):
        embedding_daily_tokens (str):
        embedding_daily_cost (str):
    """

    server: GetAdminStatusResponse200Server
    projection: GetAdminStatusResponse200Projection
    ingest_per_day: list[GetAdminStatusResponse200IngestPerDayItem]
    redaction_hits: list[GetAdminStatusResponse200RedactionHitsItem]
    failures: list[GetAdminStatusResponse200FailuresItem]
    queue_depth: int
    embedding_backlog: int
    embedding_daily_tokens: str
    embedding_daily_cost: str

    def to_dict(self) -> dict[str, Any]:
        server = self.server.to_dict()

        projection = self.projection.to_dict()

        ingest_per_day = []
        for ingest_per_day_item_data in self.ingest_per_day:
            ingest_per_day_item = ingest_per_day_item_data.to_dict()
            ingest_per_day.append(ingest_per_day_item)

        redaction_hits = []
        for redaction_hits_item_data in self.redaction_hits:
            redaction_hits_item = redaction_hits_item_data.to_dict()
            redaction_hits.append(redaction_hits_item)

        failures = []
        for failures_item_data in self.failures:
            failures_item = failures_item_data.to_dict()
            failures.append(failures_item)

        queue_depth = self.queue_depth

        embedding_backlog = self.embedding_backlog

        embedding_daily_tokens = self.embedding_daily_tokens

        embedding_daily_cost = self.embedding_daily_cost

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "server": server,
                "projection": projection,
                "ingest_per_day": ingest_per_day,
                "redaction_hits": redaction_hits,
                "failures": failures,
                "queue_depth": queue_depth,
                "embedding_backlog": embedding_backlog,
                "embedding_daily_tokens": embedding_daily_tokens,
                "embedding_daily_cost": embedding_daily_cost,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_admin_status_response_200_failures_item import (
            GetAdminStatusResponse200FailuresItem,  # noqa: PLC0415
        )
        from ..models.get_admin_status_response_200_ingest_per_day_item import (
            GetAdminStatusResponse200IngestPerDayItem,  # noqa: PLC0415
        )
        from ..models.get_admin_status_response_200_projection import (
            GetAdminStatusResponse200Projection,  # noqa: PLC0415
        )
        from ..models.get_admin_status_response_200_redaction_hits_item import (
            GetAdminStatusResponse200RedactionHitsItem,  # noqa: PLC0415
        )
        from ..models.get_admin_status_response_200_server import (
            GetAdminStatusResponse200Server,  # noqa: PLC0415
        )

        d = dict(src_dict)
        server = GetAdminStatusResponse200Server.from_dict(d.pop("server"))

        projection = GetAdminStatusResponse200Projection.from_dict(d.pop("projection"))

        ingest_per_day = []
        _ingest_per_day = d.pop("ingest_per_day")
        for ingest_per_day_item_data in _ingest_per_day:
            ingest_per_day_item = GetAdminStatusResponse200IngestPerDayItem.from_dict(
                ingest_per_day_item_data
            )

            ingest_per_day.append(ingest_per_day_item)

        redaction_hits = []
        _redaction_hits = d.pop("redaction_hits")
        for redaction_hits_item_data in _redaction_hits:
            redaction_hits_item = GetAdminStatusResponse200RedactionHitsItem.from_dict(
                redaction_hits_item_data
            )

            redaction_hits.append(redaction_hits_item)

        failures = []
        _failures = d.pop("failures")
        for failures_item_data in _failures:
            failures_item = GetAdminStatusResponse200FailuresItem.from_dict(
                failures_item_data
            )

            failures.append(failures_item)

        queue_depth = d.pop("queue_depth")

        embedding_backlog = d.pop("embedding_backlog")

        embedding_daily_tokens = d.pop("embedding_daily_tokens")

        embedding_daily_cost = d.pop("embedding_daily_cost")

        get_admin_status_response_200 = cls(
            server=server,
            projection=projection,
            ingest_per_day=ingest_per_day,
            redaction_hits=redaction_hits,
            failures=failures,
            queue_depth=queue_depth,
            embedding_backlog=embedding_backlog,
            embedding_daily_tokens=embedding_daily_tokens,
            embedding_daily_cost=embedding_daily_cost,
        )

        return get_admin_status_response_200
