from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_admin_redaction_policies_body_type_0 import (
    PostAdminRedactionPoliciesBodyType0,
)
from ...models.post_admin_redaction_policies_body_type_1 import (
    PostAdminRedactionPoliciesBodyType1,
)
from ...models.post_admin_redaction_policies_response_4xx import (
    PostAdminRedactionPoliciesResponse4XX,
)
from ...models.post_admin_redaction_policies_response_5xx import (
    PostAdminRedactionPoliciesResponse5XX,
)
from ...models.post_admin_redaction_policies_response_200 import (
    PostAdminRedactionPoliciesResponse200,
)
from ...runtime import check_response
from ...types import Response


def _get_kwargs(
    *,
    body: PostAdminRedactionPoliciesBodyType0 | PostAdminRedactionPoliciesBodyType1,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/admin/redaction/policies",
    }

    if isinstance(body, PostAdminRedactionPoliciesBodyType0):
        _kwargs["json"] = body.to_dict()
    else:
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostAdminRedactionPoliciesResponse200
    | PostAdminRedactionPoliciesResponse4XX
    | PostAdminRedactionPoliciesResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = PostAdminRedactionPoliciesResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = PostAdminRedactionPoliciesResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = PostAdminRedactionPoliciesResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostAdminRedactionPoliciesResponse200
    | PostAdminRedactionPoliciesResponse4XX
    | PostAdminRedactionPoliciesResponse5XX
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
    body: PostAdminRedactionPoliciesBodyType0 | PostAdminRedactionPoliciesBodyType1,
) -> Response[
    PostAdminRedactionPoliciesResponse200
    | PostAdminRedactionPoliciesResponse4XX
    | PostAdminRedactionPoliciesResponse5XX
]:
    """Create a redaction policy

    Args:
        body (PostAdminRedactionPoliciesBodyType0 | PostAdminRedactionPoliciesBodyType1):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAdminRedactionPoliciesResponse200 | PostAdminRedactionPoliciesResponse4XX | PostAdminRedactionPoliciesResponse5XX]
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
    body: PostAdminRedactionPoliciesBodyType0 | PostAdminRedactionPoliciesBodyType1,
) -> (
    PostAdminRedactionPoliciesResponse200
    | PostAdminRedactionPoliciesResponse4XX
    | PostAdminRedactionPoliciesResponse5XX
    | None
):
    """Create a redaction policy

    Args:
        body (PostAdminRedactionPoliciesBodyType0 | PostAdminRedactionPoliciesBodyType1):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAdminRedactionPoliciesResponse200 | PostAdminRedactionPoliciesResponse4XX | PostAdminRedactionPoliciesResponse5XX
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostAdminRedactionPoliciesBodyType0 | PostAdminRedactionPoliciesBodyType1,
) -> Response[
    PostAdminRedactionPoliciesResponse200
    | PostAdminRedactionPoliciesResponse4XX
    | PostAdminRedactionPoliciesResponse5XX
]:
    """Create a redaction policy

    Args:
        body (PostAdminRedactionPoliciesBodyType0 | PostAdminRedactionPoliciesBodyType1):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostAdminRedactionPoliciesResponse200 | PostAdminRedactionPoliciesResponse4XX | PostAdminRedactionPoliciesResponse5XX]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostAdminRedactionPoliciesBodyType0 | PostAdminRedactionPoliciesBodyType1,
) -> (
    PostAdminRedactionPoliciesResponse200
    | PostAdminRedactionPoliciesResponse4XX
    | PostAdminRedactionPoliciesResponse5XX
    | None
):
    """Create a redaction policy

    Args:
        body (PostAdminRedactionPoliciesBodyType0 | PostAdminRedactionPoliciesBodyType1):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostAdminRedactionPoliciesResponse200 | PostAdminRedactionPoliciesResponse4XX | PostAdminRedactionPoliciesResponse5XX
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
