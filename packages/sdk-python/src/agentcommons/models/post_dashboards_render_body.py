from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.dashboard_definition_input import DashboardDefinitionInput
    from ..models.post_dashboards_render_body_variables import (
        PostDashboardsRenderBodyVariables,
    )


T = TypeVar("T", bound="PostDashboardsRenderBody")


@_attrs_define
class PostDashboardsRenderBody:
    """
    Attributes:
        id (UUID | Unset):
        definition (DashboardDefinitionInput | Unset):
        variables (PostDashboardsRenderBodyVariables | Unset):
        tiles (list[str] | Unset):
        refresh (bool | Unset):  Default: False.
    """

    id: UUID | Unset = UNSET
    definition: DashboardDefinitionInput | Unset = UNSET
    variables: PostDashboardsRenderBodyVariables | Unset = UNSET
    tiles: list[str] | Unset = UNSET
    refresh: bool | Unset = False

    def to_dict(self) -> dict[str, Any]:
        id: str | Unset = UNSET
        if not isinstance(self.id, Unset):
            id = str(self.id)

        definition: dict[str, Any] | Unset = UNSET
        if not isinstance(self.definition, Unset):
            definition = self.definition.to_dict()

        variables: dict[str, Any] | Unset = UNSET
        if not isinstance(self.variables, Unset):
            variables = self.variables.to_dict()

        tiles: list[str] | Unset = UNSET
        if not isinstance(self.tiles, Unset):
            tiles = self.tiles

        refresh = self.refresh

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if definition is not UNSET:
            field_dict["definition"] = definition
        if variables is not UNSET:
            field_dict["variables"] = variables
        if tiles is not UNSET:
            field_dict["tiles"] = tiles
        if refresh is not UNSET:
            field_dict["refresh"] = refresh

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.dashboard_definition_input import (
            DashboardDefinitionInput,  # noqa: PLC0415
        )
        from ..models.post_dashboards_render_body_variables import (
            PostDashboardsRenderBodyVariables,  # noqa: PLC0415
        )

        d = dict(src_dict)
        _id = d.pop("id", UNSET)
        id: UUID | Unset
        if isinstance(_id, Unset):
            id = UNSET
        else:
            id = UUID(_id)

        _definition = d.pop("definition", UNSET)
        definition: DashboardDefinitionInput | Unset
        if isinstance(_definition, Unset):
            definition = UNSET
        else:
            definition = DashboardDefinitionInput.from_dict(_definition)

        _variables = d.pop("variables", UNSET)
        variables: PostDashboardsRenderBodyVariables | Unset
        if isinstance(_variables, Unset):
            variables = UNSET
        else:
            variables = PostDashboardsRenderBodyVariables.from_dict(_variables)

        tiles = cast(list[str], d.pop("tiles", UNSET))

        refresh = d.pop("refresh", UNSET)

        post_dashboards_render_body = cls(
            id=id,
            definition=definition,
            variables=variables,
            tiles=tiles,
            refresh=refresh,
        )

        return post_dashboards_render_body
