from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_admin_sessions_filters_harness import (
    GetAdminSessionsFiltersHarness,
    check_get_admin_sessions_filters_harness,
)
from ..models.get_admin_sessions_filters_status import (
    GetAdminSessionsFiltersStatus,
    check_get_admin_sessions_filters_status,
)
from ..models.get_admin_sessions_filters_visibility import (
    GetAdminSessionsFiltersVisibility,
    check_get_admin_sessions_filters_visibility,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetAdminSessionsFilters")


@_attrs_define
class GetAdminSessionsFilters:
    """
    Attributes:
        user_email (str | Unset): Sessions run by this member (exact email)
        harness (GetAdminSessionsFiltersHarness | Unset): Sessions of this coding agent
        status (GetAdminSessionsFiltersStatus | Unset): ACTIVE, ENDED or INACTIVE
        visibility (GetAdminSessionsFiltersVisibility | Unset): PUBLIC or PRIVATE
        purged (bool | Unset): True: purged sessions only; false: sessions with content
        published (bool | Unset): True: sessions with a published read model; false: sessions still queued, waiting for
            their transcript or failed
        session_id (UUID | Unset): One session by id
        since (datetime.datetime | Unset): Sessions started at or after this UTC time (inclusive)
        until (datetime.datetime | Unset): Sessions started before this UTC time (exclusive)
    """

    user_email: str | Unset = UNSET
    harness: GetAdminSessionsFiltersHarness | Unset = UNSET
    status: GetAdminSessionsFiltersStatus | Unset = UNSET
    visibility: GetAdminSessionsFiltersVisibility | Unset = UNSET
    purged: bool | Unset = UNSET
    published: bool | Unset = UNSET
    session_id: UUID | Unset = UNSET
    since: datetime.datetime | Unset = UNSET
    until: datetime.datetime | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        user_email = self.user_email

        harness: str | Unset = UNSET
        if not isinstance(self.harness, Unset):
            harness = self.harness

        status: str | Unset = UNSET
        if not isinstance(self.status, Unset):
            status = self.status

        visibility: str | Unset = UNSET
        if not isinstance(self.visibility, Unset):
            visibility = self.visibility

        purged = self.purged

        published = self.published

        session_id: str | Unset = UNSET
        if not isinstance(self.session_id, Unset):
            session_id = str(self.session_id)

        since: str | Unset = UNSET
        if not isinstance(self.since, Unset):
            since = self.since.isoformat()

        until: str | Unset = UNSET
        if not isinstance(self.until, Unset):
            until = self.until.isoformat()

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if user_email is not UNSET:
            field_dict["user_email"] = user_email
        if harness is not UNSET:
            field_dict["harness"] = harness
        if status is not UNSET:
            field_dict["status"] = status
        if visibility is not UNSET:
            field_dict["visibility"] = visibility
        if purged is not UNSET:
            field_dict["purged"] = purged
        if published is not UNSET:
            field_dict["published"] = published
        if session_id is not UNSET:
            field_dict["session_id"] = session_id
        if since is not UNSET:
            field_dict["since"] = since
        if until is not UNSET:
            field_dict["until"] = until

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        user_email = d.pop("user_email", UNSET)

        _harness = d.pop("harness", UNSET)
        harness: GetAdminSessionsFiltersHarness | Unset
        if isinstance(_harness, Unset):
            harness = UNSET
        else:
            harness = check_get_admin_sessions_filters_harness(_harness)

        _status = d.pop("status", UNSET)
        status: GetAdminSessionsFiltersStatus | Unset
        if isinstance(_status, Unset):
            status = UNSET
        else:
            status = check_get_admin_sessions_filters_status(_status)

        _visibility = d.pop("visibility", UNSET)
        visibility: GetAdminSessionsFiltersVisibility | Unset
        if isinstance(_visibility, Unset):
            visibility = UNSET
        else:
            visibility = check_get_admin_sessions_filters_visibility(_visibility)

        purged = d.pop("purged", UNSET)

        published = d.pop("published", UNSET)

        _session_id = d.pop("session_id", UNSET)
        session_id: UUID | Unset
        if isinstance(_session_id, Unset):
            session_id = UNSET
        else:
            session_id = UUID(_session_id)

        _since = d.pop("since", UNSET)
        since: datetime.datetime | Unset
        if isinstance(_since, Unset):
            since = UNSET
        else:
            since = datetime.datetime.fromisoformat(_since)

        _until = d.pop("until", UNSET)
        until: datetime.datetime | Unset
        if isinstance(_until, Unset):
            until = UNSET
        else:
            until = datetime.datetime.fromisoformat(_until)

        get_admin_sessions_filters = cls(
            user_email=user_email,
            harness=harness,
            status=status,
            visibility=visibility,
            purged=purged,
            published=published,
            session_id=session_id,
            since=since,
            until=until,
        )

        return get_admin_sessions_filters
