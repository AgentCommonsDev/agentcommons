from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_admin_sessions_id_purge_body import PostAdminSessionsIdPurgeBody
from ...models.post_admin_sessions_id_purge_response_4xx import (
    PostAdminSessionsIdPurgeResponse4XX,
)
from ...models.post_admin_sessions_id_purge_response_5xx import (
    PostAdminSessionsIdPurgeResponse5XX,
)
from ...models.post_admin_sessions_id_purge_response_200 import (
    PostAdminSessionsIdPurgeResponse200,
)
from ...runtime import check_response
from ...types import Response


def _get_kwargs(
    id: UUID,
    *,
    body: PostAdminSessionsIdPurgeBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/admin/sessions/{id}/purge".format(
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
    PostAdminSessionsIdPurgeResponse200
    | PostAdminSessionsIdPurgeResponse4XX
    | PostAdminSessionsIdPurgeResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = PostAdminSessionsIdPurgeResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = PostAdminSessionsIdPurgeResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = PostAdminSessionsIdPurgeResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostAdminSessionsIdPurgeResponse200
    | PostAdminSessionsIdPurgeResponse4XX
    | PostAdminSessionsIdPurgeResponse5XX
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
    body: PostAdminSessionsIdPurgeBody,
) -> Response[
    PostAdminSessionsIdPurgeResponse200
    | PostAdminSessionsIdPurgeResponse4XX
    | PostAdminSessionsIdPurgeResponse5XX
]:
    """Purge session contents

    Args:
        id (UUID):
        body (PostAdminSessionsIdPurgeBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAdminSessionsIdPurgeResponse200 | PostAdminSessionsIdPurgeResponse4XX | PostAdminSessionsIdPurgeResponse5XX]
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
    body: PostAdminSessionsIdPurgeBody,
) -> (
    PostAdminSessionsIdPurgeResponse200
    | PostAdminSessionsIdPurgeResponse4XX
    | PostAdminSessionsIdPurgeResponse5XX
    | None
):
    """Purge session contents

    Args:
        id (UUID):
        body (PostAdminSessionsIdPurgeBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAdminSessionsIdPurgeResponse200 | PostAdminSessionsIdPurgeResponse4XX | PostAdminSessionsIdPurgeResponse5XX
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
    body: PostAdminSessionsIdPurgeBody,
) -> Response[
    PostAdminSessionsIdPurgeResponse200
    | PostAdminSessionsIdPurgeResponse4XX
    | PostAdminSessionsIdPurgeResponse5XX
]:
    """Purge session contents

    Args:
        id (UUID):
        body (PostAdminSessionsIdPurgeBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAdminSessionsIdPurgeResponse200 | PostAdminSessionsIdPurgeResponse4XX | PostAdminSessionsIdPurgeResponse5XX]
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
    body: PostAdminSessionsIdPurgeBody,
) -> (
    PostAdminSessionsIdPurgeResponse200
    | PostAdminSessionsIdPurgeResponse4XX
    | PostAdminSessionsIdPurgeResponse5XX
    | None
):
    """Purge session contents

    Args:
        id (UUID):
        body (PostAdminSessionsIdPurgeBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAdminSessionsIdPurgeResponse200 | PostAdminSessionsIdPurgeResponse4XX | PostAdminSessionsIdPurgeResponse5XX
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
