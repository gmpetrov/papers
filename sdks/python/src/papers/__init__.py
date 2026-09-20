"""Papers: email and phone infrastructure for agents."""

from typing import Any, Literal, TypedDict
from urllib.parse import quote
import httpx
from pydantic import BaseModel, Field


class ValidationIssue(TypedDict):
    code: str
    path: list[str | int]
    message: str


def _error_details(value: Any) -> dict[str, str] | list[ValidationIssue] | None:
    if isinstance(value, dict) and isinstance(value.get("approvalId"), str):
        return {"approvalId": value["approvalId"]}
    if not isinstance(value, list):
        return None
    result: list[ValidationIssue] = []
    for issue in value:
        if not (isinstance(issue, dict) and isinstance(issue.get("code"), str)
                and isinstance(issue.get("message"), str)
                and isinstance(issue.get("path"), list)
                and all(type(part) in (str, int) for part in issue["path"])):
            return None
        result.append({"code": issue["code"], "path": issue["path"], "message": issue["message"]})
    return result


class PapersError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        request_id: str | None = None,
        retryable: bool = False,
        details: dict[str, str] | list[ValidationIssue] | None = None,
        retry_after_seconds: int | None = None,
    ):
        super().__init__(message)
        self.status, self.code, self.request_id = status, code, request_id
        self.retryable = retryable
        self.details = details
        self.retry_after_seconds = retry_after_seconds


class Inbox(BaseModel):
    id: str
    name: str
    address: str
    agentId: str | None = None
    status: str


class PhoneNumber(BaseModel):
    id: str
    agentId: str | None = None
    phoneNumber: str
    status: str


class SmsRecipientOptOut(BaseModel):
    status: Literal["blocked", "not_blocked", "unknown"]
    observedAt: str | None = None


class AttachmentInfo(BaseModel):
    id: str
    filename: str
    contentType: str
    size: int
    storageStatus: Literal["ready", "pending", "failed", "unavailable"]


class SmsMessage(BaseModel):
    attachments: list[AttachmentInfo] = Field(default_factory=list)
    recipientOptOut: SmsRecipientOptOut | None = None
    segments: int | None = None
    costAmount: str | None = None
    costCurrency: str | None = None
    id: str
    phoneNumberId: str
    from_: str = Field(alias="from")
    to: str
    unread: bool
    createdAt: str
    text: str | None = None
    direction: str
    status: str
    contentTrust: str | None = None


class AttachmentDownloadLink(BaseModel):
    url: str
    expiresAt: str
    contentTrust: Literal["untrusted"]


class Message(BaseModel):
    attachments: list[AttachmentInfo] = Field(default_factory=list)
    id: str
    inboxId: str
    subject: str
    text: str | None = None
    unread: bool = False
    threadId: str | None = None
    direction: str
    status: str
    from_: str | None = Field(default=None, alias="from")
    to: list[str] = Field(default_factory=list)
    replyTo: list[str] = Field(default_factory=list)
    createdAt: str | None = None
    contentTrust: str | None = None


class Event(BaseModel):
    id: str
    type: str
    resourceId: str
    agentId: str | None = None
    createdAt: str


def _decode(response: httpx.Response) -> dict[str, Any]:
    if response.status_code == 204:
        return {}
    try:
        data = response.json()
    except ValueError:
        data = None
    if not response.is_success:
        error = data.get("error") if isinstance(data, dict) else None
        error = error if isinstance(error, dict) else {}
        raise PapersError(
            response.status_code,
            error.get("code", "http_error"),
            error.get("message", "Request failed"),
            error.get("request_id") or response.headers.get("X-Request-Id"),
            error.get("retryable") is True,
            _error_details(error.get("details")),
            _retry_after(response),
        )
    if not isinstance(data, dict):
        raise PapersError(
            response.status_code,
            "invalid_response",
            "Expected a JSON object from Papers",
            response.headers.get("X-Request-Id"),
        )
    return data


def _page_params(cursor: str | None, limit: int) -> dict[str, str | int]:
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
        raise ValueError("limit must be an integer between 1 and 100")
    return {"limit": limit, **({"cursor": cursor} if cursor else {})}


def _download_limit(max_bytes: int):
    if (
        isinstance(max_bytes, bool)
        or not isinstance(max_bytes, int)
        or not 0 <= max_bytes <= 25 * 1024 * 1024
    ):
        raise ValueError("max_bytes must be an integer between 0 and 26214400")


