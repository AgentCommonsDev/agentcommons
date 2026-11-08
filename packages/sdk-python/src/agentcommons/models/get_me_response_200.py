from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast

from attrs import define as _attrs_define

from ..models.get_me_response_200_onboarding import (
    GetMeResponse200Onboarding,
    check_get_me_response_200_onboarding,
)

if TYPE_CHECKING:
    from ..models.get_me_response_200_caller_type_0 import GetMeResponse200CallerType0
    from ..models.get_me_response_200_key_type_0 import GetMeResponse200KeyType0
    from ..models.get_me_response_200_organization_type_0 import (
        GetMeResponse200OrganizationType0,
    )
    from ..models.get_me_response_200_user import GetMeResponse200User


T = TypeVar("T", bound="GetMeResponse200")


@_attrs_define
class GetMeResponse200:
    """
    Attributes:
        user (GetMeResponse200User):
        onboarding (GetMeResponse200Onboarding):
        organization (GetMeResponse200OrganizationType0 | None):
        caller (GetMeResponse200CallerType0 | None):
        key (GetMeResponse200KeyType0 | None):
    """

    user: GetMeResponse200User
    onboarding: GetMeResponse200Onboarding
    organization: GetMeResponse200OrganizationType0 | None
    caller: GetMeResponse200CallerType0 | None
    key: GetMeResponse200KeyType0 | None

    def to_dict(self) -> dict[str, Any]:
        from ..models.get_me_response_200_caller_type_0 import (
            GetMeResponse200CallerType0,  # noqa: PLC0415
        )
        from ..models.get_me_response_200_key_type_0 import (
            GetMeResponse200KeyType0,  # noqa: PLC0415
        )
        from ..models.get_me_response_200_organization_type_0 import (
            GetMeResponse200OrganizationType0,  # noqa: PLC0415
        )

        user = self.user.to_dict()

        onboarding: str = self.onboarding

        organization: dict[str, Any] | None
        if isinstance(self.organization, GetMeResponse200OrganizationType0):
            organization = self.organization.to_dict()
        else:
            organization = self.organization

        caller: dict[str, Any] | None
        if isinstance(self.caller, GetMeResponse200CallerType0):
            caller = self.caller.to_dict()
        else:
            caller = self.caller

        key: dict[str, Any] | None
        if isinstance(self.key, GetMeResponse200KeyType0):
            key = self.key.to_dict()
        else:
            key = self.key

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "user": user,
                "onboarding": onboarding,
                "organization": organization,
                "caller": caller,
                "key": key,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_me_response_200_caller_type_0 import (
            GetMeResponse200CallerType0,  # noqa: PLC0415
        )
        from ..models.get_me_response_200_key_type_0 import (
            GetMeResponse200KeyType0,  # noqa: PLC0415
        )
        from ..models.get_me_response_200_organization_type_0 import (
            GetMeResponse200OrganizationType0,  # noqa: PLC0415
        )
        from ..models.get_me_response_200_user import (
            GetMeResponse200User,  # noqa: PLC0415
        )

        d = dict(src_dict)
        user = GetMeResponse200User.from_dict(d.pop("user"))

        onboarding = check_get_me_response_200_onboarding(d.pop("onboarding"))

        def _parse_organization(
            data: object,
        ) -> GetMeResponse200OrganizationType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                organization_type_0 = GetMeResponse200OrganizationType0.from_dict(data)

                return organization_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetMeResponse200OrganizationType0 | None, data)

        organization = _parse_organization(d.pop("organization"))

        def _parse_caller(data: object) -> GetMeResponse200CallerType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                caller_type_0 = GetMeResponse200CallerType0.from_dict(data)

                return caller_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetMeResponse200CallerType0 | None, data)

        caller = _parse_caller(d.pop("caller"))

        def _parse_key(data: object) -> GetMeResponse200KeyType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                key_type_0 = GetMeResponse200KeyType0.from_dict(data)

                return key_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(GetMeResponse200KeyType0 | None, data)

        key = _parse_key(d.pop("key"))

        get_me_response_200 = cls(
            user=user,
            onboarding=onboarding,
            organization=organization,
            caller=caller,
            key=key,
        )

        return get_me_response_200
