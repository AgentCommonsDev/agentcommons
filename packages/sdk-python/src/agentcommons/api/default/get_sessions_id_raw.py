from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_sessions_id_raw_response_4xx import GetSessionsIdRawResponse4XX
from ...models.get_sessions_id_raw_response_5xx import GetSessionsIdRawResponse5XX
from ...models.get_sessions_id_raw_response_200 import GetSessionsIdRawResponse200
from ...runtime import check_response, serialize_query
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: UUID,
    *,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    json_cursor: None | str | Unset
    if isinstance(cursor, Unset):
        json_cursor = UNSET
    else:
        json_cursor = cursor
    params["cursor"] = json_cursor

    params = serialize_query(
        {k: v for k, v in params.items() if v is not UNSET and v is not None}
    )

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/sessions/{id}/raw".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetSessionsIdRawResponse200
    | GetSessionsIdRawResponse4XX
    | GetSessionsIdRawResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = GetSessionsIdRawResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = GetSessionsIdRawResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = GetSessionsIdRawResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetSessionsIdRawResponse200
    | GetSessionsIdRawResponse4XX
    | GetSessionsIdRawResponse5XX
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
) -> Response[
    GetSessionsIdRawResponse200
    | GetSessionsIdRawResponse4XX
    | GetSessionsIdRawResponse5XX
]:
    """Read redacted source records

    Args:
        id (UUID):
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSessionsIdRawResponse200 | GetSessionsIdRawResponse4XX | GetSessionsIdRawResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
        limit=limit,
        cursor=cursor,
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
) -> (
    GetSessionsIdRawResponse200
    | GetSessionsIdRawResponse4XX
    | GetSessionsIdRawResponse5XX
    | None
):
    """Read redacted source records

    Args:
        id (UUID):
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSessionsIdRawResponse200 | GetSessionsIdRawResponse4XX | GetSessionsIdRawResponse5XX
    """

    return sync_detailed(
        id=id,
        client=client,
        limit=limit,
        cursor=cursor,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
) -> Response[
    GetSessionsIdRawResponse200
    | GetSessionsIdRawResponse4XX
    | GetSessionsIdRawResponse5XX
]:
    """Read redacted source records

    Args:
        id (UUID):
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSessionsIdRawResponse200 | GetSessionsIdRawResponse4XX | GetSessionsIdRawResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
        limit=limit,
        cursor=cursor,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
) -> (
    GetSessionsIdRawResponse200
    | GetSessionsIdRawResponse4XX
    | GetSessionsIdRawResponse5XX
    | None
):
    """Read redacted source records

    Args:
        id (UUID):
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSessionsIdRawResponse200 | GetSessionsIdRawResponse4XX | GetSessionsIdRawResponse5XX
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            limit=limit,
            cursor=cursor,
        )
    ).parsed
