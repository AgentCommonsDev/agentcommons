from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.dashboard_tile_variant_0 import DashboardTileVariant0
    from ..models.dashboard_tile_variant_1 import DashboardTileVariant1
    from ..models.dashboard_tile_variant_2 import DashboardTileVariant2
    from ..models.dashboard_tile_variant_3 import DashboardTileVariant3
    from ..models.dashboard_tile_variant_4 import DashboardTileVariant4
    from ..models.dashboard_variable_variant_0 import DashboardVariableVariant0
    from ..models.dashboard_variable_variant_1 import DashboardVariableVariant1
    from ..models.dashboard_variable_variant_2 import DashboardVariableVariant2
    from ..models.dashboard_variable_variant_3 import DashboardVariableVariant3
    from ..models.dashboard_variable_variant_4 import DashboardVariableVariant4


T = TypeVar("T", bound="GetDashboardsResponse200TemplatesItem")


@_attrs_define
class GetDashboardsResponse200TemplatesItem:
    """
    Attributes:
        id (str):
        title (str):
        description (str):
        variables (list[DashboardVariableVariant0 | DashboardVariableVariant1 | DashboardVariableVariant2 |
            DashboardVariableVariant3 | DashboardVariableVariant4]):
        tile (DashboardTileVariant0 | DashboardTileVariant1 | DashboardTileVariant2 | DashboardTileVariant3 |
            DashboardTileVariant4):
    """

    id: str
    title: str
    description: str
    variables: list[
        DashboardVariableVariant0
        | DashboardVariableVariant1
        | DashboardVariableVariant2
        | DashboardVariableVariant3
        | DashboardVariableVariant4
    ]
    tile: (
        DashboardTileVariant0
        | DashboardTileVariant1
        | DashboardTileVariant2
        | DashboardTileVariant3
        | DashboardTileVariant4
    )

    def to_dict(self) -> dict[str, Any]:
        from ..models.dashboard_tile_variant_0 import (
            DashboardTileVariant0,  # noqa: PLC0415
        )
        from ..models.dashboard_tile_variant_1 import (
            DashboardTileVariant1,  # noqa: PLC0415
        )
        from ..models.dashboard_tile_variant_2 import (
            DashboardTileVariant2,  # noqa: PLC0415
        )
        from ..models.dashboard_tile_variant_3 import (
            DashboardTileVariant3,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_variant_0 import (
            DashboardVariableVariant0,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_variant_1 import (
            DashboardVariableVariant1,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_variant_2 import (
            DashboardVariableVariant2,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_variant_3 import (
            DashboardVariableVariant3,  # noqa: PLC0415
        )

        id = self.id

        title = self.title

        description = self.description

        variables = []
        for variables_item_data in self.variables:
            variables_item: dict[str, Any]
            if isinstance(variables_item_data, DashboardVariableVariant0):
                variables_item = variables_item_data.to_dict()
            elif isinstance(variables_item_data, DashboardVariableVariant1):
                variables_item = variables_item_data.to_dict()
            elif isinstance(variables_item_data, DashboardVariableVariant2):
                variables_item = variables_item_data.to_dict()
            elif isinstance(variables_item_data, DashboardVariableVariant3):
                variables_item = variables_item_data.to_dict()
            else:
                variables_item = variables_item_data.to_dict()

            variables.append(variables_item)

        tile: dict[str, Any]
        if isinstance(self.tile, DashboardTileVariant0):
            tile = self.tile.to_dict()
        elif isinstance(self.tile, DashboardTileVariant1):
            tile = self.tile.to_dict()
        elif isinstance(self.tile, DashboardTileVariant2):
            tile = self.tile.to_dict()
        elif isinstance(self.tile, DashboardTileVariant3):
            tile = self.tile.to_dict()
        else:
            tile = self.tile.to_dict()

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "title": title,
                "description": description,
                "variables": variables,
                "tile": tile,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.dashboard_tile_variant_0 import (
            DashboardTileVariant0,  # noqa: PLC0415
        )
        from ..models.dashboard_tile_variant_1 import (
            DashboardTileVariant1,  # noqa: PLC0415
        )
        from ..models.dashboard_tile_variant_2 import (
            DashboardTileVariant2,  # noqa: PLC0415
        )
        from ..models.dashboard_tile_variant_3 import (
            DashboardTileVariant3,  # noqa: PLC0415
        )
        from ..models.dashboard_tile_variant_4 import (
            DashboardTileVariant4,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_variant_0 import (
            DashboardVariableVariant0,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_variant_1 import (
            DashboardVariableVariant1,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_variant_2 import (
            DashboardVariableVariant2,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_variant_3 import (
            DashboardVariableVariant3,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_variant_4 import (
            DashboardVariableVariant4,  # noqa: PLC0415
        )

        d = dict(src_dict)
        id = d.pop("id")

        title = d.pop("title")

        description = d.pop("description")

        variables = []
        _variables = d.pop("variables")
        for variables_item_data in _variables:

            def _parse_variables_item(
                data: object,
            ) -> (
                DashboardVariableVariant0
                | DashboardVariableVariant1
                | DashboardVariableVariant2
                | DashboardVariableVariant3
                | DashboardVariableVariant4
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_dashboard_variable_type_0 = (
                        DashboardVariableVariant0.from_dict(data)
                    )

                    return componentsschemas_dashboard_variable_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_dashboard_variable_type_1 = (
                        DashboardVariableVariant1.from_dict(data)
                    )

                    return componentsschemas_dashboard_variable_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_dashboard_variable_type_2 = (
                        DashboardVariableVariant2.from_dict(data)
                    )

                    return componentsschemas_dashboard_variable_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_dashboard_variable_type_3 = (
                        DashboardVariableVariant3.from_dict(data)
                    )

                    return componentsschemas_dashboard_variable_type_3
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_dashboard_variable_type_4 = (
                    DashboardVariableVariant4.from_dict(data)
                )

                return componentsschemas_dashboard_variable_type_4

            variables_item = _parse_variables_item(variables_item_data)

            variables.append(variables_item)

        def _parse_tile(
            data: object,
        ) -> (
            DashboardTileVariant0
            | DashboardTileVariant1
            | DashboardTileVariant2
            | DashboardTileVariant3
            | DashboardTileVariant4
        ):
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_dashboard_tile_type_0 = (
                    DashboardTileVariant0.from_dict(data)
                )

                return componentsschemas_dashboard_tile_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_dashboard_tile_type_1 = (
                    DashboardTileVariant1.from_dict(data)
                )

                return componentsschemas_dashboard_tile_type_1
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_dashboard_tile_type_2 = (
                    DashboardTileVariant2.from_dict(data)
                )

                return componentsschemas_dashboard_tile_type_2
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_dashboard_tile_type_3 = (
                    DashboardTileVariant3.from_dict(data)
                )

                return componentsschemas_dashboard_tile_type_3
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            if not isinstance(data, dict):
                raise TypeError()
            componentsschemas_dashboard_tile_type_4 = DashboardTileVariant4.from_dict(
                data
            )

            return componentsschemas_dashboard_tile_type_4

        tile = _parse_tile(d.pop("tile"))

        get_dashboards_response_200_templates_item = cls(
            id=id,
            title=title,
            description=description,
            variables=variables,
            tile=tile,
        )

        return get_dashboards_response_200_templates_item
