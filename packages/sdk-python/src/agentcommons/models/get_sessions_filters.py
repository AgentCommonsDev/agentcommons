from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_sessions_filters_file_operation_type_0 import (
    GetSessionsFiltersFileOperationType0,
    check_get_sessions_filters_file_operation_type_0,
)
from ..models.get_sessions_filters_file_operation_type_1_item import (
    GetSessionsFiltersFileOperationType1Item,
    check_get_sessions_filters_file_operation_type_1_item,
)
from ..models.get_sessions_filters_role_type_0 import (
    GetSessionsFiltersRoleType0,
    check_get_sessions_filters_role_type_0,
)
from ..models.get_sessions_filters_role_type_1_item import (
    GetSessionsFiltersRoleType1Item,
    check_get_sessions_filters_role_type_1_item,
)
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.get_sessions_filters_where_item_type_0 import (
        GetSessionsFiltersWhereItemType0,
    )
    from ..models.get_sessions_filters_where_item_type_1 import (
        GetSessionsFiltersWhereItemType1,
    )
    from ..models.get_sessions_filters_where_item_type_2 import (
        GetSessionsFiltersWhereItemType2,
    )
    from ..models.get_sessions_filters_where_item_type_3 import (
        GetSessionsFiltersWhereItemType3,
    )


T = TypeVar("T", bound="GetSessionsFilters")


