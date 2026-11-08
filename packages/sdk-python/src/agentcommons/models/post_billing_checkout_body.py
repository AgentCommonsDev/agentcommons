from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.post_billing_checkout_body_plan import (
    PostBillingCheckoutBodyPlan,
    check_post_billing_checkout_body_plan,
)

T = TypeVar("T", bound="PostBillingCheckoutBody")


@_attrs_define
class PostBillingCheckoutBody:
    """
    Attributes:
        plan (PostBillingCheckoutBodyPlan):
    """

    plan: PostBillingCheckoutBodyPlan

    def to_dict(self) -> dict[str, Any]:
        plan: str = self.plan

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "plan": plan,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        plan = check_post_billing_checkout_body_plan(d.pop("plan"))

        post_billing_checkout_body = cls(
            plan=plan,
        )

        return post_billing_checkout_body
