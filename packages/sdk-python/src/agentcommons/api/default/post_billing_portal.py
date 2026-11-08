from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_billing_portal_body import PostBillingPortalBody
from ...models.post_billing_portal_response_4xx import PostBillingPortalResponse4XX
from ...models.post_billing_portal_response_5xx import PostBillingPortalResponse5XX
from ...models.post_billing_portal_response_200 import PostBillingPortalResponse200
from ...runtime import check_response
from ...types import Response


def _get_kwargs(
    *,
    body: PostBillingPortalBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/billing/portal",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostBillingPortalResponse200
    | PostBillingPortalResponse4XX
    | PostBillingPortalResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = PostBillingPortalResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = PostBillingPortalResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = PostBillingPortalResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostBillingPortalResponse200
    | PostBillingPortalResponse4XX
    | PostBillingPortalResponse5XX
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
    body: PostBillingPortalBody,
) -> Response[
    PostBillingPortalResponse200
    | PostBillingPortalResponse4XX
    | PostBillingPortalResponse5XX
]:
    """Open the current organization's billing portal

    Args:
        body (PostBillingPortalBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostBillingPortalResponse200 | PostBillingPortalResponse4XX | PostBillingPortalResponse5XX]
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
    body: PostBillingPortalBody,
) -> (
    PostBillingPortalResponse200
    | PostBillingPortalResponse4XX
    | PostBillingPortalResponse5XX
    | None
):
    """Open the current organization's billing portal

    Args:
        body (PostBillingPortalBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostBillingPortalResponse200 | PostBillingPortalResponse4XX | PostBillingPortalResponse5XX
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostBillingPortalBody,
) -> Response[
    PostBillingPortalResponse200
    | PostBillingPortalResponse4XX
    | PostBillingPortalResponse5XX
]:
    """Open the current organization's billing portal

    Args:
        body (PostBillingPortalBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostBillingPortalResponse200 | PostBillingPortalResponse4XX | PostBillingPortalResponse5XX]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostBillingPortalBody,
) -> (
    PostBillingPortalResponse200
    | PostBillingPortalResponse4XX
    | PostBillingPortalResponse5XX
    | None
):
    """Open the current organization's billing portal

    Args:
        body (PostBillingPortalBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostBillingPortalResponse200 | PostBillingPortalResponse4XX | PostBillingPortalResponse5XX
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
