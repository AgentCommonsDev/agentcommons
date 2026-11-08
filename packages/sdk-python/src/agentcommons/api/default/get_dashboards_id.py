from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_dashboards_id_response_4xx import GetDashboardsIdResponse4XX
from ...models.get_dashboards_id_response_5xx import GetDashboardsIdResponse5XX
from ...models.get_dashboards_id_response_200 import GetDashboardsIdResponse200
from ...runtime import check_response
from ...types import Response


def _get_kwargs(
    id: UUID,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/dashboards/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetDashboardsIdResponse200
    | GetDashboardsIdResponse4XX
    | GetDashboardsIdResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = GetDashboardsIdResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = GetDashboardsIdResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = GetDashboardsIdResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetDashboardsIdResponse200 | GetDashboardsIdResponse4XX | GetDashboardsIdResponse5XX
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
) -> Response[
    GetDashboardsIdResponse200 | GetDashboardsIdResponse4XX | GetDashboardsIdResponse5XX
]:
    """Read a dashboard and its definition

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetDashboardsIdResponse200 | GetDashboardsIdResponse4XX | GetDashboardsIdResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient,
) -> (
    GetDashboardsIdResponse200
    | GetDashboardsIdResponse4XX
    | GetDashboardsIdResponse5XX
    | None
):
    """Read a dashboard and its definition

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetDashboardsIdResponse200 | GetDashboardsIdResponse4XX | GetDashboardsIdResponse5XX
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetDashboardsIdResponse200 | GetDashboardsIdResponse4XX | GetDashboardsIdResponse5XX
]:
    """Read a dashboard and its definition

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetDashboardsIdResponse200 | GetDashboardsIdResponse4XX | GetDashboardsIdResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient,
) -> (
    GetDashboardsIdResponse200
    | GetDashboardsIdResponse4XX
    | GetDashboardsIdResponse5XX
    | None
):
    """Read a dashboard and its definition

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetDashboardsIdResponse200 | GetDashboardsIdResponse4XX | GetDashboardsIdResponse5XX
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
