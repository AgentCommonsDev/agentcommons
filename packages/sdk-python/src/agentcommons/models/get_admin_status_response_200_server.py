from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.get_admin_status_response_200_server_updater_type_0 import (
        GetAdminStatusResponse200ServerUpdaterType0,
    )


T = TypeVar("T", bound="GetAdminStatusResponse200Server")


@_attrs_define
class GetAdminStatusResponse200Server:
    """
    Attributes:
        version (str):
        auto_update (bool):
        updater (GetAdminStatusResponse200ServerUpdaterType0 | None):
    """

    version: str
    auto_update: bool
    updater: GetAdminStatusResponse200ServerUpdaterType0 | None

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_admin_status_response_200_server_updater_type_0 import (
            GetAdminStatusResponse200ServerUpdaterType0,  # noqa: PLC0415
        )

        version = self.version

        auto_update = self.auto_update

        updater: dict[str, Any] | None
        if isinstance(self.updater, GetAdminStatusResponse200ServerUpdaterType0):
            updater = self.updater.to_dict()
        else:
            updater = self.updater

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "version": version,
                "auto_update": auto_update,
                "updater": updater,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_admin_status_response_200_server_updater_type_0 import (
            GetAdminStatusResponse200ServerUpdaterType0,  # noqa: PLC0415
        )

        d = dict(src_dict)
        version = d.pop("version")

        auto_update = d.pop("auto_update")

        def _parse_updater(
            data: object,
        ) -> GetAdminStatusResponse200ServerUpdaterType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                updater_type_0 = GetAdminStatusResponse200ServerUpdaterType0.from_dict(
                    data
                )

                return updater_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetAdminStatusResponse200ServerUpdaterType0 | None, data)

        updater = _parse_updater(d.pop("updater"))

        get_admin_status_response_200_server = cls(
            version=version,
            auto_update=auto_update,
            updater=updater,
        )

        return get_admin_status_response_200_server
