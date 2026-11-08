from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostQueryBody")


@_attrs_define
class PostQueryBody:
    """
    Attributes:
        sql (str):
    """

    sql: str

    def to_dict(self) -> dict[str, Any]:
        sql = self.sql

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "sql": sql,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        sql = d.pop("sql")

        post_query_body = cls(
            sql=sql,
        )

        return post_query_body