@_attrs_define
class GetSessionsFilters:
    """
    Attributes:
        repo_name (list[str] | str | Unset): Sessions in these repositories: host/org/repo, or org/repo or the bare
            repository name when only one repository matches
        branch (list[str] | str | Unset): Sessions on these git branches (exact)
        user_email (list[str] | str | Unset): Sessions run by these members (exact email)
        ingest_api_key_id (list[str] | str | Unset): Sessions uploaded with these ingest API keys (key id, exact); the
            Install page uses it to show one machine's sessions
        tool_name (list[str] | str | Unset): Messages calling or answering these tools, such as Read or Bash
        file_prefix (list[str] | str | Unset): Sessions that touched a file whose path starts with this text, such as
            src/auth/
        file_operation (GetSessionsFiltersFileOperationType0 | list[GetSessionsFiltersFileOperationType1Item] | Unset):
            Sessions where a file was read, edited, written or deleted; with file_prefix, the same file must match both
        role (GetSessionsFiltersRoleType0 | list[GetSessionsFiltersRoleType1Item] | Unset): Messages with these roles
        session_id (list[UUID] | Unset | UUID): Search inside these sessions only
        since (datetime.datetime | list[datetime.datetime] | Unset): Messages at or after this UTC time (inclusive)
        until (datetime.datetime | list[datetime.datetime] | Unset): Messages before this UTC time (exclusive)
        where (list[GetSessionsFiltersWhereItemType0 | GetSessionsFiltersWhereItemType1 |
            GetSessionsFiltersWhereItemType2 | GetSessionsFiltersWhereItemType3] | Unset): Up to 10 extra conditions that
            must all hold, on a message field (tool_name, tool_use_id, content, role, kind, model, or a JSON path inside
            tool_input) or a session field (harness, title, repo_name, branch, user_email, status)
    """

    repo_name: list[str] | str | Unset = UNSET
    branch: list[str] | str | Unset = UNSET
    user_email: list[str] | str | Unset = UNSET
    ingest_api_key_id: list[str] | str | Unset = UNSET
    tool_name: list[str] | str | Unset = UNSET
    file_prefix: list[str] | str | Unset = UNSET
    file_operation: (
        GetSessionsFiltersFileOperationType0
        | list[GetSessionsFiltersFileOperationType1Item]
        | Unset
    ) = UNSET
    role: (
        GetSessionsFiltersRoleType0 | list[GetSessionsFiltersRoleType1Item] | Unset
    ) = UNSET
    session_id: list[UUID] | Unset | UUID = UNSET
    since: datetime.datetime | list[datetime.datetime] | Unset = UNSET
    until: datetime.datetime | list[datetime.datetime] | Unset = UNSET
    where: (
        list[
            GetSessionsFiltersWhereItemType0
            | GetSessionsFiltersWhereItemType1
            | GetSessionsFiltersWhereItemType2
            | GetSessionsFiltersWhereItemType3
        ]
        | Unset
    ) = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_sessions_filters_where_item_type_0 import (
            GetSessionsFiltersWhereItemType0,  # noqa: PLC0415
        )
        from ..models.get_sessions_filters_where_item_type_1 import (
            GetSessionsFiltersWhereItemType1,  # noqa: PLC0415
        )
        from ..models.get_sessions_filters_where_item_type_2 import (
            GetSessionsFiltersWhereItemType2,  # noqa: PLC0415
        )

        repo_name: list[str] | str | Unset
        if isinstance(self.repo_name, Unset):
            repo_name = UNSET
        elif isinstance(self.repo_name, list):
            repo_name = self.repo_name

        else:
            repo_name = self.repo_name

        branch: list[str] | str | Unset
        if isinstance(self.branch, Unset):
            branch = UNSET
        elif isinstance(self.branch, list):
            branch = self.branch

        else:
            branch = self.branch

        user_email: list[str] | str | Unset
        if isinstance(self.user_email, Unset):
            user_email = UNSET
        elif isinstance(self.user_email, list):
            user_email = self.user_email

        else:
            user_email = self.user_email

        ingest_api_key_id: list[str] | str | Unset
        if isinstance(self.ingest_api_key_id, Unset):
            ingest_api_key_id = UNSET
        elif isinstance(self.ingest_api_key_id, list):
            ingest_api_key_id = self.ingest_api_key_id

        else:
            ingest_api_key_id = self.ingest_api_key_id

        tool_name: list[str] | str | Unset
        if isinstance(self.tool_name, Unset):
            tool_name = UNSET
        elif isinstance(self.tool_name, list):
            tool_name = self.tool_name

        else:
            tool_name = self.tool_name

        file_prefix: list[str] | str | Unset
        if isinstance(self.file_prefix, Unset):
            file_prefix = UNSET
        elif isinstance(self.file_prefix, list):
            file_prefix = self.file_prefix

        else:
            file_prefix = self.file_prefix

        file_operation: list[str] | str | Unset
        if isinstance(self.file_operation, Unset):
            file_operation = UNSET
        elif isinstance(self.file_operation, str):
            file_operation = self.file_operation
        else:
            file_operation = []
            for file_operation_type_1_item_data in self.file_operation:
                file_operation_type_1_item: str = file_operation_type_1_item_data
                file_operation.append(file_operation_type_1_item)

        role: list[str] | str | Unset
        if isinstance(self.role, Unset):
            role = UNSET
        elif isinstance(self.role, str):
            role = self.role
        else:
            role = []
            for role_type_1_item_data in self.role:
                role_type_1_item: str = role_type_1_item_data
                role.append(role_type_1_item)

        session_id: list[str] | str | Unset
        if isinstance(self.session_id, Unset):
            session_id = UNSET
        elif isinstance(self.session_id, UUID):
            session_id = str(self.session_id)
        else:
            session_id = []
            for session_id_type_1_item_data in self.session_id:
                session_id_type_1_item = str(session_id_type_1_item_data)
                session_id.append(session_id_type_1_item)

        since: list[str] | str | Unset
        if isinstance(self.since, Unset):
            since = UNSET
        elif isinstance(self.since, datetime.datetime):
            since = self.since.isoformat()
        else:
            since = []
            for since_type_1_item_data in self.since:
                since_type_1_item = since_type_1_item_data.isoformat()
                since.append(since_type_1_item)

        until: list[str] | str | Unset
        if isinstance(self.until, Unset):
            until = UNSET
        elif isinstance(self.until, datetime.datetime):
            until = self.until.isoformat()
        else:
            until = []
            for until_type_1_item_data in self.until:
                until_type_1_item = until_type_1_item_data.isoformat()
                until.append(until_type_1_item)

        where: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.where, Unset):
            where = []
            for where_item_data in self.where:
                where_item: dict[str, Any]
                if isinstance(where_item_data, GetSessionsFiltersWhereItemType0):
                    where_item = where_item_data.to_dict()
                elif isinstance(where_item_data, GetSessionsFiltersWhereItemType1):
                    where_item = where_item_data.to_dict()
                elif isinstance(where_item_data, GetSessionsFiltersWhereItemType2):
                    where_item = where_item_data.to_dict()
                else:
                    where_item = where_item_data.to_dict()

                where.append(where_item)

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if repo_name is not UNSET:
            field_dict["repo_name"] = repo_name
        if branch is not UNSET:
            field_dict["branch"] = branch
        if user_email is not UNSET:
            field_dict["user_email"] = user_email
        if ingest_api_key_id is not UNSET:
            field_dict["ingest_api_key_id"] = ingest_api_key_id
        if tool_name is not UNSET:
            field_dict["tool_name"] = tool_name
        if file_prefix is not UNSET:
            field_dict["file_prefix"] = file_prefix
        if file_operation is not UNSET:
            field_dict["file_operation"] = file_operation
        if role is not UNSET:
            field_dict["role"] = role
        if session_id is not UNSET:
            field_dict["session_id"] = session_id
        if since is not UNSET:
            field_dict["since"] = since
        if until is not UNSET:
            field_dict["until"] = until
        if where is not UNSET:
            field_dict["where"] = where

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_sessions_filters_where_item_type_0 import (
            GetSessionsFiltersWhereItemType0,  # noqa: PLC0415
        )
        from ..models.get_sessions_filters_where_item_type_1 import (
            GetSessionsFiltersWhereItemType1,  # noqa: PLC0415
        )
        from ..models.get_sessions_filters_where_item_type_2 import (
            GetSessionsFiltersWhereItemType2,  # noqa: PLC0415
        )
        from ..models.get_sessions_filters_where_item_type_3 import (
            GetSessionsFiltersWhereItemType3,  # noqa: PLC0415
        )

        d = dict(src_dict)

        def _parse_repo_name(data: object) -> list[str] | str | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                repo_name_type_1 = cast(list[str], data)

                return repo_name_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | str | Unset, data)

        repo_name = _parse_repo_name(d.pop("repo_name", UNSET))

        def _parse_branch(data: object) -> list[str] | str | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                branch_type_1 = cast(list[str], data)

                return branch_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | str | Unset, data)

        branch = _parse_branch(d.pop("branch", UNSET))

        def _parse_user_email(data: object) -> list[str] | str | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                user_email_type_1 = cast(list[str], data)

                return user_email_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | str | Unset, data)

        user_email = _parse_user_email(d.pop("user_email", UNSET))

        def _parse_ingest_api_key_id(data: object) -> list[str] | str | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                ingest_api_key_id_type_1 = cast(list[str], data)

                return ingest_api_key_id_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | str | Unset, data)

        ingest_api_key_id = _parse_ingest_api_key_id(d.pop("ingest_api_key_id", UNSET))

        def _parse_tool_name(data: object) -> list[str] | str | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                tool_name_type_1 = cast(list[str], data)

                return tool_name_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | str | Unset, data)

        tool_name = _parse_tool_name(d.pop("tool_name", UNSET))

        def _parse_file_prefix(data: object) -> list[str] | str | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, list):
                    raise TypeError()
                file_prefix_type_1 = cast(list[str], data)

                return file_prefix_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(list[str] | str | Unset, data)

        file_prefix = _parse_file_prefix(d.pop("file_prefix", UNSET))

        def _parse_file_operation(
            data: object,
        ) -> (
            GetSessionsFiltersFileOperationType0
            | list[GetSessionsFiltersFileOperationType1Item]
            | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                file_operation_type_0 = (
                    check_get_sessions_filters_file_operation_type_0(data)
                )

                return file_operation_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, list):
                raise TypeError()
            file_operation_type_1 = []
            _file_operation_type_1 = data
            for file_operation_type_1_item_data in _file_operation_type_1:
                file_operation_type_1_item = (
                    check_get_sessions_filters_file_operation_type_1_item(
                        file_operation_type_1_item_data
                    )
                )

                file_operation_type_1.append(file_operation_type_1_item)

            return file_operation_type_1

        file_operation = _parse_file_operation(d.pop("file_operation", UNSET))

        def _parse_role(
            data: object,
        ) -> (
            GetSessionsFiltersRoleType0 | list[GetSessionsFiltersRoleType1Item] | Unset
        ):
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                role_type_0 = check_get_sessions_filters_role_type_0(data)

                return role_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, list):
                raise TypeError()
            role_type_1 = []
            _role_type_1 = data
            for role_type_1_item_data in _role_type_1:
                role_type_1_item = check_get_sessions_filters_role_type_1_item(
                    role_type_1_item_data
                )

                role_type_1.append(role_type_1_item)

            return role_type_1

        role = _parse_role(d.pop("role", UNSET))

        def _parse_session_id(data: object) -> list[UUID] | Unset | UUID:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                session_id_type_0 = UUID(data)

                return session_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, list):
                raise TypeError()
            session_id_type_1 = []
            _session_id_type_1 = data
            for session_id_type_1_item_data in _session_id_type_1:
                session_id_type_1_item = UUID(session_id_type_1_item_data)

                session_id_type_1.append(session_id_type_1_item)

            return session_id_type_1

        session_id = _parse_session_id(d.pop("session_id", UNSET))

        def _parse_since(
            data: object,
        ) -> datetime.datetime | list[datetime.datetime] | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                since_type_0 = datetime.datetime.fromisoformat(data)

                return since_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, list):
                raise TypeError()
            since_type_1 = []
            _since_type_1 = data
            for since_type_1_item_data in _since_type_1:
                since_type_1_item = datetime.datetime.fromisoformat(
                    since_type_1_item_data
                )

                since_type_1.append(since_type_1_item)

            return since_type_1

        since = _parse_since(d.pop("since", UNSET))

        def _parse_until(
            data: object,
        ) -> datetime.datetime | list[datetime.datetime] | Unset:
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                until_type_0 = datetime.datetime.fromisoformat(data)

                return until_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, list):
                raise TypeError()
            until_type_1 = []
            _until_type_1 = data
            for until_type_1_item_data in _until_type_1:
                until_type_1_item = datetime.datetime.fromisoformat(
                    until_type_1_item_data
                )

                until_type_1.append(until_type_1_item)

            return until_type_1

        until = _parse_until(d.pop("until", UNSET))

        _where = d.pop("where", UNSET)
        where: (
            list[
                GetSessionsFiltersWhereItemType0
                | GetSessionsFiltersWhereItemType1
                | GetSessionsFiltersWhereItemType2
                | GetSessionsFiltersWhereItemType3
            ]
            | Unset
        ) = UNSET
        if _where is not UNSET:
            where = []
            for where_item_data in _where:

                def _parse_where_item(
                    data: object,
                ) -> (
                    GetSessionsFiltersWhereItemType0
                    | GetSessionsFiltersWhereItemType1
                    | GetSessionsFiltersWhereItemType2
                    | GetSessionsFiltersWhereItemType3
                ):
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        where_item_type_0 = GetSessionsFiltersWhereItemType0.from_dict(
                            data
                        )

                        return where_item_type_0
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        where_item_type_1 = GetSessionsFiltersWhereItemType1.from_dict(
                            data
                        )

                        return where_item_type_1
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        where_item_type_2 = GetSessionsFiltersWhereItemType2.from_dict(
                            data
                        )

                        return where_item_type_2
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    if not isinstance(data, dict):
                        raise TypeError()
                    where_item_type_3 = GetSessionsFiltersWhereItemType3.from_dict(data)

                    return where_item_type_3

                where_item = _parse_where_item(where_item_data)

                where.append(where_item)

        get_sessions_filters = cls(
            repo_name=repo_name,
            branch=branch,
            user_email=user_email,
            ingest_api_key_id=ingest_api_key_id,
            tool_name=tool_name,
            file_prefix=file_prefix,
            file_operation=file_operation,
            role=role,
            session_id=session_id,
            since=since,
            until=until,
            where=where,
        )

        return get_sessions_filters
