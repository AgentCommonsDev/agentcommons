from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.post_search_body_filters_where_item_type_3_field import (
    PostSearchBodyFiltersWhereItemType3Field,
    check_post_search_body_filters_where_item_type_3_field,
)
from ..models.post_search_body_filters_where_item_type_3_op import (
    PostSearchBodyFiltersWhereItemType3Op,
    check_post_search_body_filters_where_item_type_3_op,
)
from ..types import UNSET, Unset

T = TypeVar("T", bound="PostSearchBodyFiltersWhereItemType3")


@_attrs_define
class PostSearchBodyFiltersWhereItemType3:
    """The field, or the tool_input path, has a non-null value

    Attributes:
        field (PostSearchBodyFiltersWhereItemType3Field): Field to test. Message fields: tool_name, tool_use_id,
            content, role, kind, model, tool_input (JSON, needs path). Session fields: harness, title, repo_name, branch,
            user_email, status
        op (PostSearchBodyFiltersWhereItemType3Op):
        path (list[str] | Unset): JSON keys or array positions inside tool_input, such as ["file_path"]; only with field
            tool_input
    """

    field: PostSearchBodyFiltersWhereItemType3Field
    op: PostSearchBodyFiltersWhereItemType3Op
    path: list[str] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        field: str = self.field

        op: str = self.op

        path: list[str] | Unset = UNSET
        if not isinstance(self.path, Unset):
            path = self.path

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "field": field,
                "op": op,
            }
        )
        if path is not UNSET:
            field_dict["path"] = path

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        field = check_post_search_body_filters_where_item_type_3_field(d.pop("field"))

        op = check_post_search_body_filters_where_item_type_3_op(d.pop("op"))

        path = cast(list[str], d.pop("path", UNSET))

        post_search_body_filters_where_item_type_3 = cls(
            field=field,
            op=op,
            path=path,
        )

        return post_search_body_filters_where_item_type_3
