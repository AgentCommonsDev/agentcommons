from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="GetAdminStatusResponse200ServerUpdaterType0")


@_attrs_define
class GetAdminStatusResponse200ServerUpdaterType0:
    """
    Attributes:
        last_check (datetime.datetime | None):
        last_ok (datetime.datetime | None):
        last_result (None | str):
        last_image (None | str):
        previous_image (None | str):
        updated_at (datetime.datetime | None):
        failed_image (None | str):
        failed_at (datetime.datetime | None):
        failures (int):
        running_revision (None | str):
        running_created (datetime.datetime | None):
        pulled_revision (None | str):
        pulled_created (datetime.datetime | None):
    """

    last_check: datetime.datetime | None
    last_ok: datetime.datetime | None
    last_result: None | str
    last_image: None | str
    previous_image: None | str
    updated_at: datetime.datetime | None
    failed_image: None | str
    failed_at: datetime.datetime | None
    failures: int
    running_revision: None | str
    running_created: datetime.datetime | None
    pulled_revision: None | str
    pulled_created: datetime.datetime | None

    def to_dict(self) -> dict[str, Any]:
        last_check: None | str
        if isinstance(self.last_check, datetime.datetime):
            last_check = self.last_check.isoformat()
        else:
            last_check = self.last_check

        last_ok: None | str
        if isinstance(self.last_ok, datetime.datetime):
            last_ok = self.last_ok.isoformat()
        else:
            last_ok = self.last_ok

        last_result: None | str
        last_result = self.last_result

        last_image: None | str
        last_image = self.last_image

        previous_image: None | str
        previous_image = self.previous_image

        updated_at: None | str
        if isinstance(self.updated_at, datetime.datetime):
            updated_at = self.updated_at.isoformat()
        else:
            updated_at = self.updated_at

        failed_image: None | str
        failed_image = self.failed_image

        failed_at: None | str
        if isinstance(self.failed_at, datetime.datetime):
            failed_at = self.failed_at.isoformat()
        else:
            failed_at = self.failed_at

        failures = self.failures

        running_revision: None | str
        running_revision = self.running_revision

        running_created: None | str
        if isinstance(self.running_created, datetime.datetime):
            running_created = self.running_created.isoformat()
        else:
            running_created = self.running_created

        pulled_revision: None | str
        pulled_revision = self.pulled_revision

        pulled_created: None | str
        if isinstance(self.pulled_created, datetime.datetime):
            pulled_created = self.pulled_created.isoformat()
        else:
            pulled_created = self.pulled_created

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "last_check": last_check,
                "last_ok": last_ok,
                "last_result": last_result,
                "last_image": last_image,
                "previous_image": previous_image,
                "updated_at": updated_at,
                "failed_image": failed_image,
                "failed_at": failed_at,
                "failures": failures,
                "running_revision": running_revision,
                "running_created": running_created,
                "pulled_revision": pulled_revision,
                "pulled_created": pulled_created,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_last_check(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_check_type_0 = datetime.datetime.fromisoformat(data)

                return last_check_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        last_check = _parse_last_check(d.pop("last_check"))

        def _parse_last_ok(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                last_ok_type_0 = datetime.datetime.fromisoformat(data)

                return last_ok_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        last_ok = _parse_last_ok(d.pop("last_ok"))

        def _parse_last_result(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_result = _parse_last_result(d.pop("last_result"))

        def _parse_last_image(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_image = _parse_last_image(d.pop("last_image"))

        def _parse_previous_image(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        previous_image = _parse_previous_image(d.pop("previous_image"))

        def _parse_updated_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                updated_at_type_0 = datetime.datetime.fromisoformat(data)

                return updated_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        updated_at = _parse_updated_at(d.pop("updated_at"))

        def _parse_failed_image(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        failed_image = _parse_failed_image(d.pop("failed_image"))

        def _parse_failed_at(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                failed_at_type_0 = datetime.datetime.fromisoformat(data)

                return failed_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        failed_at = _parse_failed_at(d.pop("failed_at"))

        failures = d.pop("failures")

        def _parse_running_revision(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        running_revision = _parse_running_revision(d.pop("running_revision"))

        def _parse_running_created(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                running_created_type_0 = datetime.datetime.fromisoformat(data)

                return running_created_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        running_created = _parse_running_created(d.pop("running_created"))

        def _parse_pulled_revision(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        pulled_revision = _parse_pulled_revision(d.pop("pulled_revision"))

        def _parse_pulled_created(data: object) -> datetime.datetime | None:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                pulled_created_type_0 = datetime.datetime.fromisoformat(data)

                return pulled_created_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None, data)

        pulled_created = _parse_pulled_created(d.pop("pulled_created"))

        get_admin_status_response_200_server_updater_type_0 = cls(
            last_check=last_check,
            last_ok=last_ok,
            last_result=last_result,
            last_image=last_image,
            previous_image=previous_image,
            updated_at=updated_at,
            failed_image=failed_image,
            failed_at=failed_at,
            failures=failures,
            running_revision=running_revision,
            running_created=running_created,
            pulled_revision=pulled_revision,
            pulled_created=pulled_created,
        )

        return get_admin_status_response_200_server_updater_type_0
