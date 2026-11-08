import asyncio
import importlib
import json
import pkgutil

import httpx
import pytest

from agentcommons import ApiError, AuthenticatedClient, Client
from agentcommons import api, models
from agentcommons.api.default import get_sessions, post_query, post_search
from agentcommons.models import GetSessionsFilters, PostQueryBody, PostSearchBody
from agentcommons.runtime import serialize_query
from agentcommons.types import UNSET


# @req R-SDK-01
def test_every_generated_module_imports():
    for package in (api, models):
        for module in pkgutil.walk_packages(package.__path__, package.__name__ + "."):
            importlib.import_module(module.name)


# @req R-SDK-02
def test_filters_credentials_pagination_and_csv():
    requests = []

    def respond(request):
        requests.append(request)
        if request.url.params.get("format") == "csv":
            return httpx.Response(
                200,
                text="session_id\nexample\n",
                headers={"content-type": "text/csv; charset=utf-8"},
            )
        return httpx.Response(
            200, json={"items": [], "cursor": "next/+=", "total": {"sessions": 0, "messages": 0}}
        )

    with AuthenticatedClient(
        base_url="https://api.example.test",
        token="example-key",
        headers={"X-Client": "python"},
        httpx_args={"transport": httpx.MockTransport(respond)},
    ) as client:
        result = get_sessions.sync(
            client=client,
            filters=GetSessionsFilters(
                repo_name=["example/project", "example/other"], branch="fix/a & b"
            ),
            roots_only=False,
            limit=2,
        )
        assert result.cursor == "next/+="
        assert len(requests) == 1  # No automatic pagination.
        get_sessions.sync(client=client, cursor=result.cursor)
        assert requests[-1].url.params["cursor"] == "next/+="
        csv = get_sessions.sync_detailed(client=client, format_="csv")
        assert csv.content == b"session_id\nexample\n"
        assert csv.parsed is None
    request = requests[0]
    assert request.headers["authorization"] == "Bearer example-key"
    assert request.headers["x-client"] == "python"
    assert json.loads(request.url.params["filters"]) == {
        "repo_name": ["example/project", "example/other"],
        "branch": "fix/a & b",
    }
    assert request.url.params["roots_only"] == "false"
    assert "repo_name" not in request.url.params
    assert serialize_query({"ids": ["a", "b"]}) == {"ids[]": ["a", "b"]}
    with Client(
        base_url="https://api.example.test",
        cookies={"session": "example"},
        httpx_args={"transport": httpx.MockTransport(respond)},
    ) as client:
        get_sessions.sync(client=client)
    assert "authorization" not in requests[-1].headers
    assert requests[-1].headers["cookie"] == "session=example"


# @req R-SDK-02
def test_async_search_and_optional_fields():
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "blocks": [],
                "cursor": None,
                "truncated_response": False,
                "total": {"sessions": 0, "hits": 0},
                "partial": None,
                "next": None,
            },
        )

    async def run():
        async with AuthenticatedClient(
            base_url="https://api.example.test",
            token="example-key",
            httpx_args={"transport": httpx.MockTransport(respond)},
        ) as client:
            result = await post_search.asyncio(
                client=client, body=PostSearchBody(query="timeout", cursor=None, limit=UNSET)
            )
            assert result.blocks == []
            assert result.cursor is None

    asyncio.run(run())
    assert json.loads(requests[0].content) == {"query": "timeout", "cursor": None, "context": 1}


# @req R-SDK-02
@pytest.mark.parametrize(
    "status,body",
    [
        (
            400,
            {
                "code": "INVALID_SQL",
                "message": "Check the SQL.",
                "position": 7,
                "detail": {"hint": "SELECT"},
            },
        ),
        (503, "gateway unavailable"),
    ],
)
def test_http_errors_keep_details_and_do_not_retry(status, body):
    requests = []

    def respond(request):
        requests.append(request)
        return (
            httpx.Response(status, json=body)
            if isinstance(body, dict)
            else httpx.Response(status, text=body)
        )

    with AuthenticatedClient(
        base_url="https://api.example.test",
        token="example-key",
        httpx_args={"transport": httpx.MockTransport(respond)},
    ) as client:
        with pytest.raises(ApiError) as captured:
            post_query.sync(client=client, body=PostQueryBody(sql="SELECT broken"))
    error = captured.value
    assert error.status == status
    assert len(requests) == 1
    if isinstance(body, dict):
        assert error.code == body["code"]
        assert str(error) == body["message"]
        assert error.position == 7
        assert error.detail == {"hint": "SELECT"}
    else:
        assert str(error) == "Request failed."


# @req R-SDK-02
def test_network_failures_are_native():
    def respond(request):
        raise httpx.ConnectError("Network unavailable", request=request)

    with Client(
        base_url="https://api.example.test", httpx_args={"transport": httpx.MockTransport(respond)}
    ) as client:
        with pytest.raises(httpx.ConnectError):
            get_sessions.sync(client=client)
