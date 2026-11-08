from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_me_keys_id_body import DeleteMeKeysIdBody
from ...models.delete_me_keys_id_response_4xx import DeleteMeKeysIdResponse4XX
from ...models.delete_me_keys_id_response_5xx import DeleteMeKeysIdResponse5XX
from ...models.delete_me_keys_id_response_200 import DeleteMeKeysIdResponse200
from ...runtime import check_response
from ...types import Response


def _get_kwargs(
    id: str,
    *,
    body: DeleteMeKeysIdBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/v1/me/keys/{id}".format(
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    DeleteMeKeysIdResponse200
    | DeleteMeKeysIdResponse4XX
    | DeleteMeKeysIdResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = DeleteMeKeysIdResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = DeleteMeKeysIdResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = DeleteMeKeysIdResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    DeleteMeKeysIdResponse200 | DeleteMeKeysIdResponse4XX | DeleteMeKeysIdResponse5XX
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
    body: DeleteMeKeysIdBody,
) -> Response[
    DeleteMeKeysIdResponse200 | DeleteMeKeysIdResponse4XX | DeleteMeKeysIdResponse5XX
]:
    """Revoke your organization API key

    Args:
        id (str):
        body (DeleteMeKeysIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteMeKeysIdResponse200 | DeleteMeKeysIdResponse4XX | DeleteMeKeysIdResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: str,
    *,
    client: AuthenticatedClient,
    body: DeleteMeKeysIdBody,
) -> (
    DeleteMeKeysIdResponse200
    | DeleteMeKeysIdResponse4XX
    | DeleteMeKeysIdResponse5XX
    | None
):
    """Revoke your organization API key

    Args:
        id (str):
        body (DeleteMeKeysIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteMeKeysIdResponse200 | DeleteMeKeysIdResponse4XX | DeleteMeKeysIdResponse5XX
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: str,
    *,
    client: AuthenticatedClient,
    body: DeleteMeKeysIdBody,
) -> Response[
    DeleteMeKeysIdResponse200 | DeleteMeKeysIdResponse4XX | DeleteMeKeysIdResponse5XX
]:
    """Revoke your organization API key

    Args:
        id (str):
        body (DeleteMeKeysIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteMeKeysIdResponse200 | DeleteMeKeysIdResponse4XX | DeleteMeKeysIdResponse5XX]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: str,
    *,
    client: AuthenticatedClient,
    body: DeleteMeKeysIdBody,
) -> (
    DeleteMeKeysIdResponse200
    | DeleteMeKeysIdResponse4XX
    | DeleteMeKeysIdResponse5XX
    | None
):
    """Revoke your organization API key

    Args:
        id (str):
        body (DeleteMeKeysIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteMeKeysIdResponse200 | DeleteMeKeysIdResponse4XX | DeleteMeKeysIdResponse5XX
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
