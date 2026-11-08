from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_admin_users_password_setup_body import (
    PostAdminUsersPasswordSetupBody,
)
from ...models.post_admin_users_password_setup_response_4xx import (
    PostAdminUsersPasswordSetupResponse4XX,
)
from ...models.post_admin_users_password_setup_response_5xx import (
    PostAdminUsersPasswordSetupResponse5XX,
)
from ...models.post_admin_users_password_setup_response_200 import (
    PostAdminUsersPasswordSetupResponse200,
)
from ...runtime import check_response
from ...types import Response


def _get_kwargs(
    *,
    body: PostAdminUsersPasswordSetupBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/admin/users/password-setup",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostAdminUsersPasswordSetupResponse200
    | PostAdminUsersPasswordSetupResponse4XX
    | PostAdminUsersPasswordSetupResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = PostAdminUsersPasswordSetupResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = PostAdminUsersPasswordSetupResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = PostAdminUsersPasswordSetupResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostAdminUsersPasswordSetupResponse200
    | PostAdminUsersPasswordSetupResponse4XX
    | PostAdminUsersPasswordSetupResponse5XX
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
    body: PostAdminUsersPasswordSetupBody,
) -> Response[
    PostAdminUsersPasswordSetupResponse200
    | PostAdminUsersPasswordSetupResponse4XX
    | PostAdminUsersPasswordSetupResponse5XX
]:
    """Issue initial password setup

    Args:
        body (PostAdminUsersPasswordSetupBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAdminUsersPasswordSetupResponse200 | PostAdminUsersPasswordSetupResponse4XX | PostAdminUsersPasswordSetupResponse5XX]
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
    body: PostAdminUsersPasswordSetupBody,
) -> (
    PostAdminUsersPasswordSetupResponse200
    | PostAdminUsersPasswordSetupResponse4XX
    | PostAdminUsersPasswordSetupResponse5XX
    | None
):
    """Issue initial password setup

    Args:
        body (PostAdminUsersPasswordSetupBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAdminUsersPasswordSetupResponse200 | PostAdminUsersPasswordSetupResponse4XX | PostAdminUsersPasswordSetupResponse5XX
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostAdminUsersPasswordSetupBody,
) -> Response[
    PostAdminUsersPasswordSetupResponse200
    | PostAdminUsersPasswordSetupResponse4XX
    | PostAdminUsersPasswordSetupResponse5XX
]:
    """Issue initial password setup

    Args:
        body (PostAdminUsersPasswordSetupBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAdminUsersPasswordSetupResponse200 | PostAdminUsersPasswordSetupResponse4XX | PostAdminUsersPasswordSetupResponse5XX]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostAdminUsersPasswordSetupBody,
) -> (
    PostAdminUsersPasswordSetupResponse200
    | PostAdminUsersPasswordSetupResponse4XX
    | PostAdminUsersPasswordSetupResponse5XX
    | None
):
    """Issue initial password setup

    Args:
        body (PostAdminUsersPasswordSetupBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAdminUsersPasswordSetupResponse200 | PostAdminUsersPasswordSetupResponse4XX | PostAdminUsersPasswordSetupResponse5XX
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
