from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.delete_admin_keys_id_body import DeleteAdminKeysIdBody
from ...models.delete_admin_keys_id_response_4xx import DeleteAdminKeysIdResponse4XX
from ...models.delete_admin_keys_id_response_5xx import DeleteAdminKeysIdResponse5XX
from ...models.delete_admin_keys_id_response_200 import DeleteAdminKeysIdResponse200
from ...runtime import check_response
from ...types import Response


def _get_kwargs(
    id: str,
    *,
    body: DeleteAdminKeysIdBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "delete",
        "url": "/api/v1/admin/keys/{id}".format(
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
    DeleteAdminKeysIdResponse200
    | DeleteAdminKeysIdResponse4XX
    | DeleteAdminKeysIdResponse5XX
    | None
):
    check_response(response)
    if response.headers.get("content-type", "").split(";", 1)[0] == "text/csv":
        return None
    if response.status_code == 200:
        response_200 = DeleteAdminKeysIdResponse200.from_dict(response.json())

        return response_200

    if 400 <= response.status_code <= 499:
        response_4xx = DeleteAdminKeysIdResponse4XX.from_dict(response.json())

        return response_4xx

    if 500 <= response.status_code <= 599:
        response_5xx = DeleteAdminKeysIdResponse5XX.from_dict(response.json())

        return response_5xx

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    DeleteAdminKeysIdResponse200
    | DeleteAdminKeysIdResponse4XX
    | DeleteAdminKeysIdResponse5XX
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
    body: DeleteAdminKeysIdBody,
) -> Response[
    DeleteAdminKeysIdResponse200
    | DeleteAdminKeysIdResponse4XX
    | DeleteAdminKeysIdResponse5XX
]:
    """Revoke an organization API key

    Args:
        id (str):
        body (DeleteAdminKeysIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteAdminKeysIdResponse200 | DeleteAdminKeysIdResponse4XX | DeleteAdminKeysIdResponse5XX]
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
    body: DeleteAdminKeysIdBody,
) -> (
    DeleteAdminKeysIdResponse200
    | DeleteAdminKeysIdResponse4XX
    | DeleteAdminKeysIdResponse5XX
    | None
):
    """Revoke an organization API key

    Args:
        id (str):
        body (DeleteAdminKeysIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteAdminKeysIdResponse200 | DeleteAdminKeysIdResponse4XX | DeleteAdminKeysIdResponse5XX
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
    body: DeleteAdminKeysIdBody,
) -> Response[
    DeleteAdminKeysIdResponse200
    | DeleteAdminKeysIdResponse4XX
    | DeleteAdminKeysIdResponse5XX
]:
    """Revoke an organization API key

    Args:
        id (str):
        body (DeleteAdminKeysIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[DeleteAdminKeysIdResponse200 | DeleteAdminKeysIdResponse4XX | DeleteAdminKeysIdResponse5XX]
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
    body: DeleteAdminKeysIdBody,
) -> (
    DeleteAdminKeysIdResponse200
    | DeleteAdminKeysIdResponse4XX
    | DeleteAdminKeysIdResponse5XX
    | None
):
    """Revoke an organization API key

    Args:
        id (str):
        body (DeleteAdminKeysIdBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        DeleteAdminKeysIdResponse200 | DeleteAdminKeysIdResponse4XX | DeleteAdminKeysIdResponse5XX
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
