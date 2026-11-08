from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_search_body_filters_where_item_type_1_field import (
    PostSearchBodyFiltersWhereItemType1Field,
    check_post_search_body_filters_where_item_type_1_field,
)
from ..models.post_search_body_filters_where_item_type_1_op import (
    PostSearchBodyFiltersWhereItemType1Op,
    check_post_search_body_filters_where_item_type_1_op,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostSearchBodyFiltersWhereItemType1")


@_attrs_define
class PostSearchBodyFiltersWhereItemType1:
    """Case-insensitive literal substring match; no wildcards or regex

    Attributes:
        field (PostSearchBodyFiltersWhereItemType1Field): Field to test. Message fields: tool_name, tool_use_id,
            content, role, kind, model, tool_input (JSON, needs path). Session fields: harness, title, repo_name, branch,
            user_email, status
        op (PostSearchBodyFiltersWhereItemType1Op):
        value (str):
        path (list[str] | Unset): JSON keys or array positions inside tool_input, such as ["file_path"]; only with field
            tool_input
    """

    field: PostSearchBodyFiltersWhereItemType1Field
    op: PostSearchBodyFiltersWhereItemType1Op
    value: str
    path: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        field: str = self.field

        op: str = self.op

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
        field = check_post_search_body_filters_where_item_type_1_field(d.pop("field"))

        op = check_post_search_body_filters_where_item_type_1_op(d.pop("op"))

        value = d.pop("value")

        path = cast(list[str], d.pop("path", UNSET))

        post_search_body_filters_where_item_type_1 = cls(
            field=field,
            op=op,
            value=value,
            path=path,
        )

        return post_search_body_filters_where_item_type_1
