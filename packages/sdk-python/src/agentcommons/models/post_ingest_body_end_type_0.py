from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_ingest_body_end_type_0_observed_commits_item import (
        PostIngestBodyEndType0ObservedCommitsItem,
    )
    from ..models.post_ingest_body_end_type_0_observed_diff_stat_type_0 import (
        PostIngestBodyEndType0ObservedDiffStatType0,
    )


T = TypeVar("T", bound="PostIngestBodyEndType0")


@_attrs_define
class PostIngestBodyEndType0:
    """
    Attributes:
        reason (None | str):
        head (None | str):
        observed_commits (list[PostIngestBodyEndType0ObservedCommitsItem]):
        observed_diff_stat (None | PostIngestBodyEndType0ObservedDiffStatType0):
        dirty_file_count (int | None):
    """

    reason: None | str
    head: None | str
    observed_commits: list[PostIngestBodyEndType0ObservedCommitsItem]
    observed_diff_stat: None | PostIngestBodyEndType0ObservedDiffStatType0
    dirty_file_count: int | None

    def to_dict(self) -> dict[str, Any]:
        from ..models.post_ingest_body_end_type_0_observed_diff_stat_type_0 import (
            PostIngestBodyEndType0ObservedDiffStatType0,  # noqa: PLC0415
        )

        reason: None | str
        reason = self.reason

        head: None | str
        head = self.head

        observed_commits = []
        for observed_commits_item_data in self.observed_commits:
            observed_commits_item = observed_commits_item_data.to_dict()
            observed_commits.append(observed_commits_item)

        observed_diff_stat: dict[str, Any] | None
        if isinstance(
            self.observed_diff_stat, PostIngestBodyEndType0ObservedDiffStatType0
        ):
            observed_diff_stat = self.observed_diff_stat.to_dict()
        else:
            observed_diff_stat = self.observed_diff_stat

        dirty_file_count: int | None
        dirty_file_count = self.dirty_file_count

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "reason": reason,
                "head": head,
                "observedCommits": observed_commits,
                "observedDiffStat": observed_diff_stat,
                "dirtyFileCount": dirty_file_count,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_ingest_body_end_type_0_observed_commits_item import (
            PostIngestBodyEndType0ObservedCommitsItem,  # noqa: PLC0415
        )
        from ..models.post_ingest_body_end_type_0_observed_diff_stat_type_0 import (
            PostIngestBodyEndType0ObservedDiffStatType0,  # noqa: PLC0415
        )

        d = dict(src_dict)

        def _parse_reason(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        reason = _parse_reason(d.pop("reason"))

        def _parse_head(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        head = _parse_head(d.pop("head"))

        observed_commits = []
        _observed_commits = d.pop("observedCommits")
        for observed_commits_item_data in _observed_commits:
            observed_commits_item = PostIngestBodyEndType0ObservedCommitsItem.from_dict(
                observed_commits_item_data
            )

            observed_commits.append(observed_commits_item)

        def _parse_observed_diff_stat(
            data: object,
        ) -> None | PostIngestBodyEndType0ObservedDiffStatType0:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                observed_diff_stat_type_0 = (
                    PostIngestBodyEndType0ObservedDiffStatType0.from_dict(data)
                )

                return observed_diff_stat_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | PostIngestBodyEndType0ObservedDiffStatType0, data)

        observed_diff_stat = _parse_observed_diff_stat(d.pop("observedDiffStat"))

        def _parse_dirty_file_count(data: object) -> int | None:
            if data is None:
                return data
            return cast(int | None, data)

        dirty_file_count = _parse_dirty_file_count(d.pop("dirtyFileCount"))

        post_ingest_body_end_type_0 = cls(
            reason=reason,
            head=head,
            observed_commits=observed_commits,
            observed_diff_stat=observed_diff_stat,
            dirty_file_count=dirty_file_count,
        )

        return post_ingest_body_end_type_0
