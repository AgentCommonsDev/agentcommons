from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_admin_redaction_rescan_id_sessions_filters import (
    GetAdminRedactionRescanIdSessionsFilters,
)
from ...models.get_admin_redaction_rescan_id_sessions_format import (
    GetAdminRedactionRescanIdSessionsFormat,
)
from ...models.get_admin_redaction_rescan_id_sessions_order import (
    GetAdminRedactionRescanIdSessionsOrder,
)
from ...models.get_admin_redaction_rescan_id_sessions_response_4xx import (
    GetAdminRedactionRescanIdSessionsResponse4XX,
)
from ...models.get_admin_redaction_rescan_id_sessions_response_5xx import (
    GetAdminRedactionRescanIdSessionsResponse5XX,
)
from ...models.get_admin_redaction_rescan_id_sessions_response_200 import (
    GetAdminRedactionRescanIdSessionsResponse200,
)
from ...models.get_admin_redaction_rescan_id_sessions_sort import (
    GetAdminRedactionRescanIdSessionsSort,
)
from ...runtime import check_response, serialize_query
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: str,
    *,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetAdminRedactionRescanIdSessionsSort | Unset = UNSET,
    order: GetAdminRedactionRescanIdSessionsOrder | Unset = "desc",
    format_: GetAdminRedactionRescanIdSessionsFormat | Unset = "json",
    filters: GetAdminRedactionRescanIdSessionsFilters | Unset = UNSET,
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
        "url": "/api/v1/admin/redaction/rescan/{id}/sessions".format(
            id=quote(str(id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetAdminRedactionRescanIdSessionsResponse200
    | GetAdminRedactionRescanIdSessionsResponse4XX
    | GetAdminRedactionRescanIdSessionsResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = GetAdminRedactionRescanIdSessionsResponse200.from_dict(
            response.json()
        )

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = GetAdminRedactionRescanIdSessionsResponse4XX.from_dict(
            response.json()
        )

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = GetAdminRedactionRescanIdSessionsResponse5XX.from_dict(
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
    GetAdminRedactionRescanIdSessionsResponse200
    | GetAdminRedactionRescanIdSessionsResponse4XX
    | GetAdminRedactionRescanIdSessionsResponse5XX
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetAdminRedactionRescanIdSessionsSort | Unset = UNSET,
    order: GetAdminRedactionRescanIdSessionsOrder | Unset = "desc",
    format_: GetAdminRedactionRescanIdSessionsFormat | Unset = "json",
    filters: GetAdminRedactionRescanIdSessionsFilters | Unset = UNSET,
) -> Response[
    GetAdminRedactionRescanIdSessionsResponse200
    | GetAdminRedactionRescanIdSessionsResponse4XX
    | GetAdminRedactionRescanIdSessionsResponse5XX
]:
    """List the sessions a redaction rescan run changed, with counts

    Args:
        id (str):
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetAdminRedactionRescanIdSessionsSort | Unset):
        order (GetAdminRedactionRescanIdSessionsOrder | Unset):  Default: 'desc'.
        format_ (GetAdminRedactionRescanIdSessionsFormat | Unset):  Default: 'json'.
        filters (GetAdminRedactionRescanIdSessionsFilters | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAdminRedactionRescanIdSessionsResponse200 | GetAdminRedactionRescanIdSessionsResponse4XX | GetAdminRedactionRescanIdSessionsResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
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
    id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetAdminRedactionRescanIdSessionsSort | Unset = UNSET,
    order: GetAdminRedactionRescanIdSessionsOrder | Unset = "desc",
    format_: GetAdminRedactionRescanIdSessionsFormat | Unset = "json",
    filters: GetAdminRedactionRescanIdSessionsFilters | Unset = UNSET,
) -> (
    GetAdminRedactionRescanIdSessionsResponse200
    | GetAdminRedactionRescanIdSessionsResponse4XX
    | GetAdminRedactionRescanIdSessionsResponse5XX
    | None
):
    """List the sessions a redaction rescan run changed, with counts

    Args:
        id (str):
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetAdminRedactionRescanIdSessionsSort | Unset):
        order (GetAdminRedactionRescanIdSessionsOrder | Unset):  Default: 'desc'.
        format_ (GetAdminRedactionRescanIdSessionsFormat | Unset):  Default: 'json'.
        filters (GetAdminRedactionRescanIdSessionsFilters | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAdminRedactionRescanIdSessionsResponse200 | GetAdminRedactionRescanIdSessionsResponse4XX | GetAdminRedactionRescanIdSessionsResponse5XX
    """

    return sync_detailed(
        id=id,
        client=client,
        limit=limit,
        cursor=cursor,
        sort=sort,
        order=order,
        format_=format_,
        filters=filters,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetAdminRedactionRescanIdSessionsSort | Unset = UNSET,
    order: GetAdminRedactionRescanIdSessionsOrder | Unset = "desc",
    format_: GetAdminRedactionRescanIdSessionsFormat | Unset = "json",
    filters: GetAdminRedactionRescanIdSessionsFilters | Unset = UNSET,
) -> Response[
    GetAdminRedactionRescanIdSessionsResponse200
    | GetAdminRedactionRescanIdSessionsResponse4XX
    | GetAdminRedactionRescanIdSessionsResponse5XX
]:
    """List the sessions a redaction rescan run changed, with counts

    Args:
        id (str):
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetAdminRedactionRescanIdSessionsSort | Unset):
        order (GetAdminRedactionRescanIdSessionsOrder | Unset):  Default: 'desc'.
        format_ (GetAdminRedactionRescanIdSessionsFormat | Unset):  Default: 'json'.
        filters (GetAdminRedactionRescanIdSessionsFilters | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetAdminRedactionRescanIdSessionsResponse200 | GetAdminRedactionRescanIdSessionsResponse4XX | GetAdminRedactionRescanIdSessionsResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
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
    id: str,
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetAdminRedactionRescanIdSessionsSort | Unset = UNSET,
    order: GetAdminRedactionRescanIdSessionsOrder | Unset = "desc",
    format_: GetAdminRedactionRescanIdSessionsFormat | Unset = "json",
    filters: GetAdminRedactionRescanIdSessionsFilters | Unset = UNSET,
) -> (
    GetAdminRedactionRescanIdSessionsResponse200
    | GetAdminRedactionRescanIdSessionsResponse4XX
    | GetAdminRedactionRescanIdSessionsResponse5XX
    | None
):
    """List the sessions a redaction rescan run changed, with counts

    Args:
        id (str):
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetAdminRedactionRescanIdSessionsSort | Unset):
        order (GetAdminRedactionRescanIdSessionsOrder | Unset):  Default: 'desc'.
        format_ (GetAdminRedactionRescanIdSessionsFormat | Unset):  Default: 'json'.
        filters (GetAdminRedactionRescanIdSessionsFilters | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetAdminRedactionRescanIdSessionsResponse200 | GetAdminRedactionRescanIdSessionsResponse4XX | GetAdminRedactionRescanIdSessionsResponse5XX
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            limit=limit,
            cursor=cursor,
            sort=sort,
            order=order,
            format_=format_,
            filters=filters,
        )
    ).parsed
