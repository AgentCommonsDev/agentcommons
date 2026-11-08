from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_admin_redaction_rescan_body import PostAdminRedactionRescanBody
from ...models.post_admin_redaction_rescan_response_4xx import (
    PostAdminRedactionRescanResponse4XX,
)
from ...models.post_admin_redaction_rescan_response_5xx import (
    PostAdminRedactionRescanResponse5XX,
)
from ...models.post_admin_redaction_rescan_response_200 import (
    PostAdminRedactionRescanResponse200,
)
from ...runtime import check_response
from ...types import Response


def _get_kwargs(
    *,
    body: PostAdminRedactionRescanBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/admin/redaction/rescan",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostAdminRedactionRescanResponse200
    | PostAdminRedactionRescanResponse4XX
    | PostAdminRedactionRescanResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = PostAdminRedactionRescanResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = PostAdminRedactionRescanResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = PostAdminRedactionRescanResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostAdminRedactionRescanResponse200
    | PostAdminRedactionRescanResponse4XX
    | PostAdminRedactionRescanResponse5XX
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: PostAdminRedactionRescanBody,
) -> Response[
    PostAdminRedactionRescanResponse200
    | PostAdminRedactionRescanResponse4XX
    | PostAdminRedactionRescanResponse5XX
]:
    """Rescan existing organization records

    Args:
        body (PostAdminRedactionRescanBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAdminRedactionRescanResponse200 | PostAdminRedactionRescanResponse4XX | PostAdminRedactionRescanResponse5XX]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: PostAdminRedactionRescanBody,
) -> (
    PostAdminRedactionRescanResponse200
    | PostAdminRedactionRescanResponse4XX
    | PostAdminRedactionRescanResponse5XX
    | None
):
    """Rescan existing organization records

    Args:
        body (PostAdminRedactionRescanBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAdminRedactionRescanResponse200 | PostAdminRedactionRescanResponse4XX | PostAdminRedactionRescanResponse5XX
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostAdminRedactionRescanBody,
) -> Response[
    PostAdminRedactionRescanResponse200
    | PostAdminRedactionRescanResponse4XX
    | PostAdminRedactionRescanResponse5XX
]:
    """Rescan existing organization records

    Args:
        body (PostAdminRedactionRescanBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAdminRedactionRescanResponse200 | PostAdminRedactionRescanResponse4XX | PostAdminRedactionRescanResponse5XX]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostAdminRedactionRescanBody,
) -> (
    PostAdminRedactionRescanResponse200
    | PostAdminRedactionRescanResponse4XX
    | PostAdminRedactionRescanResponse5XX
    | None
):
    """Rescan existing organization records

    Args:
        body (PostAdminRedactionRescanBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAdminRedactionRescanResponse200 | PostAdminRedactionRescanResponse4XX | PostAdminRedactionRescanResponse5XX
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
