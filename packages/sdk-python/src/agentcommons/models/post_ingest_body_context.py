from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.post_ingest_body_context_git_type_0 import (
        PostIngestBodyContextGitType0,
    )
    from ..models.post_ingest_body_context_installation import (
        PostIngestBodyContextInstallation,
    )
    from ..models.post_ingest_body_context_parent_hint_type_0 import (
        PostIngestBodyContextParentHintType0,
    )
    from ..models.post_ingest_body_context_transcript_metadata import (
        PostIngestBodyContextTranscriptMetadata,
    )


T = TypeVar("T", bound="PostIngestBodyContext")


@_attrs_define
class PostIngestBodyContext:
    """
    Attributes:
        cwd (str):
        installation (PostIngestBodyContextInstallation):
        git (None | PostIngestBodyContextGitType0):
        parent_hint (None | PostIngestBodyContextParentHintType0):
        active_leaf_id (None | str | Unset):
        transcript_metadata (PostIngestBodyContextTranscriptMetadata | Unset):
    """

    cwd: str
    installation: PostIngestBodyContextInstallation
    git: None | PostIngestBodyContextGitType0
    parent_hint: None | PostIngestBodyContextParentHintType0
    active_leaf_id: None | str | Unset = UNSET
    transcript_metadata: PostIngestBodyContextTranscriptMetadata | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_ingest_body_context_git_type_0 import (
            PostIngestBodyContextGitType0,  # noqa: PLC0415
        )
        from ..models.post_ingest_body_context_parent_hint_type_0 import (
            PostIngestBodyContextParentHintType0,  # noqa: PLC0415
        )

        cwd = self.cwd

        installation = self.installation.to_dict()

        git: dict[str, Any] | None
        if isinstance(self.git, PostIngestBodyContextGitType0):
            git = self.git.to_dict()
        else:
            git = self.git

        parent_hint: dict[str, Any] | None
        if isinstance(self.parent_hint, PostIngestBodyContextParentHintType0):
            parent_hint = self.parent_hint.to_dict()
        else:
            parent_hint = self.parent_hint

        active_leaf_id: None | str | Unset
        if isinstance(self.active_leaf_id, Unset):
            active_leaf_id = UNSET
        else:
            active_leaf_id = self.active_leaf_id

        transcript_metadata: dict[str, Any] | Unset = UNSET
        if not isinstance(self.transcript_metadata, Unset):
            transcript_metadata = self.transcript_metadata.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "cwd": cwd,
                "installation": installation,
                "git": git,
                "parentHint": parent_hint,
            }
        )
        if active_leaf_id is not UNSET:
            field_dict["activeLeafId"] = active_leaf_id
        if transcript_metadata is not UNSET:
            field_dict["transcriptMetadata"] = transcript_metadata

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_ingest_body_context_git_type_0 import (
            PostIngestBodyContextGitType0,  # noqa: PLC0415
        )
        from ..models.post_ingest_body_context_installation import (
            PostIngestBodyContextInstallation,  # noqa: PLC0415
        )
        from ..models.post_ingest_body_context_parent_hint_type_0 import (
            PostIngestBodyContextParentHintType0,  # noqa: PLC0415
        )
        from ..models.post_ingest_body_context_transcript_metadata import (
            PostIngestBodyContextTranscriptMetadata,  # noqa: PLC0415
        )

        d = dict(src_dict)
        cwd = d.pop("cwd")

        installation = PostIngestBodyContextInstallation.from_dict(
            d.pop("installation")
        )

        def _parse_git(data: object) -> None | PostIngestBodyContextGitType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                git_type_0 = PostIngestBodyContextGitType0.from_dict(data)

                return git_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostIngestBodyContextGitType0, data)

        git = _parse_git(d.pop("git"))

        def _parse_parent_hint(
            data: object,
        ) -> None | PostIngestBodyContextParentHintType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                parent_hint_type_0 = PostIngestBodyContextParentHintType0.from_dict(
                    data
                )

                return parent_hint_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostIngestBodyContextParentHintType0, data)

        parent_hint = _parse_parent_hint(d.pop("parentHint"))

        def _parse_active_leaf_id(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        active_leaf_id = _parse_active_leaf_id(d.pop("activeLeafId", UNSET))

        _transcript_metadata = d.pop("transcriptMetadata", UNSET)
        transcript_metadata: PostIngestBodyContextTranscriptMetadata | Unset
        if isinstance(_transcript_metadata, Unset):
            transcript_metadata = UNSET
        else:
            transcript_metadata = PostIngestBodyContextTranscriptMetadata.from_dict(
                _transcript_metadata
            )

        post_ingest_body_context = cls(
            cwd=cwd,
            installation=installation,
            git=git,
            parent_hint=parent_hint,
            active_leaf_id=active_leaf_id,
            transcript_metadata=transcript_metadata,
        )

        return post_ingest_body_context
