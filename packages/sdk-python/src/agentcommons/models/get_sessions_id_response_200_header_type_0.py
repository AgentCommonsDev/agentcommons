from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_sessions_id_response_200_header_type_0_harness import (
    GetSessionsIdResponse200HeaderType0Harness,
    check_get_sessions_id_response_200_header_type_0_harness,
)
from ..models.get_sessions_id_response_200_header_type_0_parent_relation_type_0 import (
    GetSessionsIdResponse200HeaderType0ParentRelationType0,
    check_get_sessions_id_response_200_header_type_0_parent_relation_type_0,
)
from ..models.get_sessions_id_response_200_header_type_0_status import (
    GetSessionsIdResponse200HeaderType0Status,
    check_get_sessions_id_response_200_header_type_0_status,
)
from ..models.get_sessions_id_response_200_header_type_0_visibility import (
    GetSessionsIdResponse200HeaderType0Visibility,
    check_get_sessions_id_response_200_header_type_0_visibility,
)

if TYPE_CHECKING:
    from ..models.get_sessions_id_response_200_header_type_0_children_item import (
        GetSessionsIdResponse200HeaderType0ChildrenItem,
    )
    from ..models.get_sessions_id_response_200_header_type_0_parent_type_0 import (
        GetSessionsIdResponse200HeaderType0ParentType0,
    )


T = TypeVar("T", bound="GetSessionsIdResponse200HeaderType0")


