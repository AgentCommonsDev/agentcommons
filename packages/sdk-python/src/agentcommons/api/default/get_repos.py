from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_repos_filters import GetReposFilters
from ...models.get_repos_format import GetReposFormat
from ...models.get_repos_order import GetReposOrder
from ...models.get_repos_response_4xx import GetReposResponse4XX
from ...models.get_repos_response_5xx import GetReposResponse5XX
from ...models.get_repos_response_200 import GetReposResponse200
from ...models.get_repos_sort import GetReposSort
from ...runtime import check_response, serialize_query
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetReposSort | Unset = UNSET,
    order: GetReposOrder | Unset = "desc",
    format_: GetReposFormat | Unset = "json",
    filters: GetReposFilters | Unset = UNSET,
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
        "url": "/api/v1/repos",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetReposResponse200 | GetReposResponse4XX | GetReposResponse5XX | None:
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = GetReposResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = GetReposResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = GetReposResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetReposResponse200 | GetReposResponse4XX | GetReposResponse5XX]:
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
    sort: GetReposSort | Unset = UNSET,
    order: GetReposOrder | Unset = "desc",
    format_: GetReposFormat | Unset = "json",
    filters: GetReposFilters | Unset = UNSET,
) -> Response[GetReposResponse200 | GetReposResponse4XX | GetReposResponse5XX]:
    """List repositories

    Args:
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetReposSort | Unset):
        order (GetReposOrder | Unset):  Default: 'desc'.
        format_ (GetReposFormat | Unset):  Default: 'json'.
        filters (GetReposFilters | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetReposResponse200 | GetReposResponse4XX | GetReposResponse5XX]
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
    sort: GetReposSort | Unset = UNSET,
    order: GetReposOrder | Unset = "desc",
    format_: GetReposFormat | Unset = "json",
    filters: GetReposFilters | Unset = UNSET,
) -> GetReposResponse200 | GetReposResponse4XX | GetReposResponse5XX | None:
    """List repositories

    Args:
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetReposSort | Unset):
        order (GetReposOrder | Unset):  Default: 'desc'.
        format_ (GetReposFormat | Unset):  Default: 'json'.
        filters (GetReposFilters | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetReposResponse200 | GetReposResponse4XX | GetReposResponse5XX
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
    sort: GetReposSort | Unset = UNSET,
    order: GetReposOrder | Unset = "desc",
    format_: GetReposFormat | Unset = "json",
    filters: GetReposFilters | Unset = UNSET,
) -> Response[GetReposResponse200 | GetReposResponse4XX | GetReposResponse5XX]:
    """List repositories

    Args:
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetReposSort | Unset):
        order (GetReposOrder | Unset):  Default: 'desc'.
        format_ (GetReposFormat | Unset):  Default: 'json'.
        filters (GetReposFilters | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetReposResponse200 | GetReposResponse4XX | GetReposResponse5XX]
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
    sort: GetReposSort | Unset = UNSET,
    order: GetReposOrder | Unset = "desc",
    format_: GetReposFormat | Unset = "json",
    filters: GetReposFilters | Unset = UNSET,
) -> GetReposResponse200 | GetReposResponse4XX | GetReposResponse5XX | None:
    """List repositories

    Args:
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetReposSort | Unset):
        order (GetReposOrder | Unset):  Default: 'desc'.
        format_ (GetReposFormat | Unset):  Default: 'json'.
        filters (GetReposFilters | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetReposResponse200 | GetReposResponse4XX | GetReposResponse5XX
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
