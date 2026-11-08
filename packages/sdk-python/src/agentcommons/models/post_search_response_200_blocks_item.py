from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.post_search_response_200_blocks_item_harness import (
    PostSearchResponse200BlocksItemHarness,
    check_post_search_response_200_blocks_item_harness,
)
from ..models.post_search_response_200_blocks_item_parent_relation_type_0 import (
    PostSearchResponse200BlocksItemParentRelationType0,
    check_post_search_response_200_blocks_item_parent_relation_type_0,
)

if TYPE_CHECKING:
    from ..models.post_search_response_200_blocks_item_messages_item import (
        PostSearchResponse200BlocksItemMessagesItem,
    )


T = TypeVar("T", bound="PostSearchResponse200BlocksItem")


@_attrs_define
class PostSearchResponse200BlocksItem:
    """
    Attributes:
        session_id (UUID): Session the messages belong to; pass to get for the full transcript
        root_session_id (UUID): Root of the session tree. Equals session_id unless the hit sits inside a subagent, fork
            or spawned run; open the root and read the run inline.
        parent_relation (None | PostSearchResponse200BlocksItemParentRelationType0): How this session relates to its
            parent; null for a root session.
        agent_type (None | str): Harness agent type of a subagent run, when the harness reports one.
        parent_tool_use_id (None | str): The parent's tool call that spawned this run, when recorded and the parent is
            visible; null for a root session.
        title (None | str): Short title derived from the session
        harness (PostSearchResponse200BlocksItemHarness): Agent product: CLAUDE_CODE, CODEX, GEMINI_CLI or PI
        model (None | str): Primary model used
        repo_name (None | str): Repository name such as owner/repo; joins repos.repo_name
        branch (None | str): Git branch last observed in the session
        user_email (str): Email of the member who ran it
        by_teammate (bool): true when this session's author is another member of your organization Default: False.
        started_at (datetime.datetime): When the session started (UTC)
        messages (list[PostSearchResponse200BlocksItemMessagesItem]): Matched messages and their context, in seq order
        truncated_fields (list[str]): Fields shortened to fit the response
    """

    session_id: UUID
    root_session_id: UUID
    parent_relation: None | PostSearchResponse200BlocksItemParentRelationType0
    agent_type: None | str
    parent_tool_use_id: None | str
    title: None | str
    harness: PostSearchResponse200BlocksItemHarness
    model: None | str
    repo_name: None | str
    branch: None | str
    user_email: str
    started_at: datetime.datetime
    messages: list[PostSearchResponse200BlocksItemMessagesItem]
    truncated_fields: list[str]
    by_teammate: bool = False

    def to_dict(self) -> dict[str, Any]:
        session_id = str(self.session_id)

        root_session_id = str(self.root_session_id)

        parent_relation: None | str
        if isinstance(self.parent_relation, str):
            parent_relation = self.parent_relation
        else:
            parent_relation = self.parent_relation

        agent_type: None | str
        agent_type = self.agent_type

        parent_tool_use_id: None | str
        parent_tool_use_id = self.parent_tool_use_id

        title: None | str
        title = self.title

        harness: str = self.harness

        model: None | str
        model = self.model

        repo_name: None | str
        repo_name = self.repo_name

        branch: None | str
        branch = self.branch

        user_email = self.user_email

        by_teammate = self.by_teammate

        started_at = self.started_at.isoformat()

        messages = []
        for messages_item_data in self.messages:
            messages_item = messages_item_data.to_dict()
            messages.append(messages_item)

        truncated_fields = self.truncated_fields

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "session_id": session_id,
                "root_session_id": root_session_id,
                "parent_relation": parent_relation,
                "agent_type": agent_type,
                "parent_tool_use_id": parent_tool_use_id,
                "title": title,
                "harness": harness,
                "model": model,
                "repo_name": repo_name,
                "branch": branch,
                "user_email": user_email,
                "by_teammate": by_teammate,
                "started_at": started_at,
                "messages": messages,
                "truncated_fields": truncated_fields,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_search_response_200_blocks_item_messages_item import (
            PostSearchResponse200BlocksItemMessagesItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        session_id = UUID(d.pop("session_id"))

        root_session_id = UUID(d.pop("root_session_id"))

        def _parse_parent_relation(
            data: object,
        ) -> None | PostSearchResponse200BlocksItemParentRelationType0:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                parent_relation_type_0 = (
                    check_post_search_response_200_blocks_item_parent_relation_type_0(
                        data
                    )
                )

                return parent_relation_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostSearchResponse200BlocksItemParentRelationType0, data)

        parent_relation = _parse_parent_relation(d.pop("parent_relation"))

        def _parse_agent_type(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        agent_type = _parse_agent_type(d.pop("agent_type"))

        def _parse_parent_tool_use_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        parent_tool_use_id = _parse_parent_tool_use_id(d.pop("parent_tool_use_id"))

        def _parse_title(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        title = _parse_title(d.pop("title"))

        harness = check_post_search_response_200_blocks_item_harness(d.pop("harness"))

        def _parse_model(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        model = _parse_model(d.pop("model"))

        def _parse_repo_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        repo_name = _parse_repo_name(d.pop("repo_name"))

        def _parse_branch(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        branch = _parse_branch(d.pop("branch"))

        user_email = d.pop("user_email")

        by_teammate = d.pop("by_teammate")

        started_at = datetime.datetime.fromisoformat(d.pop("started_at"))

        messages = []
        _messages = d.pop("messages")
        for messages_item_data in _messages:
            messages_item = PostSearchResponse200BlocksItemMessagesItem.from_dict(
                messages_item_data
            )

            messages.append(messages_item)

        truncated_fields = cast(list[str], d.pop("truncated_fields"))

        post_search_response_200_blocks_item = cls(
            session_id=session_id,
            root_session_id=root_session_id,
            parent_relation=parent_relation,
            agent_type=agent_type,
            parent_tool_use_id=parent_tool_use_id,
            title=title,
            harness=harness,
            model=model,
            repo_name=repo_name,
            branch=branch,
            user_email=user_email,
            by_teammate=by_teammate,
            started_at=started_at,
            messages=messages,
            truncated_fields=truncated_fields,
        )

        return post_search_response_200_blocks_item
