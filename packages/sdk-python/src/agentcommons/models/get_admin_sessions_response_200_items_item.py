from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_admin_sessions_response_200_items_item_harness import (
    GetAdminSessionsResponse200ItemsItemHarness,
    check_get_admin_sessions_response_200_items_item_harness,
)
from ..models.get_admin_sessions_response_200_items_item_parent_relation_type_0 import (
    GetAdminSessionsResponse200ItemsItemParentRelationType0,
    check_get_admin_sessions_response_200_items_item_parent_relation_type_0,
)
from ..models.get_admin_sessions_response_200_items_item_projection_state import (
    GetAdminSessionsResponse200ItemsItemProjectionState,
    check_get_admin_sessions_response_200_items_item_projection_state,
)
from ..models.get_admin_sessions_response_200_items_item_status import (
    GetAdminSessionsResponse200ItemsItemStatus,
    check_get_admin_sessions_response_200_items_item_status,
)
from ..models.get_admin_sessions_response_200_items_item_visibility import (
    GetAdminSessionsResponse200ItemsItemVisibility,
    check_get_admin_sessions_response_200_items_item_visibility,
)

T = TypeVar("T", bound="GetAdminSessionsResponse200ItemsItem")


@_attrs_define
class GetAdminSessionsResponse200ItemsItem:
    """
    Attributes:
        session_id (UUID): Primary key; every other view joins on it
        harness (GetAdminSessionsResponse200ItemsItemHarness): Agent product: CLAUDE_CODE, CODEX, GEMINI_CLI or PI
        harness_session_id (str): Session id assigned by the harness
        user_email (None | str): Email of the member who ran it
        installation_hostname (None | str): Hostname of the capturing machine
        started_at (datetime.datetime): When the session started (UTC)
        last_activity_at (datetime.datetime): Last captured activity
        ended_at (datetime.datetime | None): When the session ended; NULL while active
        status (GetAdminSessionsResponse200ItemsItemStatus): ACTIVE, ENDED or INACTIVE
        visibility (GetAdminSessionsResponse200ItemsItemVisibility): PUBLIC or PRIVATE
        purged_at (datetime.datetime | None): When content was purged; NULL otherwise
        published (bool): True when a read-model revision is published, so the session appears in sessions, search and
            sql
        projection_state (GetAdminSessionsResponse200ItemsItemProjectionState): Where the read model stands: queued,
            waiting_source (the native transcript has not arrived), published or failed
        parent_session_id (None | UUID): Parent session of a subagent, fork or spawned session
        parent_relation (GetAdminSessionsResponse200ItemsItemParentRelationType0 | None): SUBAGENT, FORK or SPAWNED
        title (None | str): Published title; null for a purged or not yet published session
        repo_name (None | str): Published repository; null for a purged or not yet published session
        message_count (int | None): Published message count; null for a not yet published session
    """

    session_id: UUID
    harness: GetAdminSessionsResponse200ItemsItemHarness
    harness_session_id: str
    user_email: None | str
    installation_hostname: None | str
    started_at: datetime.datetime
    last_activity_at: datetime.datetime
    ended_at: datetime.datetime | None
    status: GetAdminSessionsResponse200ItemsItemStatus
    visibility: GetAdminSessionsResponse200ItemsItemVisibility
    purged_at: datetime.datetime | None
    published: bool
    projection_state: GetAdminSessionsResponse200ItemsItemProjectionState
    parent_session_id: None | UUID
    parent_relation: GetAdminSessionsResponse200ItemsItemParentRelationType0 | None
    title: None | str
    repo_name: None | str
    message_count: int | None

    def to_dict(self) -> dict[str, Any]:
        session_id = str(self.session_id)

        harness: str = self.harness

        harness_session_id = self.harness_session_id

        user_email: None | str
        user_email = self.user_email

        installation_hostname: None | str
        installation_hostname = self.installation_hostname

        started_at = self.started_at.isoformat()

        last_activity_at = self.last_activity_at.isoformat()

        ended_at: None | str
        if isinstance(self.ended_at, datetime.datetime):
            ended_at = self.ended_at.isoformat()
        else:
            ended_at = self.ended_at

        status: str = self.status

        visibility: str = self.visibility

        purged_at: None | str
        if isinstance(self.purged_at, datetime.datetime):
            purged_at = self.purged_at.isoformat()
        else:
            purged_at = self.purged_at

        published = self.published

        projection_state: str = self.projection_state

        parent_session_id: None | str
        if isinstance(self.parent_session_id, UUID):
            parent_session_id = str(self.parent_session_id)
        else:
            parent_session_id = self.parent_session_id

        parent_relation: None | str
        if isinstance(self.parent_relation, str):
            parent_relation = self.parent_relation
        else:
            parent_relation = self.parent_relation

        title: None | str
        title = self.title

        repo_name: None | str
        repo_name = self.repo_name

        message_count: int | None
        message_count = self.message_count

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "session_id": session_id,
                "harness": harness,
                "harness_session_id": harness_session_id,
                "user_email": user_email,
                "installation_hostname": installation_hostname,
                "started_at": started_at,
                "last_activity_at": last_activity_at,
                "ended_at": ended_at,
                "status": status,
                "visibility": visibility,
                "purged_at": purged_at,
                "published": published,
                "projection_state": projection_state,
                "parent_session_id": parent_session_id,
                "parent_relation": parent_relation,
                "title": title,
                "repo_name": repo_name,
                "message_count": message_count,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        session_id = UUID(d.pop("session_id"))

        harness = check_get_admin_sessions_response_200_items_item_harness(
            d.pop("harness")
        )

        harness_session_id = d.pop("harness_session_id")

        def _parse_user_email(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        user_email = _parse_user_email(d.pop("user_email"))

        def _parse_installation_hostname(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        installation_hostname = _parse_installation_hostname(
            d.pop("installation_hostname")
        )

        started_at = datetime.datetime.fromisoformat(d.pop("started_at"))

        last_activity_at = datetime.datetime.fromisoformat(d.pop("last_activity_at"))

        def _parse_ended_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                ended_at_type_0 = datetime.datetime.fromisoformat(data)

                return ended_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        ended_at = _parse_ended_at(d.pop("ended_at"))

        status = check_get_admin_sessions_response_200_items_item_status(
            d.pop("status")
        )

        visibility = check_get_admin_sessions_response_200_items_item_visibility(
            d.pop("visibility")
        )

        def _parse_purged_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                purged_at_type_0 = datetime.datetime.fromisoformat(data)

                return purged_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        purged_at = _parse_purged_at(d.pop("purged_at"))

        published = d.pop("published")

        projection_state = (
            check_get_admin_sessions_response_200_items_item_projection_state(
                d.pop("projection_state")
            )
        )

        def _parse_parent_session_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                parent_session_id_type_0 = UUID(data)

                return parent_session_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        parent_session_id = _parse_parent_session_id(d.pop("parent_session_id"))

        def _parse_parent_relation(
            data: object,
        ) -> GetAdminSessionsResponse200ItemsItemParentRelationType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                parent_relation_type_0 = check_get_admin_sessions_response_200_items_item_parent_relation_type_0(
                    data
                )

                return parent_relation_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                GetAdminSessionsResponse200ItemsItemParentRelationType0 | None, data
            )

        parent_relation = _parse_parent_relation(d.pop("parent_relation"))

        def _parse_title(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        title = _parse_title(d.pop("title"))

        def _parse_repo_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        repo_name = _parse_repo_name(d.pop("repo_name"))

        def _parse_message_count(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        message_count = _parse_message_count(d.pop("message_count"))

        get_admin_sessions_response_200_items_item = cls(
            session_id=session_id,
            harness=harness,
            harness_session_id=harness_session_id,
            user_email=user_email,
            installation_hostname=installation_hostname,
            started_at=started_at,
            last_activity_at=last_activity_at,
            ended_at=ended_at,
            status=status,
            visibility=visibility,
            purged_at=purged_at,
            published=published,
            projection_state=projection_state,
            parent_session_id=parent_session_id,
            parent_relation=parent_relation,
            title=title,
            repo_name=repo_name,
            message_count=message_count,
        )

        return get_admin_sessions_response_200_items_item
