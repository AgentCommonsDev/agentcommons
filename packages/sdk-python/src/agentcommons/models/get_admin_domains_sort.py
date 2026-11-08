from typing import Literal

GetAdminDomainsSort = Literal["domain"]

GET_ADMIN_DOMAINS_SORT_VALUES: set[GetAdminDomainsSort] = {
    "domain",
}


def check_get_admin_domains_sort(value: str) -> GetAdminDomainsSort:
    if value in GET_ADMIN_DOMAINS_SORT_VALUES:
        return value
    raise TypeError(
        f"Unexpected value {value!r}. Expected one of {GET_ADMIN_DOMAINS_SORT_VALUES!r}"
    )
