from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_dashboards_response_200_items_item import (
        GetDashboardsResponse200ItemsItem,
    )
    from ..models.get_dashboards_response_200_templates_item import (
        GetDashboardsResponse200TemplatesItem,
    )


T = TypeVar("T", bound="GetDashboardsResponse200")


@_attrs_define
class GetDashboardsResponse200:
    """
    Attributes:
        items (list[GetDashboardsResponse200ItemsItem]):
        default_id (UUID):
        definition_schema (Any):
        templates (list[GetDashboardsResponse200TemplatesItem]):
    """

    items: list[GetDashboardsResponse200ItemsItem]
    default_id: UUID
    definition_schema: Any
    templates: list[GetDashboardsResponse200TemplatesItem]

    def to_dict(self) -> dict[str, Any]:
        items = []
        for items_item_data in self.items:
            items_item = items_item_data.to_dict()
            items.append(items_item)

        default_id = str(self.default_id)

        definition_schema = self.definition_schema

        templates = []
        for templates_item_data in self.templates:
            templates_item = templates_item_data.to_dict()
            templates.append(templates_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "items": items,
                "default_id": default_id,
                "definition_schema": definition_schema,
                "templates": templates,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_dashboards_response_200_items_item import (
            GetDashboardsResponse200ItemsItem,  # noqa: PLC0415
        )
        from ..models.get_dashboards_response_200_templates_item import (
            GetDashboardsResponse200TemplatesItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        items = []
        _items = d.pop("items")
        for items_item_data in _items:
            items_item = GetDashboardsResponse200ItemsItem.from_dict(items_item_data)

            items.append(items_item)

        default_id = UUID(d.pop("default_id"))

        definition_schema = d.pop("definition_schema")

        templates = []
        _templates = d.pop("templates")
        for templates_item_data in _templates:
            templates_item = GetDashboardsResponse200TemplatesItem.from_dict(
                templates_item_data
            )

            templates.append(templates_item)

        get_dashboards_response_200 = cls(
            items=items,
            default_id=default_id,
            definition_schema=definition_schema,
            templates=templates,
        )

        return get_dashboards_response_200
