from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_sessions_filters import GetSessionsFilters
from ...models.get_sessions_format import GetSessionsFormat
from ...models.get_sessions_order import GetSessionsOrder
from ...models.get_sessions_response_4xx import GetSessionsResponse4XX
from ...models.get_sessions_response_5xx import GetSessionsResponse5XX
from ...models.get_sessions_response_200 import GetSessionsResponse200
from ...models.get_sessions_sort import GetSessionsSort
from ...runtime import check_response, serialize_query
from ...types import UNSET, Response, Unset


def _get_kwargs(
    *,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetSessionsSort | Unset = UNSET,
    order: GetSessionsOrder | Unset = "desc",
    format_: GetSessionsFormat | Unset = "json",
    filters: GetSessionsFilters | Unset = UNSET,
    roots_only: bool | Unset = False,
    recall: bool | Unset = False,
    searched: bool | Unset = UNSET,
    used_prior_work: bool | Unset = UNSET,
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

    params["roots_only"] = roots_only

    params["recall"] = recall

    params["searched"] = searched

    params["used_prior_work"] = used_prior_work

    params = serialize_query(
        {k: v for k, v in params.items() if v is not UNSET and v is not None}
    )

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/sessions",
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetSessionsResponse200 | GetSessionsResponse4XX | GetSessionsResponse5XX | None:
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = GetSessionsResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = GetSessionsResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = GetSessionsResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[GetSessionsResponse200 | GetSessionsResponse4XX | GetSessionsResponse5XX]:
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
    sort: GetSessionsSort | Unset = UNSET,
    order: GetSessionsOrder | Unset = "desc",
    format_: GetSessionsFormat | Unset = "json",
    filters: GetSessionsFilters | Unset = UNSET,
    roots_only: bool | Unset = False,
    recall: bool | Unset = False,
    searched: bool | Unset = UNSET,
    used_prior_work: bool | Unset = UNSET,
) -> Response[GetSessionsResponse200 | GetSessionsResponse4XX | GetSessionsResponse5XX]:
    """List sessions

    Args:
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetSessionsSort | Unset):
        order (GetSessionsOrder | Unset):  Default: 'desc'.
        format_ (GetSessionsFormat | Unset):  Default: 'json'.
        filters (GetSessionsFilters | Unset):
        roots_only (bool | Unset):  Default: False.
        recall (bool | Unset):  Default: False.
        searched (bool | Unset):
        used_prior_work (bool | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSessionsResponse200 | GetSessionsResponse4XX | GetSessionsResponse5XX]
    """

    kwargs = _get_kwargs(
        limit=limit,
        cursor=cursor,
        sort=sort,
        order=order,
        format_=format_,
        filters=filters,
        roots_only=roots_only,
        recall=recall,
        searched=searched,
        used_prior_work=used_prior_work,
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
    sort: GetSessionsSort | Unset = UNSET,
    order: GetSessionsOrder | Unset = "desc",
    format_: GetSessionsFormat | Unset = "json",
    filters: GetSessionsFilters | Unset = UNSET,
    roots_only: bool | Unset = False,
    recall: bool | Unset = False,
    searched: bool | Unset = UNSET,
    used_prior_work: bool | Unset = UNSET,
) -> GetSessionsResponse200 | GetSessionsResponse4XX | GetSessionsResponse5XX | None:
    """List sessions

    Args:
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetSessionsSort | Unset):
        order (GetSessionsOrder | Unset):  Default: 'desc'.
        format_ (GetSessionsFormat | Unset):  Default: 'json'.
        filters (GetSessionsFilters | Unset):
        roots_only (bool | Unset):  Default: False.
        recall (bool | Unset):  Default: False.
        searched (bool | Unset):
        used_prior_work (bool | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSessionsResponse200 | GetSessionsResponse4XX | GetSessionsResponse5XX
    """

    return sync_detailed(
        client=client,
        limit=limit,
        cursor=cursor,
        sort=sort,
        order=order,
        format_=format_,
        filters=filters,
        roots_only=roots_only,
        recall=recall,
        searched=searched,
        used_prior_work=used_prior_work,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetSessionsSort | Unset = UNSET,
    order: GetSessionsOrder | Unset = "desc",
    format_: GetSessionsFormat | Unset = "json",
    filters: GetSessionsFilters | Unset = UNSET,
    roots_only: bool | Unset = False,
    recall: bool | Unset = False,
    searched: bool | Unset = UNSET,
    used_prior_work: bool | Unset = UNSET,
) -> Response[GetSessionsResponse200 | GetSessionsResponse4XX | GetSessionsResponse5XX]:
    """List sessions

    Args:
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetSessionsSort | Unset):
        order (GetSessionsOrder | Unset):  Default: 'desc'.
        format_ (GetSessionsFormat | Unset):  Default: 'json'.
        filters (GetSessionsFilters | Unset):
        roots_only (bool | Unset):  Default: False.
        recall (bool | Unset):  Default: False.
        searched (bool | Unset):
        used_prior_work (bool | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetSessionsResponse200 | GetSessionsResponse4XX | GetSessionsResponse5XX]
    """

    kwargs = _get_kwargs(
        limit=limit,
        cursor=cursor,
        sort=sort,
        order=order,
        format_=format_,
        filters=filters,
        roots_only=roots_only,
        recall=recall,
        searched=searched,
        used_prior_work=used_prior_work,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    limit: int | Unset = 50,
    cursor: None | str | Unset = UNSET,
    sort: GetSessionsSort | Unset = UNSET,
    order: GetSessionsOrder | Unset = "desc",
    format_: GetSessionsFormat | Unset = "json",
    filters: GetSessionsFilters | Unset = UNSET,
    roots_only: bool | Unset = False,
    recall: bool | Unset = False,
    searched: bool | Unset = UNSET,
    used_prior_work: bool | Unset = UNSET,
) -> GetSessionsResponse200 | GetSessionsResponse4XX | GetSessionsResponse5XX | None:
    """List sessions

    Args:
        limit (int | Unset):  Default: 50.
        cursor (None | str | Unset):
        sort (GetSessionsSort | Unset):
        order (GetSessionsOrder | Unset):  Default: 'desc'.
        format_ (GetSessionsFormat | Unset):  Default: 'json'.
        filters (GetSessionsFilters | Unset):
        roots_only (bool | Unset):  Default: False.
        recall (bool | Unset):  Default: False.
        searched (bool | Unset):
        used_prior_work (bool | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetSessionsResponse200 | GetSessionsResponse4XX | GetSessionsResponse5XX
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
            roots_only=roots_only,
            recall=recall,
            searched=searched,
            used_prior_work=used_prior_work,
        )
    ).parsed
