from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_sessions_id_reuse_direction import (
    GetSessionsIdReuseDirection,
)
from ...models.get_sessions_id_reuse_format import (
    GetSessionsIdReuseFormat,
)
from ...models.get_sessions_id_reuse_order import (
    GetSessionsIdReuseOrder,
)
from ...models.get_sessions_id_reuse_response_4xx import GetSessionsIdReuseResponse4XX
from ...models.get_sessions_id_reuse_response_5xx import GetSessionsIdReuseResponse5XX
from ...models.get_sessions_id_reuse_response_200 import GetSessionsIdReuseResponse200
from ...models.get_sessions_id_reuse_sort import (
    GetSessionsIdReuseSort,
)
from ...runtime import check_response, serialize_query
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: UUID,
    *,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetSessionsIdReuseSort | Unset = UNSET,
    order: GetSessionsIdReuseOrder | Unset = "desc",
    format_: GetSessionsIdReuseFormat | Unset = "json",
    reader_user_id: str | Unset = UNSET,
    direction: GetSessionsIdReuseDirection | Unset = "by",
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    json_cursor: None | str | Unset
    if isinstance(cursor, Unset):
        json_cursor = UNSET
    else:
        json_cursor = cursor
    params["cursor"] = json_cursor

    json_sort: str | Unset = UNSET
    if not isinstance(sort, Unset):
        json_sort = sort

    params["sort"] = json_sort

    json_order: str | Unset = UNSET
    if not isinstance(order, Unset):
        json_order = order

    params["order"] = json_order

    json_format_: str | Unset = UNSET
    if not isinstance(format_, Unset):
        json_format_ = format_

    params["format"] = json_format_

    params["reader_user_id"] = reader_user_id

    json_direction: str | Unset = UNSET
    if not isinstance(direction, Unset):
        json_direction = direction

    params["direction"] = json_direction

    params = serialize_query(
        {k: v for k, v in params.items() if v is not UNSET and v is not None}
    )

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/sessions/{id}/reuse".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetSessionsIdReuseResponse200
    | GetSessionsIdReuseResponse4XX
    | GetSessionsIdReuseResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = GetSessionsIdReuseResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = GetSessionsIdReuseResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = GetSessionsIdReuseResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetSessionsIdReuseResponse200
    | GetSessionsIdReuseResponse4XX
    | GetSessionsIdReuseResponse5XX
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetSessionsIdReuseSort | Unset = UNSET,
    order: GetSessionsIdReuseOrder | Unset = "desc",
    format_: GetSessionsIdReuseFormat | Unset = "json",
    reader_user_id: str | Unset = UNSET,
    direction: GetSessionsIdReuseDirection | Unset = "by",
) -> Response[
    GetSessionsIdReuseResponse200
    | GetSessionsIdReuseResponse4XX
    | GetSessionsIdReuseResponse5XX
]:
    """List sessions that reused or were reused by this session

    Args:
        id (UUID):
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetSessionsIdReuseSort | Unset):
        order (GetSessionsIdReuseOrder | Unset):  Default: 'desc'.
        format_ (GetSessionsIdReuseFormat | Unset):  Default: 'json'.
        reader_user_id (str | Unset):
        direction (GetSessionsIdReuseDirection | Unset):  Default: 'by'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSessionsIdReuseResponse200 | GetSessionsIdReuseResponse4XX | GetSessionsIdReuseResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
        limit=limit,
        cursor=cursor,
        sort=sort,
        order=order,
        format_=format_,
        reader_user_id=reader_user_id,
        direction=direction,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetSessionsIdReuseSort | Unset = UNSET,
    order: GetSessionsIdReuseOrder | Unset = "desc",
    format_: GetSessionsIdReuseFormat | Unset = "json",
    reader_user_id: str | Unset = UNSET,
    direction: GetSessionsIdReuseDirection | Unset = "by",
) -> (
    GetSessionsIdReuseResponse200
    | GetSessionsIdReuseResponse4XX
    | GetSessionsIdReuseResponse5XX
    | None
):
    """List sessions that reused or were reused by this session

    Args:
        id (UUID):
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetSessionsIdReuseSort | Unset):
        order (GetSessionsIdReuseOrder | Unset):  Default: 'desc'.
        format_ (GetSessionsIdReuseFormat | Unset):  Default: 'json'.
        reader_user_id (str | Unset):
        direction (GetSessionsIdReuseDirection | Unset):  Default: 'by'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSessionsIdReuseResponse200 | GetSessionsIdReuseResponse4XX | GetSessionsIdReuseResponse5XX
    """

    return sync_detailed(
        id=id,
        client=client,
        limit=limit,
        cursor=cursor,
        sort=sort,
        order=order,
        format_=format_,
        reader_user_id=reader_user_id,
        direction=direction,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetSessionsIdReuseSort | Unset = UNSET,
    order: GetSessionsIdReuseOrder | Unset = "desc",
    format_: GetSessionsIdReuseFormat | Unset = "json",
    reader_user_id: str | Unset = UNSET,
    direction: GetSessionsIdReuseDirection | Unset = "by",
) -> Response[
    GetSessionsIdReuseResponse200
    | GetSessionsIdReuseResponse4XX
    | GetSessionsIdReuseResponse5XX
]:
    """List sessions that reused or were reused by this session

    Args:
        id (UUID):
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetSessionsIdReuseSort | Unset):
        order (GetSessionsIdReuseOrder | Unset):  Default: 'desc'.
        format_ (GetSessionsIdReuseFormat | Unset):  Default: 'json'.
        reader_user_id (str | Unset):
        direction (GetSessionsIdReuseDirection | Unset):  Default: 'by'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSessionsIdReuseResponse200 | GetSessionsIdReuseResponse4XX | GetSessionsIdReuseResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
        limit=limit,
        cursor=cursor,
        sort=sort,
        order=order,
        format_=format_,
        reader_user_id=reader_user_id,
        direction=direction,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetSessionsIdReuseSort | Unset = UNSET,
    order: GetSessionsIdReuseOrder | Unset = "desc",
    format_: GetSessionsIdReuseFormat | Unset = "json",
    reader_user_id: str | Unset = UNSET,
    direction: GetSessionsIdReuseDirection | Unset = "by",
) -> (
    GetSessionsIdReuseResponse200
    | GetSessionsIdReuseResponse4XX
    | GetSessionsIdReuseResponse5XX
    | None
):
    """List sessions that reused or were reused by this session

    Args:
        id (UUID):
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetSessionsIdReuseSort | Unset):
        order (GetSessionsIdReuseOrder | Unset):  Default: 'desc'.
        format_ (GetSessionsIdReuseFormat | Unset):  Default: 'json'.
        reader_user_id (str | Unset):
        direction (GetSessionsIdReuseDirection | Unset):  Default: 'by'.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSessionsIdReuseResponse200 | GetSessionsIdReuseResponse4XX | GetSessionsIdReuseResponse5XX
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            limit=limit,
            cursor=cursor,
            sort=sort,
            order=order,
            format_=format_,
            reader_user_id=reader_user_id,
            direction=direction,
        )
    ).parsed
