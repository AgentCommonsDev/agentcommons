from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_admin_users_id_response_4xx import GetAdminUsersIdResponse4XX
from ...models.get_admin_users_id_response_5xx import GetAdminUsersIdResponse5XX
from ...models.get_admin_users_id_response_200 import GetAdminUsersIdResponse200
from ...runtime import check_response
from ...types import Response


def _get_kwargs(
    id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/admin/users/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetAdminUsersIdResponse200
    | GetAdminUsersIdResponse4XX
    | GetAdminUsersIdResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = GetAdminUsersIdResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = GetAdminUsersIdResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = GetAdminUsersIdResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetAdminUsersIdResponse200 | GetAdminUsersIdResponse4XX | GetAdminUsersIdResponse5XX
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetAdminUsersIdResponse200 | GetAdminUsersIdResponse4XX | GetAdminUsersIdResponse5XX
]:
    """Read one organization member

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAdminUsersIdResponse200 | GetAdminUsersIdResponse4XX | GetAdminUsersIdResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetAdminUsersIdResponse200
    | GetAdminUsersIdResponse4XX
    | GetAdminUsersIdResponse5XX
    | None
):
    """Read one organization member

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAdminUsersIdResponse200 | GetAdminUsersIdResponse4XX | GetAdminUsersIdResponse5XX
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
) -> Response[
    GetAdminUsersIdResponse200 | GetAdminUsersIdResponse4XX | GetAdminUsersIdResponse5XX
]:
    """Read one organization member

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAdminUsersIdResponse200 | GetAdminUsersIdResponse4XX | GetAdminUsersIdResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
) -> (
    GetAdminUsersIdResponse200
    | GetAdminUsersIdResponse4XX
    | GetAdminUsersIdResponse5XX
    | None
):
    """Read one organization member

    Args:
        id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAdminUsersIdResponse200 | GetAdminUsersIdResponse4XX | GetAdminUsersIdResponse5XX
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
