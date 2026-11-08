from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_sessions_id_tree_response_200_nodes_item import (
        GetSessionsIdTreeResponse200NodesItem,
    )


T = TypeVar("T", bound="GetSessionsIdTreeResponse200")


@_attrs_define
class GetSessionsIdTreeResponse200:
    """
    Attributes:
        nodes (list[GetSessionsIdTreeResponse200NodesItem]):
        cursor (None | str):
    """

    nodes: list[GetSessionsIdTreeResponse200NodesItem]
    cursor: None | str

    def to_dict(self) -> dict[str, Any]:
        nodes = []
        for nodes_item_data in self.nodes:
            nodes_item = nodes_item_data.to_dict()
            nodes.append(nodes_item)

        cursor: None | str
        cursor = self.cursor

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "nodes": nodes,
                "cursor": cursor,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_sessions_id_tree_response_200_nodes_item import (
            GetSessionsIdTreeResponse200NodesItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        nodes = []
        _nodes = d.pop("nodes")
        for nodes_item_data in _nodes:
            nodes_item = GetSessionsIdTreeResponse200NodesItem.from_dict(
                nodes_item_data
            )

            nodes.append(nodes_item)

        def _parse_cursor(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        cursor = _parse_cursor(d.pop("cursor"))

        get_sessions_id_tree_response_200 = cls(
            nodes=nodes,
            cursor=cursor,
        )

        return get_sessions_id_tree_response_200
