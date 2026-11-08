from __future__ import annotations

from collections.abc import Mapping
from typing import (
    TYPE_CHECKING,
    Any,
    Literal,
    TypeVar,
    cast,
)

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.dashboard_tile_input_variant_0 import DashboardTileInputVariant0
    from ..models.dashboard_tile_input_variant_1 import DashboardTileInputVariant1
    from ..models.dashboard_tile_input_variant_2 import DashboardTileInputVariant2
    from ..models.dashboard_tile_input_variant_3 import DashboardTileInputVariant3
    from ..models.dashboard_tile_input_variant_4 import DashboardTileInputVariant4
    from ..models.dashboard_variable_input_variant_0 import (
        DashboardVariableInputVariant0,
    )
    from ..models.dashboard_variable_input_variant_1 import (
        DashboardVariableInputVariant1,
    )
    from ..models.dashboard_variable_input_variant_2 import (
        DashboardVariableInputVariant2,
    )
    from ..models.dashboard_variable_input_variant_3 import (
        DashboardVariableInputVariant3,
    )
    from ..models.dashboard_variable_input_variant_4 import (
        DashboardVariableInputVariant4,
    )


T = TypeVar("T", bound="DashboardDefinitionInput")


@_attrs_define
class DashboardDefinitionInput:
    """
    Attributes:
        version (Literal[2]):
        tiles (list[DashboardTileInputVariant0 | DashboardTileInputVariant1 | DashboardTileInputVariant2 |
            DashboardTileInputVariant3 | DashboardTileInputVariant4]):
        variables (list[DashboardVariableInputVariant0 | DashboardVariableInputVariant1 | DashboardVariableInputVariant2
            | DashboardVariableInputVariant3 | DashboardVariableInputVariant4] | Unset):
    """

    version: Literal[2]
    tiles: list[
        DashboardTileInputVariant0
        | DashboardTileInputVariant1
        | DashboardTileInputVariant2
        | DashboardTileInputVariant3
        | DashboardTileInputVariant4
    ]
    variables: (
        list[
            DashboardVariableInputVariant0
            | DashboardVariableInputVariant1
            | DashboardVariableInputVariant2
            | DashboardVariableInputVariant3
            | DashboardVariableInputVariant4
        ]
        | Unset
    ) = UNSET

    def to_dict(self) -> dict[str, Any]:
        from ..models.dashboard_tile_input_variant_0 import (
            DashboardTileInputVariant0,  # noqa: PLC0415
        )
        from ..models.dashboard_tile_input_variant_1 import (
            DashboardTileInputVariant1,  # noqa: PLC0415
        )
        from ..models.dashboard_tile_input_variant_2 import (
            DashboardTileInputVariant2,  # noqa: PLC0415
        )
        from ..models.dashboard_tile_input_variant_3 import (
            DashboardTileInputVariant3,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_input_variant_0 import (
            DashboardVariableInputVariant0,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_input_variant_1 import (
            DashboardVariableInputVariant1,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_input_variant_2 import (
            DashboardVariableInputVariant2,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_input_variant_3 import (
            DashboardVariableInputVariant3,  # noqa: PLC0415
        )

        version = self.version

        tiles = []
        for tiles_item_data in self.tiles:
            tiles_item: dict[str, Any]
            if isinstance(tiles_item_data, DashboardTileInputVariant0):
                tiles_item = tiles_item_data.to_dict()
            elif isinstance(tiles_item_data, DashboardTileInputVariant1):
                tiles_item = tiles_item_data.to_dict()
            elif isinstance(tiles_item_data, DashboardTileInputVariant2):
                tiles_item = tiles_item_data.to_dict()
            elif isinstance(tiles_item_data, DashboardTileInputVariant3):
                tiles_item = tiles_item_data.to_dict()
            else:
                tiles_item = tiles_item_data.to_dict()

            tiles.append(tiles_item)

        variables: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.variables, Unset):
            variables = []
            for variables_item_data in self.variables:
                variables_item: dict[str, Any]
                if isinstance(variables_item_data, DashboardVariableInputVariant0):
                    variables_item = variables_item_data.to_dict()
                elif isinstance(variables_item_data, DashboardVariableInputVariant1):
                    variables_item = variables_item_data.to_dict()
                elif isinstance(variables_item_data, DashboardVariableInputVariant2):
                    variables_item = variables_item_data.to_dict()
                elif isinstance(variables_item_data, DashboardVariableInputVariant3):
                    variables_item = variables_item_data.to_dict()
                else:
                    variables_item = variables_item_data.to_dict()

                variables.append(variables_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "version": version,
                "tiles": tiles,
            }
        )
        if variables is not UNSET:
            field_dict["variables"] = variables

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.dashboard_tile_input_variant_0 import (
            DashboardTileInputVariant0,  # noqa: PLC0415
        )
        from ..models.dashboard_tile_input_variant_1 import (
            DashboardTileInputVariant1,  # noqa: PLC0415
        )
        from ..models.dashboard_tile_input_variant_2 import (
            DashboardTileInputVariant2,  # noqa: PLC0415
        )
        from ..models.dashboard_tile_input_variant_3 import (
            DashboardTileInputVariant3,  # noqa: PLC0415
        )
        from ..models.dashboard_tile_input_variant_4 import (
            DashboardTileInputVariant4,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_input_variant_0 import (
            DashboardVariableInputVariant0,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_input_variant_1 import (
            DashboardVariableInputVariant1,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_input_variant_2 import (
            DashboardVariableInputVariant2,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_input_variant_3 import (
            DashboardVariableInputVariant3,  # noqa: PLC0415
        )
        from ..models.dashboard_variable_input_variant_4 import (
            DashboardVariableInputVariant4,  # noqa: PLC0415
        )

        d = dict(src_dict)
        version = cast(Literal[2], d.pop("version"))
        if version != 2:
            raise ValueError(f"version must match const 2, got '{version}'")

        tiles = []
        _tiles = d.pop("tiles")
        for tiles_item_data in _tiles:

            def _parse_tiles_item(
                data: object,
            ) -> (
                DashboardTileInputVariant0
                | DashboardTileInputVariant1
                | DashboardTileInputVariant2
                | DashboardTileInputVariant3
                | DashboardTileInputVariant4
            ):
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_dashboard_tile_input_type_0 = (
                        DashboardTileInputVariant0.from_dict(data)
                    )

                    return componentsschemas_dashboard_tile_input_type_0
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_dashboard_tile_input_type_1 = (
                        DashboardTileInputVariant1.from_dict(data)
                    )

                    return componentsschemas_dashboard_tile_input_type_1
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_dashboard_tile_input_type_2 = (
                        DashboardTileInputVariant2.from_dict(data)
                    )

                    return componentsschemas_dashboard_tile_input_type_2
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                try:
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_dashboard_tile_input_type_3 = (
                        DashboardTileInputVariant3.from_dict(data)
                    )

                    return componentsschemas_dashboard_tile_input_type_3
                except (TypeError, ValueError, AttributeError, KeyError):
                    pass
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_dashboard_tile_input_type_4 = (
                    DashboardTileInputVariant4.from_dict(data)
                )

                return componentsschemas_dashboard_tile_input_type_4

            tiles_item = _parse_tiles_item(tiles_item_data)

            tiles.append(tiles_item)

        _variables = d.pop("variables", UNSET)
        variables: (
            list[
                DashboardVariableInputVariant0
                | DashboardVariableInputVariant1
                | DashboardVariableInputVariant2
                | DashboardVariableInputVariant3
                | DashboardVariableInputVariant4
            ]
            | Unset
        ) = UNSET
        if _variables is not UNSET:
            variables = []
            for variables_item_data in _variables:

                def _parse_variables_item(
                    data: object,
                ) -> (
                    DashboardVariableInputVariant0
                    | DashboardVariableInputVariant1
                    | DashboardVariableInputVariant2
                    | DashboardVariableInputVariant3
                    | DashboardVariableInputVariant4
                ):
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        componentsschemas_dashboard_variable_input_type_0 = (
                            DashboardVariableInputVariant0.from_dict(data)
                        )

                        return componentsschemas_dashboard_variable_input_type_0
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        componentsschemas_dashboard_variable_input_type_1 = (
                            DashboardVariableInputVariant1.from_dict(data)
                        )

                        return componentsschemas_dashboard_variable_input_type_1
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        componentsschemas_dashboard_variable_input_type_2 = (
                            DashboardVariableInputVariant2.from_dict(data)
                        )

                        return componentsschemas_dashboard_variable_input_type_2
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    try:
                        if not isinstance(data, dict):
                            raise TypeError()
                        componentsschemas_dashboard_variable_input_type_3 = (
                            DashboardVariableInputVariant3.from_dict(data)
                        )

                        return componentsschemas_dashboard_variable_input_type_3
                    except (TypeError, ValueError, AttributeError, KeyError):
                        pass
                    if not isinstance(data, dict):
                        raise TypeError()
                    componentsschemas_dashboard_variable_input_type_4 = (
                        DashboardVariableInputVariant4.from_dict(data)
                    )

                    return componentsschemas_dashboard_variable_input_type_4

                variables_item = _parse_variables_item(variables_item_data)

                variables.append(variables_item)

        dashboard_definition_input = cls(
            version=version,
            tiles=tiles,
            variables=variables,
        )

        return dashboard_definition_input
