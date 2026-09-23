"""Payment gateway abstraction for QRIS.

Two implementations behind one interface:
- MidtransGateway: real Midtrans Core API (sandbox/production by env).
- SimulatorGateway: development simulator used when PAYMENT_SIMULATOR=true or
  when real keys are placeholders. It generates a QR string and signs test
  webhook notifications with SIMULATOR_OK so the exact webhook pipeline
  (signature verify -> idempotent finalize) is what gets tested.

Never expose the server key to the frontend. Status must only be finalized by
verified webhook or server-side status query — never by the client clicking "paid".
"""
import hashlib
import hmac
import os
import uuid
from abc import ABC, abstractmethod
from typing import Optional

import httpx
from fastapi import HTTPException

SERVER_KEY = os.environ.get("MIDTRANS_SERVER_KEY", "")
IS_PRODUCTION = os.environ.get("MIDTRANS_IS_PRODUCTION", "false").lower() == "true"
SIMULATOR = os.environ.get("PAYMENT_SIMULATOR", "true").lower() == "true"

USE_MIDTRANS = (not SIMULATOR) and bool(SERVER_KEY) and not SERVER_KEY.startswith("replace")
GATEWAY_NAME = "midtrans" if USE_MIDTRANS else "simulator"


class Gateway(ABC):
    name: str = "base"

    @abstractmethod
    async def charge_qris(self, order_id: str, amount: float, item_name: str) -> dict:
        """Returns normalized: {gateway_order_id, gateway_transaction_id, qr_string, raw}."""

    @abstractmethod
    async def status(self, order_id: str) -> dict:
        """Returns normalized: {transaction_status} using Midtrans-style statuses."""

    @abstractmethod
    def verify_notification(self, n: dict) -> bool:
        """Verify webhook signature. Must be constant-time."""


def map_midtrans_status(transaction_status: str) -> str:
    s = (transaction_status or "").lower()
    if s in ("capture", "settlement"):
        return "PAID"
    if s == "pending":
        return "PAYMENT_PENDING"
    if s == "expire":
        return "EXPIRED"
    if s in ("deny", "failure", "cancel"):
        return "FAILED"
    if s == "refund":
        return "REFUNDED"
    return "PAYMENT_PENDING"


class MidtransGateway(Gateway):
    name = "midtrans"

    @property
    def base(self) -> str:
        return "https://api.midtrans.com" if IS_PRODUCTION else "https://api.sandbox.midtrans.com"

    def _auth(self):
        import base64

        return {"Authorization": "Basic " + base64.b64encode(f"{SERVER_KEY}:".encode()).decode()}

    async def charge_qris(self, order_id: str, amount: float, item_name: str) -> dict:
        body = {
            "payment_type": "qris",
            "transaction_details": {
                "order_id": order_id,
                "gross_amount": int(amount),
            },
            "item_details": [{"id": order_id, "price": int(amount), "quantity": 1, "name": item_name[:50]}],
            "qris": {"acquirer": "gopay"},
        }
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(f"{self.base}/v2/charge", json=body, headers=self._auth())
            data = r.json()
        if str(data.get("status_code")) not in ("200", "201"):
            raise HTTPException(status_code=502, detail=f"Gateway error: {data.get('status_message', 'unknown')}")
        qr = data.get("qr_string") or next(
            (a.get("url") for a in data.get("actions", []) if str(a.get("name", "")).startswith("generate-qr-code")),
            None,
        )
        return {
            "gateway_order_id": data.get("order_id", order_id),
            "gateway_transaction_id": data.get("transaction_id"),
            "qr_string": qr,
            "raw": data,
        }

    async def status(self, order_id: str) -> dict:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.get(f"{self.base}/v2/{order_id}/status", headers=self._auth())
            data = r.json()
        return {"transaction_status": data.get("transaction_status", "pending"), "raw": data}

    def verify_notification(self, n: dict) -> bool:
        raw = f"{n.get('order_id', '')}{n.get('status_code', '')}{n.get('gross_amount', '')}{SERVER_KEY}"
        expected = hashlib.sha512(raw.encode()).hexdigest()
        return hmac.compare_digest(expected, str(n.get("signature_key", "")))


class SimulatorGateway(Gateway):
    name = "simulator"

    async def charge_qris(self, order_id: str, amount: float, item_name: str) -> dict:
        return {
            "gateway_order_id": order_id,
            "gateway_transaction_id": f"SIM-{uuid.uuid4().hex[:12]}",
            "qr_string": f"BRADERS-SIM-QRIS|{order_id}|{int(amount)}",
            "raw": {"simulated": True, "order_id": order_id, "gross_amount": f"{amount:.2f}"},
        }

    async def status(self, order_id: str) -> dict:
        # Simulator: source of truth is the (simulated) webhook; report pending.
        return {"transaction_status": "pending", "raw": {"simulated": True}}

    def verify_notification(self, n: dict) -> bool:
        return hmac.compare_digest("SIMULATOR_OK", str(n.get("signature_key", "")))


gateway: Gateway = MidtransGateway() if USE_MIDTRANS else SimulatorGateway()


def build_simulator_notification(
    order_id: str,
    amount: float,
    event: str,
) -> dict:
    """Build a signed test notification, as the real gateway would deliver."""
    status_by_event = {
        "paid": ("200", "settlement"),
        "pending": ("201", "pending"),
        "expire": ("407", "expire"),
        "fail": ("400", "deny"),
        "mismatch": ("200", "settlement"),  # gross_amount below is intentionally wrong
    }
    status_code, tx_status = status_by_event.get(event, ("201", "pending"))
    gross = f"{amount:.2f}"
    if event == "mismatch":
        gross = f"{amount + 1000:.2f}"
    return {
        "order_id": order_id,
        "status_code": status_code,
        "gross_amount": gross,
        "transaction_status": tx_status,
        "transaction_id": f"SIM-{uuid.uuid4().hex[:12]}",
        "signature_key": "SIMULATOR_OK",
        "simulator_event": event,
    }
