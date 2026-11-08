from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_admin_audit_filters import GetAdminAuditFilters
from ...models.get_admin_audit_format import (
    GetAdminAuditFormat,
)
from ...models.get_admin_audit_order import (
    GetAdminAuditOrder,
)
from ...models.get_admin_audit_response_4xx import GetAdminAuditResponse4XX
from ...models.get_admin_audit_response_5xx import GetAdminAuditResponse5XX
from ...models.get_admin_audit_response_200 import GetAdminAuditResponse200
from ...models.get_admin_audit_sort import GetAdminAuditSort
from ...runtime import check_response, serialize_query
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetAdminAuditSort | Unset = UNSET,
    order: GetAdminAuditOrder | Unset = "desc",
    format_: GetAdminAuditFormat | Unset = "json",
    filters: GetAdminAuditFilters | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    json_cursor: None | str | Unset
    if isinstance(cursor, Unset):
        json_cursor = UNSET
    else:
        json_cursor = cursor
    params["cursor"] = json_cursor

    json_sort: str | Unset = UNSET
    if not isinstance(sort, Unset):
        json_sort = sort

    params["sort"] = json_sort

    json_order: str | Unset = UNSET
    if not isinstance(order, Unset):
        json_order = order

    params["order"] = json_order

    json_format_: str | Unset = UNSET
    if not isinstance(format_, Unset):
        json_format_ = format_

    params["format"] = json_format_

    json_filters: dict[str, Any] | Unset = UNSET
    if not isinstance(filters, Unset):
        json_filters = filters.to_dict()
    params["filters"] = json_filters

    params = serialize_query(
        {k: v for k, v in params.items() if v is not UNSET and v is not None}
    )

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/admin/audit",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetAdminAuditResponse200
    | GetAdminAuditResponse4XX
    | GetAdminAuditResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = GetAdminAuditResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = GetAdminAuditResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = GetAdminAuditResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetAdminAuditResponse200 | GetAdminAuditResponse4XX | GetAdminAuditResponse5XX
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
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetAdminAuditSort | Unset = UNSET,
    order: GetAdminAuditOrder | Unset = "desc",
    format_: GetAdminAuditFormat | Unset = "json",
    filters: GetAdminAuditFilters | Unset = UNSET,
) -> Response[
    GetAdminAuditResponse200 | GetAdminAuditResponse4XX | GetAdminAuditResponse5XX
]:
    """List organization audit events

    Args:
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetAdminAuditSort | Unset):
        order (GetAdminAuditOrder | Unset):  Default: 'desc'.
        format_ (GetAdminAuditFormat | Unset):  Default: 'json'.
        filters (GetAdminAuditFilters | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAdminAuditResponse200 | GetAdminAuditResponse4XX | GetAdminAuditResponse5XX]
    """

    kwargs = _get_kwargs(
        limit=limit,
        cursor=cursor,
        sort=sort,
        order=order,
        format_=format_,
        filters=filters,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetAdminAuditSort | Unset = UNSET,
    order: GetAdminAuditOrder | Unset = "desc",
    format_: GetAdminAuditFormat | Unset = "json",
    filters: GetAdminAuditFilters | Unset = UNSET,
) -> (
    GetAdminAuditResponse200
    | GetAdminAuditResponse4XX
    | GetAdminAuditResponse5XX
    | None
):
    """List organization audit events

    Args:
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetAdminAuditSort | Unset):
        order (GetAdminAuditOrder | Unset):  Default: 'desc'.
        format_ (GetAdminAuditFormat | Unset):  Default: 'json'.
        filters (GetAdminAuditFilters | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAdminAuditResponse200 | GetAdminAuditResponse4XX | GetAdminAuditResponse5XX
    """

    return sync_detailed(
        client=client,
        limit=limit,
        cursor=cursor,
        sort=sort,
        order=order,
        format_=format_,
        filters=filters,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetAdminAuditSort | Unset = UNSET,
    order: GetAdminAuditOrder | Unset = "desc",
    format_: GetAdminAuditFormat | Unset = "json",
    filters: GetAdminAuditFilters | Unset = UNSET,
) -> Response[
    GetAdminAuditResponse200 | GetAdminAuditResponse4XX | GetAdminAuditResponse5XX
]:
    """List organization audit events

    Args:
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetAdminAuditSort | Unset):
        order (GetAdminAuditOrder | Unset):  Default: 'desc'.
        format_ (GetAdminAuditFormat | Unset):  Default: 'json'.
        filters (GetAdminAuditFilters | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAdminAuditResponse200 | GetAdminAuditResponse4XX | GetAdminAuditResponse5XX]
    """

    kwargs = _get_kwargs(
        limit=limit,
        cursor=cursor,
        sort=sort,
        order=order,
        format_=format_,
        filters=filters,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetAdminAuditSort | Unset = UNSET,
    order: GetAdminAuditOrder | Unset = "desc",
    format_: GetAdminAuditFormat | Unset = "json",
    filters: GetAdminAuditFilters | Unset = UNSET,
) -> (
    GetAdminAuditResponse200
    | GetAdminAuditResponse4XX
    | GetAdminAuditResponse5XX
    | None
):
    """List organization audit events

    Args:
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetAdminAuditSort | Unset):
        order (GetAdminAuditOrder | Unset):  Default: 'desc'.
        format_ (GetAdminAuditFormat | Unset):  Default: 'json'.
        filters (GetAdminAuditFilters | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAdminAuditResponse200 | GetAdminAuditResponse4XX | GetAdminAuditResponse5XX
    """

    return (
        await asyncio_detailed(
            client=client,
            limit=limit,
            cursor=cursor,
            sort=sort,
            order=order,
            format_=format_,
            filters=filters,
        )
    ).parsed
