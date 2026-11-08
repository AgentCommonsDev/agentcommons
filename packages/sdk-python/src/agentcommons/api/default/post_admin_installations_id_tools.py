from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_admin_installations_id_tools_body import (
    PostAdminInstallationsIdToolsBody,
)
from ...models.post_admin_installations_id_tools_response_4xx import (
    PostAdminInstallationsIdToolsResponse4XX,
)
from ...models.post_admin_installations_id_tools_response_5xx import (
    PostAdminInstallationsIdToolsResponse5XX,
)
from ...models.post_admin_installations_id_tools_response_200 import (
    PostAdminInstallationsIdToolsResponse200,
)
from ...runtime import check_response
from ...types import Response


def _get_kwargs(
    id: UUID,
    *,
    body: PostAdminInstallationsIdToolsBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/admin/installations/{id}/tools".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostAdminInstallationsIdToolsResponse200
    | PostAdminInstallationsIdToolsResponse4XX
    | PostAdminInstallationsIdToolsResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = PostAdminInstallationsIdToolsResponse200.from_dict(
            response.json()
        )

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = PostAdminInstallationsIdToolsResponse4XX.from_dict(
            response.json()
        )

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = PostAdminInstallationsIdToolsResponse5XX.from_dict(
            response.json()
        )

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostAdminInstallationsIdToolsResponse200
    | PostAdminInstallationsIdToolsResponse4XX
    | PostAdminInstallationsIdToolsResponse5XX
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
    body: PostAdminInstallationsIdToolsBody,
) -> Response[
    PostAdminInstallationsIdToolsResponse200
    | PostAdminInstallationsIdToolsResponse4XX
    | PostAdminInstallationsIdToolsResponse5XX
]:
    """Enable or disable installation MCP tools

    Args:
        id (UUID):
        body (PostAdminInstallationsIdToolsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAdminInstallationsIdToolsResponse200 | PostAdminInstallationsIdToolsResponse4XX | PostAdminInstallationsIdToolsResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostAdminInstallationsIdToolsBody,
) -> (
    PostAdminInstallationsIdToolsResponse200
    | PostAdminInstallationsIdToolsResponse4XX
    | PostAdminInstallationsIdToolsResponse5XX
    | None
):
    """Enable or disable installation MCP tools

    Args:
        id (UUID):
        body (PostAdminInstallationsIdToolsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAdminInstallationsIdToolsResponse200 | PostAdminInstallationsIdToolsResponse4XX | PostAdminInstallationsIdToolsResponse5XX
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostAdminInstallationsIdToolsBody,
) -> Response[
    PostAdminInstallationsIdToolsResponse200
    | PostAdminInstallationsIdToolsResponse4XX
    | PostAdminInstallationsIdToolsResponse5XX
]:
    """Enable or disable installation MCP tools

    Args:
        id (UUID):
        body (PostAdminInstallationsIdToolsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAdminInstallationsIdToolsResponse200 | PostAdminInstallationsIdToolsResponse4XX | PostAdminInstallationsIdToolsResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostAdminInstallationsIdToolsBody,
) -> (
    PostAdminInstallationsIdToolsResponse200
    | PostAdminInstallationsIdToolsResponse4XX
    | PostAdminInstallationsIdToolsResponse5XX
    | None
):
    """Enable or disable installation MCP tools

    Args:
        id (UUID):
        body (PostAdminInstallationsIdToolsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAdminInstallationsIdToolsResponse200 | PostAdminInstallationsIdToolsResponse4XX | PostAdminInstallationsIdToolsResponse5XX
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
