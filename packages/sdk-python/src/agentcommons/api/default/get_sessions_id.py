from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_sessions_id_cursor_type_0 import GetSessionsIdCursorType0
from ...models.get_sessions_id_format import (
    GetSessionsIdFormat,
)
from ...models.get_sessions_id_kinds_item import (
    GetSessionsIdKindsItem,
)
from ...models.get_sessions_id_response_4xx import GetSessionsIdResponse4XX
from ...models.get_sessions_id_response_5xx import GetSessionsIdResponse5XX
from ...models.get_sessions_id_response_200 import GetSessionsIdResponse200
from ...runtime import check_response, serialize_query
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: UUID,
    *,
    from_: int | Unset = UNSET,
    to: int | Unset = UNSET,
    cursor: GetSessionsIdCursorType0 | None | Unset = UNSET,
    kinds: list[GetSessionsIdKindsItem] | Unset = UNSET,
    format_: GetSessionsIdFormat | Unset = "json",
    page_bytes: int | Unset = 32768,
    header: bool | Unset = True,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["from"] = from_

    params["to"] = to

    json_cursor: dict[str, Any] | None | Unset
    if isinstance(cursor, Unset):
        json_cursor = UNSET
    elif isinstance(cursor, GetSessionsIdCursorType0):
        json_cursor = cursor.to_dict()
    else:
        json_cursor = cursor
    params["cursor"] = json_cursor

    json_kinds: list[str] | Unset = UNSET
    if not isinstance(kinds, Unset):
        json_kinds = []
        for kinds_item_data in kinds:
            kinds_item: str = kinds_item_data
            json_kinds.append(kinds_item)

    params["kinds"] = json_kinds

    json_format_: str | Unset = UNSET
    if not isinstance(format_, Unset):
        json_format_ = format_

    params["format"] = json_format_

    params["page_bytes"] = page_bytes

    params["header"] = header

    params = serialize_query(
        {k: v for k, v in params.items() if v is not UNSET and v is not None}
    )

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/sessions/{id}".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetSessionsIdResponse200
    | GetSessionsIdResponse4XX
    | GetSessionsIdResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = GetSessionsIdResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = GetSessionsIdResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = GetSessionsIdResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetSessionsIdResponse200 | GetSessionsIdResponse4XX | GetSessionsIdResponse5XX
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
    from_: int | Unset = UNSET,
    to: int | Unset = UNSET,
    cursor: GetSessionsIdCursorType0 | None | Unset = UNSET,
    kinds: list[GetSessionsIdKindsItem] | Unset = UNSET,
    format_: GetSessionsIdFormat | Unset = "json",
    page_bytes: int | Unset = 32768,
    header: bool | Unset = True,
) -> Response[
    GetSessionsIdResponse200 | GetSessionsIdResponse4XX | GetSessionsIdResponse5XX
]:
    """Read a session

    Args:
        id (UUID):
        from_ (int | Unset):
        to (int | Unset):
        cursor (GetSessionsIdCursorType0 | None | Unset):
        kinds (list[GetSessionsIdKindsItem] | Unset):
        format_ (GetSessionsIdFormat | Unset):  Default: 'json'.
        page_bytes (int | Unset):  Default: 32768.
        header (bool | Unset):  Default: True.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSessionsIdResponse200 | GetSessionsIdResponse4XX | GetSessionsIdResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
        from_=from_,
        to=to,
        cursor=cursor,
        kinds=kinds,
        format_=format_,
        page_bytes=page_bytes,
        header=header,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient,
    from_: int | Unset = UNSET,
    to: int | Unset = UNSET,
    cursor: GetSessionsIdCursorType0 | None | Unset = UNSET,
    kinds: list[GetSessionsIdKindsItem] | Unset = UNSET,
    format_: GetSessionsIdFormat | Unset = "json",
    page_bytes: int | Unset = 32768,
    header: bool | Unset = True,
) -> (
    GetSessionsIdResponse200
    | GetSessionsIdResponse4XX
    | GetSessionsIdResponse5XX
    | None
):
    """Read a session

    Args:
        id (UUID):
        from_ (int | Unset):
        to (int | Unset):
        cursor (GetSessionsIdCursorType0 | None | Unset):
        kinds (list[GetSessionsIdKindsItem] | Unset):
        format_ (GetSessionsIdFormat | Unset):  Default: 'json'.
        page_bytes (int | Unset):  Default: 32768.
        header (bool | Unset):  Default: True.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSessionsIdResponse200 | GetSessionsIdResponse4XX | GetSessionsIdResponse5XX
    """

    return sync_detailed(
        id=id,
        client=client,
        from_=from_,
        to=to,
        cursor=cursor,
        kinds=kinds,
        format_=format_,
        page_bytes=page_bytes,
        header=header,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
    from_: int | Unset = UNSET,
    to: int | Unset = UNSET,
    cursor: GetSessionsIdCursorType0 | None | Unset = UNSET,
    kinds: list[GetSessionsIdKindsItem] | Unset = UNSET,
    format_: GetSessionsIdFormat | Unset = "json",
    page_bytes: int | Unset = 32768,
    header: bool | Unset = True,
) -> Response[
    GetSessionsIdResponse200 | GetSessionsIdResponse4XX | GetSessionsIdResponse5XX
]:
    """Read a session

    Args:
        id (UUID):
        from_ (int | Unset):
        to (int | Unset):
        cursor (GetSessionsIdCursorType0 | None | Unset):
        kinds (list[GetSessionsIdKindsItem] | Unset):
        format_ (GetSessionsIdFormat | Unset):  Default: 'json'.
        page_bytes (int | Unset):  Default: 32768.
        header (bool | Unset):  Default: True.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSessionsIdResponse200 | GetSessionsIdResponse4XX | GetSessionsIdResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
        from_=from_,
        to=to,
        cursor=cursor,
        kinds=kinds,
        format_=format_,
        page_bytes=page_bytes,
        header=header,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient,
    from_: int | Unset = UNSET,
    to: int | Unset = UNSET,
    cursor: GetSessionsIdCursorType0 | None | Unset = UNSET,
    kinds: list[GetSessionsIdKindsItem] | Unset = UNSET,
    format_: GetSessionsIdFormat | Unset = "json",
    page_bytes: int | Unset = 32768,
    header: bool | Unset = True,
) -> (
    GetSessionsIdResponse200
    | GetSessionsIdResponse4XX
    | GetSessionsIdResponse5XX
    | None
):
    """Read a session

    Args:
        id (UUID):
        from_ (int | Unset):
        to (int | Unset):
        cursor (GetSessionsIdCursorType0 | None | Unset):
        kinds (list[GetSessionsIdKindsItem] | Unset):
        format_ (GetSessionsIdFormat | Unset):  Default: 'json'.
        page_bytes (int | Unset):  Default: 32768.
        header (bool | Unset):  Default: True.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSessionsIdResponse200 | GetSessionsIdResponse4XX | GetSessionsIdResponse5XX
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            from_=from_,
            to=to,
            cursor=cursor,
            kinds=kinds,
            format_=format_,
            page_bytes=page_bytes,
            header=header,
        )
    ).parsed
