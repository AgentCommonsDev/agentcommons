from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.post_query_response_200_columns_item import (
        PostQueryResponse200ColumnsItem,
    )


T = TypeVar("T", bound="PostQueryResponse200")


@_attrs_define
class PostQueryResponse200:
    """
    Attributes:
        columns (list[PostQueryResponse200ColumnsItem]):
        rows (list[list[Any]]):
        row_count (int):
        capped (bool):
        truncated_cells (list[list[int]]):
        duration_ms (float):
    """

    columns: list[PostQueryResponse200ColumnsItem]
    rows: list[list[Any]]
    row_count: int
    capped: bool
    truncated_cells: list[list[int]]
    duration_ms: float

    def to_dict(self) -> dict[str, Any]:
        columns = []
        for columns_item_data in self.columns:
            columns_item = columns_item_data.to_dict()
            columns.append(columns_item)

        rows = []
        for rows_item_data in self.rows:
            rows_item = rows_item_data

            rows.append(rows_item)

        row_count = self.row_count

        capped = self.capped

        truncated_cells = []
        for truncated_cells_item_data in self.truncated_cells:
            truncated_cells_item = truncated_cells_item_data

            truncated_cells.append(truncated_cells_item)

        duration_ms = self.duration_ms

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "columns": columns,
                "rows": rows,
                "row_count": row_count,
                "capped": capped,
                "truncated_cells": truncated_cells,
                "duration_ms": duration_ms,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.post_query_response_200_columns_item import (
            PostQueryResponse200ColumnsItem,  # noqa: PLC0415
        )

        d = dict(src_dict)
        columns = []
        _columns = d.pop("columns")
        for columns_item_data in _columns:
            columns_item = PostQueryResponse200ColumnsItem.from_dict(columns_item_data)

            columns.append(columns_item)

        rows = []
        _rows = d.pop("rows")
        for rows_item_data in _rows:
            rows_item = cast(list[Any], rows_item_data)

            rows.append(rows_item)

        row_count = d.pop("row_count")

        capped = d.pop("capped")

        truncated_cells = []
        _truncated_cells = d.pop("truncated_cells")
        for truncated_cells_item_data in _truncated_cells:
            truncated_cells_item = cast(list[int], truncated_cells_item_data)

            truncated_cells.append(truncated_cells_item)

        duration_ms = d.pop("duration_ms")

        post_query_response_200 = cls(
            columns=columns,
            rows=rows,
            row_count=row_count,
            capped=capped,
            truncated_cells=truncated_cells,
            duration_ms=duration_ms,
        )

        return post_query_response_200
