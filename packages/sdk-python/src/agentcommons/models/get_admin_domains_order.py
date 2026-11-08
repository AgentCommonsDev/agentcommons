from typing import Literal

GetAdminDomainsOrder = Literal["asc", "desc"]

GET_ADMIN_DOMAINS_ORDER_VALUES: set[GetAdminDomainsOrder] = {
    "asc",
    "desc",
}


def check_get_admin_domains_order(value: str) -> GetAdminDomainsOrder:
    if value in GET_ADMIN_DOMAINS_ORDER_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_DOMAINS_ORDER_VALUES!r}"
    )
