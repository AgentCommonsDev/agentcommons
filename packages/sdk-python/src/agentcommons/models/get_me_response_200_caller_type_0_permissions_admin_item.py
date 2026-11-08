from typing import Literal

GetMeResponse200CallerType0PermissionsAdminItem = Literal["*"]

GET_ME_RESPONSE_200_CALLER_TYPE_0_PERMISSIONS_ADMIN_ITEM_VALUES: set[
    GetMeResponse200CallerType0PermissionsAdminItem
] = {
    "*",
}


def check_get_me_response_200_caller_type_0_permissions_admin_item(
    value: str,
) -> GetMeResponse200CallerType0PermissionsAdminItem:
    if value in GET_ME_RESPONSE_200_CALLER_TYPE_0_PERMISSIONS_ADMIN_ITEM_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ME_RESPONSE_200_CALLER_TYPE_0_PERMISSIONS_ADMIN_ITEM_VALUES!r}"
    )
