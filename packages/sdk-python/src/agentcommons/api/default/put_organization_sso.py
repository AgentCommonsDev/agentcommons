from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.put_organization_sso_body import PutOrganizationSsoBody
from ...models.put_organization_sso_response_4xx import PutOrganizationSsoResponse4XX
from ...models.put_organization_sso_response_5xx import PutOrganizationSsoResponse5XX
from ...models.put_organization_sso_response_200 import PutOrganizationSsoResponse200
from ...runtime import check_response
from ...types import Response


def _get_kwargs(
    *,
    body: PutOrganizationSsoBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/organization/sso",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PutOrganizationSsoResponse200
    | PutOrganizationSsoResponse4XX
    | PutOrganizationSsoResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = PutOrganizationSsoResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = PutOrganizationSsoResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = PutOrganizationSsoResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PutOrganizationSsoResponse200
    | PutOrganizationSsoResponse4XX
    | PutOrganizationSsoResponse5XX
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
    body: PutOrganizationSsoBody,
) -> Response[
    PutOrganizationSsoResponse200
    | PutOrganizationSsoResponse4XX
    | PutOrganizationSsoResponse5XX
]:
    """Require or stop requiring SSO sign-in for this organization

    Args:
        body (PutOrganizationSsoBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutOrganizationSsoResponse200 | PutOrganizationSsoResponse4XX | PutOrganizationSsoResponse5XX]
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
    body: PutOrganizationSsoBody,
) -> (
    PutOrganizationSsoResponse200
    | PutOrganizationSsoResponse4XX
    | PutOrganizationSsoResponse5XX
    | None
):
    """Require or stop requiring SSO sign-in for this organization

    Args:
        body (PutOrganizationSsoBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutOrganizationSsoResponse200 | PutOrganizationSsoResponse4XX | PutOrganizationSsoResponse5XX
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PutOrganizationSsoBody,
) -> Response[
    PutOrganizationSsoResponse200
    | PutOrganizationSsoResponse4XX
    | PutOrganizationSsoResponse5XX
]:
    """Require or stop requiring SSO sign-in for this organization

    Args:
        body (PutOrganizationSsoBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PutOrganizationSsoResponse200 | PutOrganizationSsoResponse4XX | PutOrganizationSsoResponse5XX]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PutOrganizationSsoBody,
) -> (
    PutOrganizationSsoResponse200
    | PutOrganizationSsoResponse4XX
    | PutOrganizationSsoResponse5XX
    | None
):
    """Require or stop requiring SSO sign-in for this organization

    Args:
        body (PutOrganizationSsoBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PutOrganizationSsoResponse200 | PutOrganizationSsoResponse4XX | PutOrganizationSsoResponse5XX
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