@_attrs_define
class GetSessionsIdResponse200HeaderType0:
    """
    Attributes:
        session_id (UUID): Primary key; every other view joins on it
        organization_id (str): Owning organization (already scoped)
        title (None | str): Short title derived from the session
        harness (GetSessionsIdResponse200HeaderType0Harness): Agent product: CLAUDE_CODE, CODEX, GEMINI_CLI or PI
        harness_version (None | str): Harness version, if reported
        entrypoint (None | str): How the harness was launched, if reported
        model (None | str): Primary model used
        models_used (list[str]): Every model seen in the session
        user_email (str): Email of the member who ran it
        by_teammate (bool): true when this session's author is another member of your organization Default: False.
        installation_hostname (str): Hostname of the capturing machine
        installation_id (UUID): Machine install that captured it; joins installations.installation_id
        repo_name (None | str): Repository name such as owner/repo; joins repos.repo_name
        repo_url (None | str): Remote URL of the repository
        branch (None | str): Git branch last observed in the session
        observed_branches (list[str]): Every distinct branch the session worked on, including switches; see
            session_observed_branches
        cwd_relative (None | str): cwd relative to repo_root
        start_commit (None | str): HEAD SHA at session start
        end_commit (None | str): HEAD SHA at session end
        started_at (datetime.datetime): When the session started (UTC)
        ended_at (datetime.datetime | None): When the session ended; NULL while active
        status (GetSessionsIdResponse200HeaderType0Status): ACTIVE, ENDED or INACTIVE
        visibility (GetSessionsIdResponse200HeaderType0Visibility): PUBLIC or PRIVATE
        purged_at (datetime.datetime | None): When content was purged; NULL otherwise
        end_reason (None | str): Why the session ended, as the harness reported it
        message_count (int): Rows in messages for this session
        tool_call_count (int): Tool calls made
        input_tokens (None | str): Input tokens consumed
        output_tokens (None | str): Output tokens produced
        tools_used (list[str]): Distinct tool names called; see session_tools
        file_count (int): Files read, edited, written or deleted; see session_files
        observed_commit_count (int): Commits observed during the session
        observed_branch_count (int): Distinct branches the session worked on
        reuse_count (int): Later sessions that read this one; see session_reuse
        agentcommons_search_calls (int): search and sql calls credited to the session while active
        reuses_made (int): Distinct earlier sessions this one read through get; see reuse_edges
        agent_type (None | str): Subagent type when the session is a subagent
        parent_session_id (None | UUID): Parent session of a subagent, fork or spawned session
        parent_relation (GetSessionsIdResponse200HeaderType0ParentRelationType0 | None): SUBAGENT, FORK or SPAWNED
        parent_tool_use_id (None | str): Parent tool_use_id of the call that spawned this child; NULL when unrecorded
        parent (GetSessionsIdResponse200HeaderType0ParentType0 | None): Parent session when visible; null for a root
            session
        children (list[GetSessionsIdResponse200HeaderType0ChildrenItem]): Up to 10 direct child sessions: subagents,
            forks and spawned runs
        child_count (int): Direct child sessions
        children_truncated (bool): True when more children exist than are listed
        truncated_fields (list[str]): Fields shortened to fit the response
        root_session_id (UUID): Top of this session's parent chain; equals session_id for a root session
    """

    session_id: UUID
    organization_id: str
    title: None | str
    harness: GetSessionsIdResponse200HeaderType0Harness
    harness_version: None | str
    entrypoint: None | str
    model: None | str
    models_used: list[str]
    user_email: str
    installation_hostname: str
    installation_id: UUID
    repo_name: None | str
    repo_url: None | str
    branch: None | str
    observed_branches: list[str]
    cwd_relative: None | str
    start_commit: None | str
    end_commit: None | str
    started_at: datetime.datetime
    ended_at: datetime.datetime | None
    status: GetSessionsIdResponse200HeaderType0Status
    visibility: GetSessionsIdResponse200HeaderType0Visibility
    purged_at: datetime.datetime | None
    end_reason: None | str
    message_count: int
    tool_call_count: int
    input_tokens: None | str
    output_tokens: None | str
    tools_used: list[str]
    file_count: int
    observed_commit_count: int
    observed_branch_count: int
    reuse_count: int
    agentcommons_search_calls: int
    reuses_made: int
    agent_type: None | str
    parent_session_id: None | UUID
    parent_relation: GetSessionsIdResponse200HeaderType0ParentRelationType0 | None
    parent_tool_use_id: None | str
    parent: GetSessionsIdResponse200HeaderType0ParentType0 | None
    children: list[GetSessionsIdResponse200HeaderType0ChildrenItem]
    child_count: int
    children_truncated: bool
    truncated_fields: list[str]
    root_session_id: UUID
    by_teammate: bool = False

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_sessions_id_response_200_header_type_0_parent_type_0 import (
            GetSessionsIdResponse200HeaderType0ParentType0,  # noqa: PLC0415
        )

        session_id = str(self.session_id)

        organization_id = self.organization_id

        title: None | str
        title = self.title

        harness: str = self.harness

        harness_version: None | str
        harness_version = self.harness_version

        entrypoint: None | str
        entrypoint = self.entrypoint

        model: None | str
        model = self.model

        models_used = self.models_used

        user_email = self.user_email

        by_teammate = self.by_teammate

        installation_hostname = self.installation_hostname

        installation_id = str(self.installation_id)

        repo_name: None | str
        repo_name = self.repo_name

        repo_url: None | str
        repo_url = self.repo_url

        branch: None | str
        branch = self.branch

        observed_branches = self.observed_branches

        cwd_relative: None | str
        cwd_relative = self.cwd_relative

        start_commit: None | str
        start_commit = self.start_commit

        end_commit: None | str
        end_commit = self.end_commit

        started_at = self.started_at.isoformat()

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

        end_reason: None | str
        end_reason = self.end_reason

        message_count = self.message_count

        tool_call_count = self.tool_call_count

        input_tokens: None | str
        input_tokens = self.input_tokens

        output_tokens: None | str
        output_tokens = self.output_tokens

        tools_used = self.tools_used

        file_count = self.file_count

        observed_commit_count = self.observed_commit_count

        observed_branch_count = self.observed_branch_count

        reuse_count = self.reuse_count

        agentcommons_search_calls = self.agentcommons_search_calls

        reuses_made = self.reuses_made

        agent_type: None | str
        agent_type = self.agent_type

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

        parent_tool_use_id: None | str
        parent_tool_use_id = self.parent_tool_use_id

        parent: dict[str, Any] | None
        if isinstance(self.parent, GetSessionsIdResponse200HeaderType0ParentType0):
            parent = self.parent.to_dict()
        else:
            parent = self.parent

        children = []
        for children_item_data in self.children:
            children_item = children_item_data.to_dict()
            children.append(children_item)

        child_count = self.child_count

        children_truncated = self.children_truncated

        truncated_fields = self.truncated_fields

        root_session_id = str(self.root_session_id)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "session_id": session_id,
                "organization_id": organization_id,
                "title": title,
                "harness": harness,
                "harness_version": harness_version,
                "entrypoint": entrypoint,
                "model": model,
                "models_used": models_used,
                "user_email": user_email,
                "by_teammate": by_teammate,
                "installation_hostname": installation_hostname,
                "installation_id": installation_id,
                "repo_name": repo_name,
                "repo_url": repo_url,
                "branch": branch,
                "observed_branches": observed_branches,
                "cwd_relative": cwd_relative,
                "start_commit": start_commit,
                "end_commit": end_commit,
                "started_at": started_at,
                "ended_at": ended_at,
                "status": status,
                "visibility": visibility,
                "purged_at": purged_at,
                "end_reason": end_reason,
                "message_count": message_count,
                "tool_call_count": tool_call_count,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "tools_used": tools_used,
                "file_count": file_count,
                "observed_commit_count": observed_commit_count,
                "observed_branch_count": observed_branch_count,
                "reuse_count": reuse_count,
                "agentcommons_search_calls": agentcommons_search_calls,
                "reuses_made": reuses_made,
                "agent_type": agent_type,
                "parent_session_id": parent_session_id,
                "parent_relation": parent_relation,
                "parent_tool_use_id": parent_tool_use_id,
                "parent": parent,
                "children": children,
                "child_count": child_count,
                "children_truncated": children_truncated,
                "truncated_fields": truncated_fields,
                "root_session_id": root_session_id,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_sessions_id_response_200_header_type_0_children_item import (
            GetSessionsIdResponse200HeaderType0ChildrenItem,  # noqa: PLC0415
        )
        from ..models.get_sessions_id_response_200_header_type_0_parent_type_0 import (
            GetSessionsIdResponse200HeaderType0ParentType0,  # noqa: PLC0415
        )

        d = dict(src_dict)
        session_id = UUID(d.pop("session_id"))

        organization_id = d.pop("organization_id")

        def _parse_title(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        title = _parse_title(d.pop("title"))

        harness = check_get_sessions_id_response_200_header_type_0_harness(
            d.pop("harness")
        )

        def _parse_harness_version(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        harness_version = _parse_harness_version(d.pop("harness_version"))

        def _parse_entrypoint(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        entrypoint = _parse_entrypoint(d.pop("entrypoint"))

        def _parse_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model = _parse_model(d.pop("model"))

        models_used = cast(list[str], d.pop("models_used"))

        user_email = d.pop("user_email")

        by_teammate = d.pop("by_teammate")

        installation_hostname = d.pop("installation_hostname")

        installation_id = UUID(d.pop("installation_id"))

        def _parse_repo_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        repo_name = _parse_repo_name(d.pop("repo_name"))

        def _parse_repo_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        repo_url = _parse_repo_url(d.pop("repo_url"))

        def _parse_branch(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        branch = _parse_branch(d.pop("branch"))

        observed_branches = cast(list[str], d.pop("observed_branches"))

        def _parse_cwd_relative(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        cwd_relative = _parse_cwd_relative(d.pop("cwd_relative"))

        def _parse_start_commit(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        start_commit = _parse_start_commit(d.pop("start_commit"))

        def _parse_end_commit(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        end_commit = _parse_end_commit(d.pop("end_commit"))

        started_at = datetime.datetime.fromisoformat(d.pop("started_at"))

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

        status = check_get_sessions_id_response_200_header_type_0_status(
            d.pop("status")
        )

        visibility = check_get_sessions_id_response_200_header_type_0_visibility(
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

        def _parse_end_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        end_reason = _parse_end_reason(d.pop("end_reason"))

        message_count = d.pop("message_count")

        tool_call_count = d.pop("tool_call_count")

        def _parse_input_tokens(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        input_tokens = _parse_input_tokens(d.pop("input_tokens"))

        def _parse_output_tokens(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        output_tokens = _parse_output_tokens(d.pop("output_tokens"))

        tools_used = cast(list[str], d.pop("tools_used"))

        file_count = d.pop("file_count")

        observed_commit_count = d.pop("observed_commit_count")

        observed_branch_count = d.pop("observed_branch_count")

        reuse_count = d.pop("reuse_count")

        agentcommons_search_calls = d.pop("agentcommons_search_calls")

        reuses_made = d.pop("reuses_made")

        def _parse_agent_type(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        agent_type = _parse_agent_type(d.pop("agent_type"))

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
        ) -> GetSessionsIdResponse200HeaderType0ParentRelationType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                parent_relation_type_0 = check_get_sessions_id_response_200_header_type_0_parent_relation_type_0(
                    data
                )

                return parent_relation_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(
                GetSessionsIdResponse200HeaderType0ParentRelationType0 | None, data
            )

        parent_relation = _parse_parent_relation(d.pop("parent_relation"))

        def _parse_parent_tool_use_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        parent_tool_use_id = _parse_parent_tool_use_id(d.pop("parent_tool_use_id"))

        def _parse_parent(
            data: object,
        ) -> GetSessionsIdResponse200HeaderType0ParentType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                parent_type_0 = (
                    GetSessionsIdResponse200HeaderType0ParentType0.from_dict(data)
                )

                return parent_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetSessionsIdResponse200HeaderType0ParentType0 | None, data)

        parent = _parse_parent(d.pop("parent"))

        children = []
        _children = d.pop("children")
        for children_item_data in _children:
            children_item = GetSessionsIdResponse200HeaderType0ChildrenItem.from_dict(
                children_item_data
            )

            children.append(children_item)

        child_count = d.pop("child_count")

        children_truncated = d.pop("children_truncated")

        truncated_fields = cast(list[str], d.pop("truncated_fields"))

        root_session_id = UUID(d.pop("root_session_id"))

        get_sessions_id_response_200_header_type_0 = cls(
            session_id=session_id,
            organization_id=organization_id,
            title=title,
            harness=harness,
            harness_version=harness_version,
            entrypoint=entrypoint,
            model=model,
            models_used=models_used,
            user_email=user_email,
            by_teammate=by_teammate,
            installation_hostname=installation_hostname,
            installation_id=installation_id,
            repo_name=repo_name,
            repo_url=repo_url,
            branch=branch,
            observed_branches=observed_branches,
            cwd_relative=cwd_relative,
            start_commit=start_commit,
            end_commit=end_commit,
            started_at=started_at,
            ended_at=ended_at,
            status=status,
            visibility=visibility,
            purged_at=purged_at,
            end_reason=end_reason,
            message_count=message_count,
            tool_call_count=tool_call_count,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            tools_used=tools_used,
            file_count=file_count,
            observed_commit_count=observed_commit_count,
            observed_branch_count=observed_branch_count,
            reuse_count=reuse_count,
            agentcommons_search_calls=agentcommons_search_calls,
            reuses_made=reuses_made,
            agent_type=agent_type,
            parent_session_id=parent_session_id,
            parent_relation=parent_relation,
            parent_tool_use_id=parent_tool_use_id,
            parent=parent,
            children=children,
            child_count=child_count,
            children_truncated=children_truncated,
            truncated_fields=truncated_fields,
            root_session_id=root_session_id,
        )

        return get_sessions_id_response_200_header_type_0