def _download_headers(response: httpx.Response, max_bytes: int):
    if (
        response.headers.get("content-type", "").split(";")[0]
        != "application/octet-stream"
    ):
        raise PapersError(
            response.status_code, "invalid_response", "Expected attachment bytes"
        )
    length = response.headers.get("content-length", "")
    if length.isdigit() and int(length) > max_bytes:
        raise PapersError(
            response.status_code, "attachment_too_large", "Attachment exceeds max_bytes"
        )


class Papers:
    def get_attachment_download_url(self, attachment_id: str) -> AttachmentDownloadLink:
        return AttachmentDownloadLink.model_validate(
            _decode(
                self._http.post(
                    f"attachments/{quote(attachment_id, safe='')}/download-url"
                )
            )
        )

    def download_attachment(
        self, attachment_id: str, *, max_bytes: int = 25 * 1024 * 1024
    ) -> bytes:
        _download_limit(max_bytes)
        with self._http.stream(
            "GET", f"attachments/{quote(attachment_id, safe='')}/download"
        ) as response:
            if not response.is_success:
                response.read()
                _decode(response)
            _download_headers(response, max_bytes)
            result = bytearray()
            for chunk in response.iter_bytes():
                if len(result) + len(chunk) > max_bytes:
                    raise PapersError(
                        response.status_code,
                        "attachment_too_large",
                        "Attachment exceeds max_bytes",
                    )
                result.extend(chunk)
            return bytes(result)

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://www.papers.bot",
        timeout: float = 15,
        *,
        transport: httpx.BaseTransport | None = None,
    ):
        self._http = httpx.Client(
            base_url=base_url.rstrip("/") + "/v1/",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
            transport=transport,
        )

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def close(self):
        self._http.close()

    def search_phone_numbers(self, country: str = "US"):
        return _decode(
            self._http.get("phone-numbers/available", params={"country": country})
        )

    def provision_phone_number(
        self,
        *,
        phone_number: str,
        country: str,
        monthly_cost: str,
        upfront_cost: str,
        currency: str,
        idempotency_key: str,
    ):
        return _decode(
            self._http.post(
                "phone-numbers",
                json={
                    "phoneNumber": phone_number,
                    "country": country,
                    "monthlyCost": monthly_cost,
                    "upfrontCost": upfront_cost,
                    "currency": currency,
                },
                headers={"Idempotency-Key": idempotency_key},
            )
        )

    def release_phone_number(self, number_id: str, *, idempotency_key: str):
        return _decode(
            self._http.delete(
                f"phone-numbers/{quote(number_id, safe='')}",
                headers={"Idempotency-Key": idempotency_key},
            )
        )

    def list_phone_numbers(self, cursor: str | None = None, *, limit: int = 100):
        return _decode(self._http.get("phone-numbers", params=_page_params(cursor, limit)))

    def get_phone_number(self, number_id: str):
        return PhoneNumber.model_validate(
            _decode(self._http.get(f"phone-numbers/{quote(number_id, safe='')}"))
        )

    def send_sms(self, number_id: str, *, to: str, text: str, idempotency_key: str, attachments: list[dict[str, str]] | None = None):
        return _decode(
            self._http.post(
                f"phone-numbers/{quote(number_id, safe='')}/messages",
                json={"to": to, "text": text, **({"attachments": attachments} if attachments is not None else {})},
                headers={"Idempotency-Key": idempotency_key},
            )
        )

    def list_sms(self, number_id: str, cursor: str | None = None, *, limit: int = 25):
        return _decode(
            self._http.get(
                f"phone-numbers/{quote(number_id, safe='')}/messages",
                params=_page_params(cursor, limit),
            )
        )

    def get_sms(self, message_id: str):
        return SmsMessage.model_validate(
            _decode(self._http.get(f"sms/{quote(message_id, safe='')}"))
        )

    def capabilities(self):
        return _decode(self._http.get("capabilities"))

    def me(self):
        return _decode(self._http.get("me"))

    def get_inbox(self, inbox_id: str) -> Inbox:
        return Inbox.model_validate(
            _decode(self._http.get(f"inboxes/{quote(inbox_id, safe='')}"))
        )

    def archive_inbox(self, inbox_id: str):
        return _decode(
            self._http.patch(
                f"inboxes/{quote(inbox_id, safe='')}", json={"status": "archived"}
            )
        )

    def reactivate_inbox(self, inbox_id: str):
        return _decode(self._http.patch(f"inboxes/{quote(inbox_id, safe='')}", json={"status": "active"}))

    def list_approvals(self, cursor: str | None = None, *, limit: int = 25):
        return _decode(self._http.get("approvals", params=_page_params(cursor, limit)))

    def list_events(self, cursor: str | None = None, *, limit: int = 25):
        return _decode(self._http.get("events", params=_page_params(cursor, limit)))

    def iter_events(self, cursor: str | None = None, *, limit: int = 25):
        while True:
            page = self.list_events(cursor, limit=limit)
            for event in page["data"]:
                yield Event.model_validate(event)
            next_cursor = page.get("nextCursor")
            if not next_cursor or not page["data"] or next_cursor == cursor:
                break
            cursor = next_cursor

    def iter_sms(self, number_id: str, *, limit: int = 25):
        cursor = None
        while True:
            page = self.list_sms(number_id, cursor, limit=limit)
            yield from (SmsMessage.model_validate(message) for message in page["data"])
            next_cursor = page.get("nextCursor")
            if not next_cursor or not page["data"] or next_cursor == cursor:
                break
            cursor = next_cursor

    def list_inboxes_page(self, cursor: str | None = None, *, limit: int = 100):
        return _decode(self._http.get("inboxes", params=_page_params(cursor, limit)))

    def iter_inboxes(self, *, limit: int = 100):
        cursor = None
        seen = set()
        while True:
            page = self.list_inboxes_page(cursor, limit=limit)
            yield from (Inbox.model_validate(item) for item in page["data"])
            cursor = page.get("nextCursor")
            if not cursor or not page["data"] or cursor in seen:
                break
            seen.add(cursor)

    def list_inboxes(self):
        return list(self.iter_inboxes())

    def iter_phone_numbers(self, *, limit: int = 100):
        cursor = None
        seen = set()
        while True:
            page = self.list_phone_numbers(cursor, limit=limit)
            yield from (PhoneNumber.model_validate(item) for item in page["data"])
            cursor = page.get("nextCursor")
            if not cursor or not page["data"] or cursor in seen:
                break
            seen.add(cursor)

    def create_inbox(
        self,
        *,
        username: str,
        name: str | None = None,
        agent_id: str | None = None,
    ):
        return Inbox.model_validate(
            _decode(
                self._http.post(
                    "inboxes",
                    json={
                        "username": username,
                        **({"name": name} if name is not None else {}),
                        **({"agentId": agent_id} if agent_id else {}),
                    },
                )
            )
        )

    def list_messages(
        self, inbox_id: str, cursor: str | None = None, *, limit: int = 25
    ):
        return _decode(
            self._http.get(
                f"inboxes/{quote(inbox_id, safe='')}/messages",
                params=_page_params(cursor, limit),
            )
        )

    def get_message(self, message_id: str):
        return Message.model_validate(
            _decode(self._http.get(f"messages/{quote(message_id, safe='')}"))
        )

    def send_email(
        self,
        inbox_id: str,
        *,
        to: list[str],
        subject: str,
        text: str,
        idempotency_key: str,
        attachments: list[dict[str, str]] | None = None,
    ):
        return _decode(
            self._http.post(
                f"inboxes/{quote(inbox_id, safe='')}/messages",
                json={"to": to, "subject": subject, "text": text, **({"attachments": attachments} if attachments is not None else {})},
                headers={"Idempotency-Key": idempotency_key},
            )
        )

    def reply_to_email(self, message_id: str, *, text: str, idempotency_key: str, attachments: list[dict[str, str]] | None = None):
        return _decode(
            self._http.post(
                f"messages/{quote(message_id, safe='')}/reply",
                json={"text": text, **({"attachments": attachments} if attachments is not None else {})},
                headers={"Idempotency-Key": idempotency_key},
            )
        )

    def set_message_unread(self, message_id: str, unread: bool):
        return _decode(
            self._http.patch(
                f"messages/{quote(message_id, safe='')}", json={"unread": unread}
            )
        )

    def get_operation(self, operation_id: str):
        return _decode(self._http.get(f"operations/{quote(operation_id, safe='')}"))

    def iter_messages(self, inbox_id: str, *, limit: int = 25):
        cursor = None
        while True:
            page = self.list_messages(inbox_id, cursor, limit=limit)
            yield from (Message.model_validate(m) for m in page["data"])
            next_cursor = page.get("nextCursor")
            if not next_cursor or not page["data"] or next_cursor == cursor:
                break
            cursor = next_cursor


