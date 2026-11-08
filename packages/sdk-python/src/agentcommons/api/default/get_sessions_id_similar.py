from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_sessions_id_similar_response_4xx import (
    GetSessionsIdSimilarResponse4XX,
)
from ...models.get_sessions_id_similar_response_5xx import (
    GetSessionsIdSimilarResponse5XX,
)
from ...models.get_sessions_id_similar_response_200 import (
    GetSessionsIdSimilarResponse200,
)
from ...runtime import check_response, serialize_query
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: UUID,
    *,
    max_rows: int | Unset = 5,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["max_rows"] = max_rows

    params = serialize_query(
        {k: v for k, v in params.items() if v is not UNSET and v is not None}
    )

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/sessions/{id}/similar".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetSessionsIdSimilarResponse200
    | GetSessionsIdSimilarResponse4XX
    | GetSessionsIdSimilarResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = GetSessionsIdSimilarResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = GetSessionsIdSimilarResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = GetSessionsIdSimilarResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetSessionsIdSimilarResponse200
    | GetSessionsIdSimilarResponse4XX
    | GetSessionsIdSimilarResponse5XX
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
    max_rows: int | Unset = 5,
) -> Response[
    GetSessionsIdSimilarResponse200
    | GetSessionsIdSimilarResponse4XX
    | GetSessionsIdSimilarResponse5XX
]:
    """Find similar visible sessions

    Args:
        id (UUID):
        max_rows (int | Unset):  Default: 5.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSessionsIdSimilarResponse200 | GetSessionsIdSimilarResponse4XX | GetSessionsIdSimilarResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
        max_rows=max_rows,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient,
    max_rows: int | Unset = 5,
) -> (
    GetSessionsIdSimilarResponse200
    | GetSessionsIdSimilarResponse4XX
    | GetSessionsIdSimilarResponse5XX
    | None
):
    """Find similar visible sessions

    Args:
        id (UUID):
        max_rows (int | Unset):  Default: 5.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSessionsIdSimilarResponse200 | GetSessionsIdSimilarResponse4XX | GetSessionsIdSimilarResponse5XX
    """

    return sync_detailed(
        id=id,
        client=client,
        max_rows=max_rows,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
    max_rows: int | Unset = 5,
) -> Response[
    GetSessionsIdSimilarResponse200
    | GetSessionsIdSimilarResponse4XX
    | GetSessionsIdSimilarResponse5XX
]:
    """Find similar visible sessions

    Args:
        id (UUID):
        max_rows (int | Unset):  Default: 5.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSessionsIdSimilarResponse200 | GetSessionsIdSimilarResponse4XX | GetSessionsIdSimilarResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
        max_rows=max_rows,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient,
    max_rows: int | Unset = 5,
) -> (
    GetSessionsIdSimilarResponse200
    | GetSessionsIdSimilarResponse4XX
    | GetSessionsIdSimilarResponse5XX
    | None
):
    """Find similar visible sessions

    Args:
        id (UUID):
        max_rows (int | Unset):  Default: 5.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSessionsIdSimilarResponse200 | GetSessionsIdSimilarResponse4XX | GetSessionsIdSimilarResponse5XX
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            max_rows=max_rows,
        )
    ).parsed
