from typing import Literal

GetMeResponse200CallerType0PermissionsToolsItem = Literal[
    "administration", "dashboards"
]

GET_ME_RESPONSE_200_CALLER_TYPE_0_PERMISSIONS_TOOLS_ITEM_VALUES: set[
    GetMeResponse200CallerType0PermissionsToolsItem
] = {
    "administration",
    "dashboards",
}


def check_get_me_response_200_caller_type_0_permissions_tools_item(
    value: str,
) -> GetMeResponse200CallerType0PermissionsToolsItem:
    if value in GET_ME_RESPONSE_200_CALLER_TYPE_0_PERMISSIONS_TOOLS_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ME_RESPONSE_200_CALLER_TYPE_0_PERMISSIONS_TOOLS_ITEM_VALUES!r}"
    )
