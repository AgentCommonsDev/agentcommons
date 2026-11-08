from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_search_body_filters_where_item_type_0_field import (
    PostSearchBodyFiltersWhereItemType0Field,
    check_post_search_body_filters_where_item_type_0_field,
)
from ..models.post_search_body_filters_where_item_type_0_op import (
    PostSearchBodyFiltersWhereItemType0Op,
    check_post_search_body_filters_where_item_type_0_op,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostSearchBodyFiltersWhereItemType0")


@_attrs_define
class PostSearchBodyFiltersWhereItemType0:
    """Exact, case-sensitive match; null matches a missing value. tool_input compares a JSON primitive with its type

    Attributes:
        field (PostSearchBodyFiltersWhereItemType0Field): Field to test. Message fields: tool_name, tool_use_id,
            content, role, kind, model, tool_input (JSON, needs path). Session fields: harness, title, repo_name, branch,
            user_email, status
        op (PostSearchBodyFiltersWhereItemType0Op):
        value (bool | float | None | str):
        path (list[str] | Unset): JSON keys or array positions inside tool_input, such as ["file_path"]; only with field
            tool_input
    """

    field: PostSearchBodyFiltersWhereItemType0Field
    op: PostSearchBodyFiltersWhereItemType0Op
    value: bool | float | None | str
    path: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        field: str = self.field

        op: str = self.op

        value: bool | float | None | str
        value = self.value

        path: list[str] | Unset = UNSET
        if not isinstance(self.path, Unset):
            path = self.path

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "field": field,
                "op": op,
                "value": value,
            }
        )
        if path is not UNSET:
            field_dict["path"] = path

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field = check_post_search_body_filters_where_item_type_0_field(d.pop("field"))

        op = check_post_search_body_filters_where_item_type_0_op(d.pop("op"))

        def _parse_value(data: object) -> bool | float | None | str:
            if data is None:
                return data
            return cast(bool | float | None | str, data)

        value = _parse_value(d.pop("value"))

        path = cast(list[str], d.pop("path", UNSET))

        post_search_body_filters_where_item_type_0 = cls(
            field=field,
            op=op,
            value=value,
            path=path,
        )

        return post_search_body_filters_where_item_type_0