class AsyncPapers:
    async def get_attachment_download_url(
        self, attachment_id: str
    ) -> AttachmentDownloadLink:
        return AttachmentDownloadLink.model_validate(
            _decode(
                await self._http.post(
                    f"attachments/{quote(attachment_id, safe='')}/download-url"
                )
            )
        )

    async def download_attachment(
        self, attachment_id: str, *, max_bytes: int = 25 * 1024 * 1024
    ) -> bytes:
        _download_limit(max_bytes)
        async with self._http.stream(
            "GET", f"attachments/{quote(attachment_id, safe='')}/download"
        ) as response:
            if not response.is_success:
                await response.aread()
                _decode(response)
            _download_headers(response, max_bytes)
            result = bytearray()
            async for chunk in response.aiter_bytes():
                if len(result) + len(chunk) > max_bytes:
                    raise PapersError(
                        response.status_code,
                        "attachment_too_large",
                        "Attachment exceeds max_bytes",
                    )
                result.extend(chunk)
            return bytes(result)

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://www.papers.bot",
        timeout: float = 15,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/") + "/v1/",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
            transport=transport,
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        await self.close()

    async def close(self):
        await self._http.aclose()

    async def search_phone_numbers(self, country: str = "US"):
        return _decode(
            await self._http.get("phone-numbers/available", params={"country": country})
        )

    async def provision_phone_number(
        self,
        *,
        phone_number: str,
        country: str,
        monthly_cost: str,
        upfront_cost: str,
        currency: str,
        idempotency_key: str,
    ):
        return _decode(
            await self._http.post(
                "phone-numbers",
                json={
                    "phoneNumber": phone_number,
                    "country": country,
                    "monthlyCost": monthly_cost,
                    "upfrontCost": upfront_cost,
                    "currency": currency,
                },
                headers={"Idempotency-Key": idempotency_key},
            )
        )

    async def release_phone_number(self, number_id: str, *, idempotency_key: str):
        return _decode(
            await self._http.delete(
                f"phone-numbers/{quote(number_id, safe='')}",
                headers={"Idempotency-Key": idempotency_key},
            )
        )

    async def list_phone_numbers(self, cursor: str | None = None, *, limit: int = 100):
        return _decode(await self._http.get("phone-numbers", params=_page_params(cursor, limit)))

    async def get_phone_number(self, number_id: str):
        return PhoneNumber.model_validate(
            _decode(await self._http.get(f"phone-numbers/{quote(number_id, safe='')}"))
        )

    async def send_sms(
        self, number_id: str, *, to: str, text: str, idempotency_key: str, attachments: list[dict[str, str]] | None = None
    ):
        return _decode(
            await self._http.post(
                f"phone-numbers/{quote(number_id, safe='')}/messages",
                json={"to": to, "text": text, **({"attachments": attachments} if attachments is not None else {})},
                headers={"Idempotency-Key": idempotency_key},
            )
        )

    async def list_sms(
        self, number_id: str, cursor: str | None = None, *, limit: int = 25
    ):
        return _decode(
            await self._http.get(
                f"phone-numbers/{quote(number_id, safe='')}/messages",
                params=_page_params(cursor, limit),
            )
        )

    async def get_sms(self, message_id: str):
        return SmsMessage.model_validate(
            _decode(await self._http.get(f"sms/{quote(message_id, safe='')}"))
        )

    async def capabilities(self):
        return _decode(await self._http.get("capabilities"))

    async def me(self):
        return _decode(await self._http.get("me"))

    async def get_inbox(self, inbox_id: str) -> Inbox:
        return Inbox.model_validate(
            _decode(await self._http.get(f"inboxes/{quote(inbox_id, safe='')}"))
        )

    async def archive_inbox(self, inbox_id: str):
        return _decode(
            await self._http.patch(
                f"inboxes/{quote(inbox_id, safe='')}", json={"status": "archived"}
            )
        )

    async def reactivate_inbox(self, inbox_id: str):
        return _decode(await self._http.patch(f"inboxes/{quote(inbox_id, safe='')}", json={"status": "active"}))

    async def list_approvals(self, cursor: str | None = None, *, limit: int = 25):
        return _decode(await self._http.get("approvals", params=_page_params(cursor, limit)))

    async def list_events(self, cursor: str | None = None, *, limit: int = 25):
        return _decode(
            await self._http.get("events", params=_page_params(cursor, limit))
        )

    async def iter_events(self, cursor: str | None = None, *, limit: int = 25):
        while True:
            page = await self.list_events(cursor, limit=limit)
            for event in page["data"]:
                yield Event.model_validate(event)
            next_cursor = page.get("nextCursor")
            if not next_cursor or not page["data"] or next_cursor == cursor:
                break
            cursor = next_cursor

    async def iter_sms(self, number_id: str, *, limit: int = 25):
        cursor = None
        while True:
            page = await self.list_sms(number_id, cursor, limit=limit)
            for message in page["data"]:
                yield SmsMessage.model_validate(message)
            next_cursor = page.get("nextCursor")
            if not next_cursor or not page["data"] or next_cursor == cursor:
                break
            cursor = next_cursor

    async def list_inboxes_page(self, cursor: str | None = None, *, limit: int = 100):
        return _decode(await self._http.get("inboxes", params=_page_params(cursor, limit)))

    async def iter_inboxes(self, *, limit: int = 100):
        cursor = None
        seen = set()
        while True:
            page = await self.list_inboxes_page(cursor, limit=limit)
            for item in page["data"]:
                yield Inbox.model_validate(item)
            cursor = page.get("nextCursor")
            if not cursor or not page["data"] or cursor in seen:
                break
            seen.add(cursor)

    async def list_inboxes(self):
        return [item async for item in self.iter_inboxes()]

    async def iter_phone_numbers(self, *, limit: int = 100):
        cursor = None
        seen = set()
        while True:
            page = await self.list_phone_numbers(cursor, limit=limit)
            for item in page["data"]:
                yield PhoneNumber.model_validate(item)
            cursor = page.get("nextCursor")
            if not cursor or not page["data"] or cursor in seen:
                break
            seen.add(cursor)

    async def create_inbox(
        self,
        *,
        username: str,
        name: str | None = None,
        agent_id: str | None = None,
    ):
        return Inbox.model_validate(
            _decode(
                await self._http.post(
                    "inboxes",
                    json={
                        "username": username,
                        **({"name": name} if name is not None else {}),
                        **({"agentId": agent_id} if agent_id else {}),
                    },
                )
            )
        )

    async def list_messages(
        self, inbox_id: str, cursor: str | None = None, *, limit: int = 25
    ):
        return _decode(
            await self._http.get(
                f"inboxes/{quote(inbox_id, safe='')}/messages",
                params=_page_params(cursor, limit),
            )
        )

    async def get_message(self, message_id: str):
        return Message.model_validate(
            _decode(await self._http.get(f"messages/{quote(message_id, safe='')}"))
        )

    async def send_email(
        self,
        inbox_id: str,
        *,
        to: list[str],
        subject: str,
        text: str,
        idempotency_key: str,
        attachments: list[dict[str, str]] | None = None,
    ):
        return _decode(
            await self._http.post(
                f"inboxes/{quote(inbox_id, safe='')}/messages",
                json={"to": to, "subject": subject, "text": text, **({"attachments": attachments} if attachments is not None else {})},
                headers={"Idempotency-Key": idempotency_key},
            )
        )

    async def reply_to_email(self, message_id: str, *, text: str, idempotency_key: str, attachments: list[dict[str, str]] | None = None):
        return _decode(
            await self._http.post(
                f"messages/{quote(message_id, safe='')}/reply",
                json={"text": text, **({"attachments": attachments} if attachments is not None else {})},
                headers={"Idempotency-Key": idempotency_key},
            )
        )

    async def set_message_unread(self, message_id: str, unread: bool):
        return _decode(
            await self._http.patch(
                f"messages/{quote(message_id, safe='')}", json={"unread": unread}
            )
        )

    async def get_operation(self, operation_id: str):
        return _decode(
            await self._http.get(f"operations/{quote(operation_id, safe='')}")
        )

    async def iter_messages(self, inbox_id: str, *, limit: int = 25):
        cursor = None
        while True:
            page = await self.list_messages(inbox_id, cursor, limit=limit)
            for message in page["data"]:
                yield Message.model_validate(message)
            next_cursor = page.get("nextCursor")
            if not next_cursor or not page["data"] or next_cursor == cursor:
                break
            cursor = next_cursor

from .webhooks import verify_webhook, WebhookVerificationError


def _retry_after(response: httpx.Response) -> int | None:
    value = response.headers.get("Retry-After", "")
    if not value or not value.isascii() or not value.isdecimal() or len(value) > 16:
        return None
    seconds = int(value)
    return seconds if seconds <= 9007199254740991 else None
