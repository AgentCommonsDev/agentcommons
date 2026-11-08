from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostIngestBodyContextGitType0")


@_attrs_define
class PostIngestBodyContextGitType0:
    """
    Attributes:
        root (str):
        remote_url (None | str):
        branch (None | str):
        head (None | str):
    """

    root: str
    remote_url: None | str
    branch: None | str
    head: None | str

    def to_dict(self) -> dict[str, Any]:
        root = self.root

        remote_url: None | str
        remote_url = self.remote_url

        branch: None | str
        branch = self.branch

        head: None | str
        head = self.head

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "root": root,
                "remoteUrl": remote_url,
                "branch": branch,
                "head": head,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        root = d.pop("root")

        def _parse_remote_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        remote_url = _parse_remote_url(d.pop("remoteUrl"))

        def _parse_branch(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        branch = _parse_branch(d.pop("branch"))

        def _parse_head(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        head = _parse_head(d.pop("head"))

        post_ingest_body_context_git_type_0 = cls(
            root=root,
            remote_url=remote_url,
            branch=branch,
            head=head,
        )

        return post_ingest_body_context_git_type_0
