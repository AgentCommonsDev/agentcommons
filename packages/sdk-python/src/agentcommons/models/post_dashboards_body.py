from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.dashboard_definition_input import DashboardDefinitionInput


T = TypeVar("T", bound="PostDashboardsBody")


@_attrs_define
class PostDashboardsBody:
    """
    Attributes:
        name (str):
        definition (DashboardDefinitionInput):
        id (UUID | Unset):
        revision (int | Unset):
        description (str | Unset):  Default: ''.
    """

    name: str
    definition: DashboardDefinitionInput
    id: UUID | Unset = UNSET
    revision: int | Unset = UNSET
    description: str | Unset = ""

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        definition = self.definition.to_dict()

        id: str | Unset = UNSET
        if not isinstance(self.id, Unset):
            id = str(self.id)

        revision = self.revision

        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "definition": definition,
            }
        )
        if id is not UNSET:
            field_dict["id"] = id
        if revision is not UNSET:
            field_dict["revision"] = revision
        if description is not UNSET:
            field_dict["description"] = description

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.dashboard_definition_input import (
            DashboardDefinitionInput,  # noqa: PLC0415
        )

        d = dict(src_dict)
        name = d.pop("name")

        definition = DashboardDefinitionInput.from_dict(d.pop("definition"))

        _id = d.pop("id", UNSET)
        id: UUID | Unset
        if isinstance(_id, Unset):
            id = UNSET
        else:
            id = UUID(_id)

        revision = d.pop("revision", UNSET)

        description = d.pop("description", UNSET)

        post_dashboards_body = cls(
            name=name,
            definition=definition,
            id=id,
            revision=revision,
            description=description,
        )

        return post_dashboards_body
