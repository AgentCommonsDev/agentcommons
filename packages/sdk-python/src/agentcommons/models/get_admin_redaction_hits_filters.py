from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

from ..models.get_admin_redaction_hits_filters_source import (
    GetAdminRedactionHitsFiltersSource,
    check_get_admin_redaction_hits_filters_source,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="GetAdminRedactionHitsFilters")


@_attrs_define
class GetAdminRedactionHitsFilters:
    """
    Attributes:
        run_id (UUID | Unset):
        session_id (UUID | Unset):
        policy_id (UUID | Unset):
        source (GetAdminRedactionHitsFiltersSource | Unset):
        q (str | Unset):
    """

    run_id: UUID | Unset = UNSET
    session_id: UUID | Unset = UNSET
    policy_id: UUID | Unset = UNSET
    source: GetAdminRedactionHitsFiltersSource | Unset = UNSET
    q: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        run_id: str | Unset = UNSET
        if not isinstance(self.run_id, Unset):
            run_id = str(self.run_id)

        session_id: str | Unset = UNSET
        if not isinstance(self.session_id, Unset):
            session_id = str(self.session_id)

        policy_id: str | Unset = UNSET
        if not isinstance(self.policy_id, Unset):
            policy_id = str(self.policy_id)

        source: str | Unset = UNSET
        if not isinstance(self.source, Unset):
            source = self.source

        q = self.q

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if run_id is not UNSET:
            field_dict["run_id"] = run_id
        if session_id is not UNSET:
            field_dict["session_id"] = session_id
        if policy_id is not UNSET:
            field_dict["policy_id"] = policy_id
        if source is not UNSET:
            field_dict["source"] = source
        if q is not UNSET:
            field_dict["q"] = q

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _run_id = d.pop("run_id", UNSET)
        run_id: UUID | Unset
        if isinstance(_run_id, Unset):
            run_id = UNSET
        else:
            run_id = UUID(_run_id)

        _session_id = d.pop("session_id", UNSET)
        session_id: UUID | Unset
        if isinstance(_session_id, Unset):
            session_id = UNSET
        else:
            session_id = UUID(_session_id)

        _policy_id = d.pop("policy_id", UNSET)
        policy_id: UUID | Unset
        if isinstance(_policy_id, Unset):
            policy_id = UNSET
        else:
            policy_id = UUID(_policy_id)

        _source = d.pop("source", UNSET)
        source: GetAdminRedactionHitsFiltersSource | Unset
        if isinstance(_source, Unset):
            source = UNSET
        else:
            source = check_get_admin_redaction_hits_filters_source(_source)

        q = d.pop("q", UNSET)

        get_admin_redaction_hits_filters = cls(
            run_id=run_id,
            session_id=session_id,
            policy_id=policy_id,
            source=source,
            q=q,
        )

        return get_admin_redaction_hits_filters
