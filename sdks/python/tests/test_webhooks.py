import base64
import hashlib
import hmac
import json
import time
import pytest
from papers import verify_webhook, WebhookVerificationError

SECRET_BYTES = bytes(range(32))
SECRET = "whsec_" + base64.b64encode(SECRET_BYTES).decode()
BODY = '{"type":"sms.received","text":"Bonjour 🌍"}'.encode()


def headers(offset=0):
    timestamp = str(int(time.time()) + offset)
    signature = base64.b64encode(hmac.new(
        SECRET_BYTES, b"delivery." + timestamp.encode() + b"." + BODY, hashlib.sha256
    ).digest()).decode()
    return {"Webhook-Id": "delivery", "Webhook-Timestamp": timestamp,
            "Webhook-Signature": "v1," + signature}


def test_verifies_original_bytes_and_rotation_signature_list():
    signed = headers()
    signed["Webhook-Signature"] = "v1," + base64.b64encode(bytes(32)).decode() + " " + signed["Webhook-Signature"]
    assert verify_webhook(BODY, signed, SECRET) == json.loads(BODY)
    assert verify_webhook(BODY.decode(), signed, SECRET) == json.loads(BODY)


@pytest.mark.parametrize("change", ["body", "id", "old", "future", "missing", "malformed", "timestamp", "secret"])
def test_rejects_invalid_requests(change):
    signed = headers(-301 if change == "old" else 301 if change == "future" else 0)
    body, secret = BODY, SECRET
    if change == "body": body += b" "
    if change == "id": signed["Webhook-Id"] = "another"
    if change == "missing": signed.pop("Webhook-Signature")
    if change == "malformed": signed["Webhook-Signature"] = "v1"
    if change == "timestamp": signed["Webhook-Timestamp"] += "junk"
    if change == "secret": secret = "whsec_" + base64.b64encode(bytes(32)).decode()
    with pytest.raises(WebhookVerificationError):
        verify_webhook(body, signed, secret)
