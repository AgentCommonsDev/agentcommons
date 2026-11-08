"""Wire conventions shared by every generated endpoint."""

import json
from typing import Any

import httpx


def serialize_query(params: dict[str, Any]) -> dict[str, Any]:
    """Preserve object-valued filters as JSON and arrays as bracketed query keys."""
    return {
        f"{key}[]" if isinstance(value, list) else key: (
            json.dumps(value, separators=(",", ":")) if isinstance(value, dict) else value
        )
        for key, value in params.items()
    }


class ApiError(httpx.HTTPStatusError):
    """An HTTP failure with the API's code, message, and optional SQL position."""

    def __init__(self, response: httpx.Response) -> None:
        self.status = response.status_code
        self.code = "request_failed"
        self.position: int | None = None
        self.detail: Any = None
        message = "Request failed."
        try:
            body = response.json()
        except ValueError:
            body = None
        if (
            isinstance(body, dict)
            and isinstance(body.get("code"), str)
            and isinstance(body.get("message"), str)
        ):
            self.code = body["code"]
            message = body["message"]
            position = body.get("position")
            if type(position) is int and position >= 0:
                self.position = position
            self.detail = body.get("detail")
        super().__init__(message, request=response.request, response=response)


def check_response(response: httpx.Response) -> None:
    if not response.is_success:
        raise ApiError(response)
