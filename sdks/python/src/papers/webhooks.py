"""Verify original webhook bodies before parsing or acting on their contents."""
from collections.abc import Mapping
from typing import Any
import re
from standardwebhooks import Webhook


class WebhookVerificationError(Exception):
    """The webhook body or authentication headers could not be verified."""


def verify_webhook(
    raw_body: bytes | str, headers: Mapping[str, str], signing_secret: str
) -> Any:
    """Return authenticated JSON; timestamp tolerance is five minutes.

    Deduplicate webhook-id persistently. Event content can still be untrusted.
    Pass the original body, never JSON serialized again after parsing.
    """
    try:
        normalized = {name.lower(): value for name, value in headers.items()}
        if not re.fullmatch(r"[0-9]{1,12}", normalized.get("webhook-timestamp", "")):
            raise ValueError()
        return Webhook(signing_secret).verify(raw_body, normalized)
    except Exception:
        raise WebhookVerificationError("Invalid webhook signature or payload") from None
