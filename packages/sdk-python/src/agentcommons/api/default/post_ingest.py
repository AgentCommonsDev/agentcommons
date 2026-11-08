from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_ingest_body import PostIngestBody
from ...models.post_ingest_response_4xx import PostIngestResponse4XX
from ...models.post_ingest_response_5xx import PostIngestResponse5XX
from ...models.post_ingest_response_202 import PostIngestResponse202
from ...runtime import check_response
from ...types import Response


def _get_kwargs(
    *,
    body: PostIngestBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/ingest",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostIngestResponse202 | PostIngestResponse4XX | PostIngestResponse5XX | None:
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 202:
        response_202 = PostIngestResponse202.from_dict(response.json())

        return response_202

    if 400 <= response.status_code <= 499:
        response_4xx = PostIngestResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = PostIngestResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostIngestResponse202 | PostIngestResponse4XX | PostIngestResponse5XX]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: PostIngestBody,
) -> Response[PostIngestResponse202 | PostIngestResponse4XX | PostIngestResponse5XX]:
    """Upload session records

    Args:
        body (PostIngestBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostIngestResponse202 | PostIngestResponse4XX | PostIngestResponse5XX]
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
    body: PostIngestBody,
) -> PostIngestResponse202 | PostIngestResponse4XX | PostIngestResponse5XX | None:
    """Upload session records

    Args:
        body (PostIngestBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostIngestResponse202 | PostIngestResponse4XX | PostIngestResponse5XX
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostIngestBody,
) -> Response[PostIngestResponse202 | PostIngestResponse4XX | PostIngestResponse5XX]:
    """Upload session records

    Args:
        body (PostIngestBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostIngestResponse202 | PostIngestResponse4XX | PostIngestResponse5XX]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostIngestBody,
) -> PostIngestResponse202 | PostIngestResponse4XX | PostIngestResponse5XX | None:
    """Upload session records

    Args:
        body (PostIngestBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostIngestResponse202 | PostIngestResponse4XX | PostIngestResponse5XX
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
