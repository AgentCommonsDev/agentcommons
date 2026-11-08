"""Run against the API integration suite's real PostgreSQL/ClickHouse fixture."""

import asyncio
import json
import os
from uuid import UUID

import httpx
from agentcommons import ApiError, AuthenticatedClient
from agentcommons.api.default import get_sessions, get_sessions_id, post_query, post_search
from agentcommons.models import GetSessionsFilters, PostQueryBody, PostSearchBody


async def main():
    configuration = json.loads(os.environ["SDK_TEST_CONFIGURATION"])
    async with AuthenticatedClient(
        base_url=configuration["url"], token=configuration["key"], timeout=httpx.Timeout(15)
    ) as client:
        search = await post_search.asyncio(client=client, body=PostSearchBody(query="transport"))
        assert configuration["session"] in json.dumps(search.to_dict())
        page = await get_sessions.asyncio(
            client=client,
            filters=GetSessionsFilters(repo_name="github.com/rek7/agentcommons"),
            limit=1,
        )
        assert page.items[0].session_id == UUID(configuration["session"])
        empty = await get_sessions.asyncio(
            client=client, filters=GetSessionsFilters(repo_name="example/missing")
        )
        assert empty.items == []
        session = await get_sessions_id.asyncio(client=client, id=configuration["session"])
        assert session.messages
        sql = await post_query.asyncio(
            client=client, body=PostQueryBody(sql="SELECT session_id FROM sessions")
        )
        assert configuration["session"] in json.dumps(sql.to_dict())
        csv = await get_sessions.asyncio_detailed(client=client, format_="csv")
        assert configuration["session"].encode() in csv.content
        assert csv.parsed is None
    async with AuthenticatedClient(
        base_url=configuration["url"], token=configuration["foreign_key"]
    ) as client:
        try:
            await get_sessions_id.asyncio(client=client, id=configuration["session"])
        except ApiError as error:
            assert error.status == 404
            assert error.code == "SESSION_NOT_FOUND"
        else:
            raise AssertionError("Foreign organization could read the session")
    print("Python SDK real API checks passed")


asyncio.run(main())
