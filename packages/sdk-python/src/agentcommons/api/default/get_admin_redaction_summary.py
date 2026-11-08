from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_admin_redaction_summary_response_4xx import (
    GetAdminRedactionSummaryResponse4XX,
)
from ...models.get_admin_redaction_summary_response_5xx import (
    GetAdminRedactionSummaryResponse5XX,
)
from ...models.get_admin_redaction_summary_response_200 import (
    GetAdminRedactionSummaryResponse200,
)
from ...runtime import check_response
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/admin/redaction/summary",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetAdminRedactionSummaryResponse200
    | GetAdminRedactionSummaryResponse4XX
    | GetAdminRedactionSummaryResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = GetAdminRedactionSummaryResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = GetAdminRedactionSummaryResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = GetAdminRedactionSummaryResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetAdminRedactionSummaryResponse200
    | GetAdminRedactionSummaryResponse4XX
    | GetAdminRedactionSummaryResponse5XX
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
) -> Response[
    GetAdminRedactionSummaryResponse200
    | GetAdminRedactionSummaryResponse4XX
    | GetAdminRedactionSummaryResponse5XX
]:
    """Read the organization's redaction totals, recent windows, per-policy counts and run tally

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAdminRedactionSummaryResponse200 | GetAdminRedactionSummaryResponse4XX | GetAdminRedactionSummaryResponse5XX]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> (
    GetAdminRedactionSummaryResponse200
    | GetAdminRedactionSummaryResponse4XX
    | GetAdminRedactionSummaryResponse5XX
    | None
):
    """Read the organization's redaction totals, recent windows, per-policy counts and run tally

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAdminRedactionSummaryResponse200 | GetAdminRedactionSummaryResponse4XX | GetAdminRedactionSummaryResponse5XX
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[
    GetAdminRedactionSummaryResponse200
    | GetAdminRedactionSummaryResponse4XX
    | GetAdminRedactionSummaryResponse5XX
]:
    """Read the organization's redaction totals, recent windows, per-policy counts and run tally

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAdminRedactionSummaryResponse200 | GetAdminRedactionSummaryResponse4XX | GetAdminRedactionSummaryResponse5XX]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> (
    GetAdminRedactionSummaryResponse200
    | GetAdminRedactionSummaryResponse4XX
    | GetAdminRedactionSummaryResponse5XX
    | None
):
    """Read the organization's redaction totals, recent windows, per-policy counts and run tally

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAdminRedactionSummaryResponse200 | GetAdminRedactionSummaryResponse4XX | GetAdminRedactionSummaryResponse5XX
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
