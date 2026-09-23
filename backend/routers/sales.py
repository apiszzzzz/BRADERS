"""Sales (POS), payments (QRIS gateway), void/cancel, order history."""
import math
from datetime import timedelta
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from core import WIB, db, next_order_no, now_utc, parse_range, require_roles, rid, round2, serialize
from payments import (GATEWAY_NAME, USE_MIDTRANS, build_simulator_notification,
                      gateway, map_midtrans_status)
from services import (compute_discount, expand_bom, finalize_sale, get_settings,
                      record_cash_tx, validate_stock)

router = APIRouter(tags=["sales"])

POS_ROLES = require_roles("owner", "cashier")
ALL = require_roles("owner", "cashier", "staff")


class SaleItemIn(BaseModel):
    product_id: str
    qty: float = Field(gt=0)


class SaleIn(BaseModel):
    items: list[SaleItemIn] = Field(min_length=1)
    payment_method: str = "cash"  # cash | qris | transfer | other
    discount_type: str = "none"  # none | percent | fixed
    discount_value: float = 0
    promo_code: str = ""
    customer_id: str = ""
    amount_paid: Optional[float] = None  # cash payments
    note: str = ""


class VoidIn(BaseModel):
    reason: str = Field(min_length=3, max_length=200)


# ---------------------------------------------------------------------------
# Create sale (POS checkout)
# ---------------------------------------------------------------------------
@router.post("/sales")
async def create_sale(body: SaleIn, user: dict = Depends(POS_ROLES)):
    if len(body.items) > 100:
        raise HTTPException(status_code=400, detail="Terlalu banyak item")

    settings = await get_settings()
    method = body.payment_method
    if method not in ("cash", "qris", "transfer", "other"):
        raise HTTPException(status_code=400, detail="Metode pembayaran tidak valid")
    pm = settings.get("payment_methods", {})
    if not pm.get(method, True):
        raise HTTPException(status_code=400, detail="Metode pembayaran sedang dinonaktifkan")

    # Build items from live product data — never trust client prices.
    raw_items = [{"product_id": i.product_id, "qty": i.qty} for i in body.items]
    pids = [rid(i["product_id"]) for i in raw_items]
    products = {str(p["_id"]): p for p in await db.products.find({"_id": {"$in": pids}, "deleted": {"$ne": True}}).to_list(500)}
    items = []
    for i in raw_items:
        p = products.get(i["product_id"])
        if not p:
            raise HTTPException(status_code=400, detail="Produk tidak ditemukan / tidak aktif")
        if not p.get("active", False):
            raise HTTPException(status_code=400, detail=f"{p['name']} sedang nonaktif")
        qty = float(i["qty"])
        items.append({
            "product_id": i["product_id"], "name": p["name"], "price": float(p["price"]),
            "qty": qty, "line_total": round2(float(p["price"]) * qty), "cogs_unit": 0,
        })

    subtotal = round2(sum(i["line_total"] for i in items))

    # Discount: promo code wins; otherwise manual discount.
    promo = None
    discount_type, discount_value = body.discount_type, float(body.discount_value or 0)
    promo_code = ""
    if body.promo_code:
        promo = await validate_promo_code(body.promo_code.strip().upper(), subtotal)
        promo_code = promo["code"]
        discount_type = promo["discount_type"]
        discount_value = float(promo["value"])
    discount_amount = compute_discount(subtotal, discount_type, discount_value,
                                       max_discount=float(promo["max_discount"]) if promo and promo.get("max_discount") else None)
    total_pre_tax = round2(subtotal - discount_amount)
    tax = 0.0
    if settings.get("apply_tax") and float(settings.get("tax_percent", 0)) > 0:
        tax = round2(total_pre_tax * float(settings["tax_percent"]) / 100.0)
    total = round2(total_pre_tax + tax)

    customer = None
    if body.customer_id:
        c = await db.customers.find_one({"_id": rid(body.customer_id)})
        if not c:
            raise HTTPException(status_code=400, detail="Pelanggan tidak ditemukan")
        customer = {"id": str(c["_id"]), "name": c.get("name", "")}

    change = 0.0
    if method == "cash":
        paid = float(body.amount_paid or 0)
        if paid < total - 0.001:
            raise HTTPException(status_code=400, detail="Uang bayar kurang dari total")
        change = round2(paid - total)

    is_qris = method == "qris"
    order_no = await next_order_no()
    sale_doc = {
        "order_no": order_no,
        "items": items,
        "subtotal": subtotal,
        "discount_type": discount_type if discount_amount > 0 else "none",
        "discount_value": discount_value if discount_amount > 0 else 0,
        "discount_amount": discount_amount,
        "promo_code": promo_code,
        "tax": tax,
        "total": total,
        "payment_method": method,
        "payment_status": "PAYMENT_PENDING" if is_qris else "UNPAID",
        "status": "pending_payment" if is_qris else "completed",
        "cogs_total": 0, "gross_profit": 0, "gateway_fee": 0, "net_received": 0,
        "gateway": GATEWAY_NAME if is_qris else None,
        "customer": customer,
        "cashier": {"id": user["id"], "name": user.get("name", "")},
        "note": body.note.strip(),
        "amount_paid": round2(float(body.amount_paid)) if method == "cash" and body.amount_paid else None,
        "change": change,
        "deducted": False, "restored": False, "stock_blocked": False,
        "voided": None, "paid_at": None,
        "created_at": now_utc(), "updated_at": now_utc(),
    }
    res = await db.sales.insert_one(sale_doc)
    sale_doc["_id"] = res.inserted_id

    if is_qris:
        payment = await create_qris_payment(sale_doc)
        return serialize({"sale": sale_doc, "payment": payment})

    # Cash / transfer / other: finalize immediately.
    result = await finalize_sale(res.inserted_id, user=user)
    sale = result["sale"]
    sale["change"] = change
    return serialize({"sale": sale, "payment": None})


async def create_qris_payment(sale: dict):
    order_id = f"{sale['order_no']}-{await next_number_attempt(str(sale['_id']))}"
    charge = await gateway.charge_qris(order_id, float(sale["total"]), sale["order_no"])
    expires_at = now_utc() + timedelta(minutes=30)
    payment_doc = {
        "sale_id": str(sale["_id"]),
        "order_id": order_id,
        "payment_method": "qris",
        "amount": float(sale["total"]),
        "status": "PAYMENT_PENDING",
        "gateway": gateway.name,
        "gateway_transaction_id": charge["gateway_transaction_id"],
        "gateway_order_id": charge["gateway_order_id"],
        "payment_reference": "",
        "qr_string": charge["qr_string"],
        "attempt": sale.get("attempts", 1),
        "expires_at": expires_at,
        "paid_at": None,
        "created_at": now_utc(),
    }
    res = await db.payments.insert_one(payment_doc)
    payment_doc["_id"] = res.inserted_id
    await db.sales.update_one({"_id": sale["_id"]},
                              {"$set": {"attempts": sale.get("attempts", 1), "updated_at": now_utc()}})
    return payment_doc


async def next_number_attempt(sale_id: str) -> int:
    from pymongo import ReturnDocument
    doc = await db.payments.find_one({"sale_id": sale_id}, sort=[("attempt", -1)])
    return (doc.get("attempt", 1) + 1) if doc else 1


# ---------------------------------------------------------------------------
# Order history
# ---------------------------------------------------------------------------
@router.get("/sales")
async def list_sales(start: str = "", end: str = "", status: str = "", search: str = "",
                     range_name: str = "", limit: int = 100, user: dict = Depends(require_roles("owner", "cashier"))):
    q = {}
    if start or end:
        s, e, _, _ = parse_range("custom", start or "2000-01-01", end or "2999-12-31")
        q["created_at"] = {"$gte": s, "$lt": e}
    if status == "completed":
        q["status"] = {"$in": ["completed"]}
    elif status == "pending":
        q["status"] = "pending_payment"
    elif status == "void":
        q["status"] = {"$in": ["void", "cancelled"]}
    if search:
        q["order_no"] = {"$regex": search.strip().upper(), "$options": "i"}
    items = await db.sales.find(q).sort("created_at", -1).limit(min(limit, 200)).to_list(200)
    return serialize(items)


@router.get("/sales/{sale_id}")
async def get_sale(sale_id: str, user: dict = Depends(require_roles("owner", "cashier"))):
    sale = await db.sales.find_one({"_id": rid(sale_id)})
    if not sale:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    payments = await db.payments.find({"sale_id": sale_id}).sort("created_at", -1).to_list(10)
    sale["payments"] = payments
    return serialize(sale)


# ---------------------------------------------------------------------------
# Void / cancel (data safety: never delete, only reverse)
# ---------------------------------------------------------------------------
@router.post("/sales/{sale_id}/void")
async def void_sale(sale_id: str, body: VoidIn, user: dict = Depends(require_roles("owner"))):
    sale = await db.sales.find_one({"_id": rid(sale_id)})
    if not sale:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    if sale.get("status") in ("void", "cancelled"):
        raise HTTPException(status_code=400, detail="Transaksi sudah dibatalkan")

    if sale.get("status") == "pending_payment":
        # No money moved, no inventory touched — just cancel.
        await db.sales.update_one({"_id": sale["_id"]}, {"$set": {
            "status": "cancelled", "payment_status": "CANCELLED", "voided": {
                "by_id": user["id"], "by_name": user.get("name", ""), "at": now_utc(), "reason": body.reason},
            "updated_at": now_utc()}})
        await db.payments.update_many({"sale_id": sale_id, "status": "PAYMENT_PENDING"},
                                      {"$set": {"status": "CANCELLED", "updated_at": now_utc()}})
        return {"ok": True}

    if not sale.get("payment_status") == "PAID":
        raise HTTPException(status_code=400, detail="Transaksi belum dibayar")

    # Idempotent restore guard
    res = await db.sales.update_one(
        {"_id": sale["_id"], "restored": {"$ne": True}, "status": {"$nin": ["void", "cancelled"]}},
        {"$set": {"restored": True, "updated_at": now_utc()}})
    if res.modified_count == 0:
        raise HTTPException(status_code=400, detail="Pembatalan sedang diproses")

    # 1. Return inventory
    settings = await get_settings()
    bom = await expand_bom(sale["items"])
    for iid, e in bom.items():
        await db.ingredients.update_one({"_id": ObjectId(iid)}, {"$inc": {"stock": e["qty"]}})
        await db.inventory_transactions.insert_one({
            "ingredient_id": iid, "ingredient_name": e["name"], "type": "void_return",
            "qty": e["qty"], "unit": e["unit"], "note": f"Void {sale['order_no']}: {body.reason}",
            "ref_id": sale_id, "created_by_id": user["id"], "created_by_name": user.get("name", ""),
            "created_at": now_utc()})

    # 2. Reverse cash movement (compensating entry — history preserved)
    if sale.get("payment_method") == "cash":
        await record_cash_tx("sale_void", -float(sale["total"]), f"Void penjualan {sale['order_no']}",
                             "sale", sale_id, user=user)

    # 3. Reverse customer stats & promo usage
    if (sale.get("customer") or {}).get("id"):
        await db.customers.update_one({"_id": ObjectId(sale["customer"]["id"])},
                                      {"$inc": {"total_orders": -1, "total_spending": -round2(float(sale["total"]))}})
    if sale.get("promo_code"):
        await db.promotions.update_one({"code": sale["promo_code"].upper()},
                                       {"$inc": {"uses": -1, "revenue": -round2(float(sale["total"])),
                                                 "discount_cost": -round2(float(sale.get("discount_amount", 0)))}})

    await db.sales.update_one({"_id": sale["_id"]}, {"$set": {
        "status": "void", "payment_status": "REFUNDED" if sale.get("payment_method") == "qris" else "UNPAID",
        "voided": {"by_id": user["id"], "by_name": user.get("name", ""), "at": now_utc(), "reason": body.reason},
        "updated_at": now_utc()}})
    return {"ok": True}


@router.post("/sales/{sale_id}/cancel-payment")
async def cancel_payment(sale_id: str, user: dict = Depends(POS_ROLES)):
    sale = await db.sales.find_one({"_id": rid(sale_id)})
    if not sale:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    if sale.get("payment_status") != "PAYMENT_PENDING":
        raise HTTPException(status_code=400, detail="Pembayaran tidak sedang menunggu")
    await db.payments.update_many({"sale_id": sale_id, "status": "PAYMENT_PENDING"},
                                  {"$set": {"status": "CANCELLED", "updated_at": now_utc()}})
    await db.sales.update_one({"_id": sale["_id"]}, {"$set": {
        "status": "cancelled", "payment_status": "CANCELLED", "updated_at": now_utc()}})
    return {"ok": True}


@router.post("/sales/{sale_id}/retry-payment")
async def retry_payment(sale_id: str, user: dict = Depends(POS_ROLES)):
    sale = await db.sales.find_one({"_id": rid(sale_id)})
    if not sale:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    if sale.get("status") in ("void", "cancelled"):
        raise HTTPException(status_code=400, detail="Transaksi sudah dibatalkan")
    if sale.get("payment_status") == "PAID":
        raise HTTPException(status_code=400, detail="Transaksi sudah dibayar")
    await db.payments.update_many({"sale_id": sale_id, "status": "PAYMENT_PENDING"},
                                  {"$set": {"status": "EXPIRED", "updated_at": now_utc()}})
    payment = await create_qris_payment(sale)
    await db.sales.update_one({"_id": sale["_id"]},
                              {"$set": {"payment_status": "PAYMENT_PENDING", "status": "pending_payment"}})
    return serialize(payment)


# ---------------------------------------------------------------------------
# Promo validation helper (used at checkout)
# ---------------------------------------------------------------------------
async def validate_promo_code(code: str, subtotal: float) -> dict:
    today = now_utc().astimezone(WIB).date().isoformat()
    promo = await db.promotions.find_one({"code": code.upper(), "active": True})
    if not promo:
        raise HTTPException(status_code=400, detail="Kode promo tidak ditemukan / tidak aktif")
    if promo.get("start_date") and today < promo["start_date"]:
        raise HTTPException(status_code=400, detail="Promo belum dimulai")
    if promo.get("end_date") and today > promo["end_date"]:
        raise HTTPException(status_code=400, detail="Promo sudah berakhir")
    if subtotal < float(promo.get("min_purchase", 0)):
        raise HTTPException(status_code=400,
                            detail=f"Minimal pembelian Rp{int(promo['min_purchase']):,} untuk promo ini".replace(",", "."))
    return promo


# ---------------------------------------------------------------------------
# Payments: QRIS status & webhook (the ONLY paths that mark a payment paid)
# ---------------------------------------------------------------------------
async def reconcile_payment(payment: dict, tx_status: str, gateway_tx_id: str = None) -> dict:
    """Apply a gateway status to a payment + sale. Idempotent."""
    new_status = map_midtrans_status(tx_status)
    payment = await db.payments.find_one({"_id": payment["_id"]})
    if payment["status"] == new_status:
        return payment  # nothing to do — prevents double processing
    if payment["status"] == "PAID":
        return payment  # already finalized; a webhook can never undo/duplicate it

    if new_status == "PAID":
        await db.payments.update_one({"_id": payment["_id"]}, {"$set": {
            "status": "PAID", "paid_at": now_utc(), "gateway_transaction_id": gateway_tx_id or payment.get("gateway_transaction_id"),
            "updated_at": now_utc()}})
        await finalize_sale(ObjectId(payment["sale_id"]), gateway_tx_id=gateway_tx_id)
        await db.payments.update_one({"_id": payment["_id"]}, {"$set": {"finalized": True, "updated_at": now_utc()}})
    else:
        await db.payments.update_one({"_id": payment["_id"]}, {"$set": {
            "status": new_status, "updated_at": now_utc()}})
        await db.sales.update_one({"_id": ObjectId(payment["sale_id"])},
                                  {"$set": {"payment_status": new_status, "updated_at": now_utc()}})
    return await db.payments.find_one({"_id": payment["_id"]})


@router.get("/payments/{payment_id}")
async def payment_status(payment_id: str, refresh: bool = False, user: dict = Depends(POS_ROLES)):
    payment = await db.payments.find_one({"_id": rid(payment_id)})
    if not payment:
        raise HTTPException(status_code=404, detail="Pembayaran tidak ditemukan")

    # Local expiry
    if payment["status"] == "PAYMENT_PENDING" and payment.get("expires_at") and now_utc() > payment["expires_at"]:
        payment = await reconcile_payment(payment, "expire")

    if refresh and USE_MIDTRANS and payment["status"] in ("PAYMENT_PENDING", "EXPIRED", "FAILED"):
        remote = await gateway.status(payment["order_id"])
        payment = await reconcile_payment(payment, remote["transaction_status"])

    sale = await db.sales.find_one({"_id": ObjectId(payment["sale_id"])})
    return serialize({"payment": payment, "sale": sale, "simulator": not USE_MIDTRANS})


@router.post("/payments/webhook")
async def payment_webhook(request: Request):
    """Midtrans (or simulator) notification endpoint. Never trusts the client."""
    try:
        n = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Payload tidak valid")

    event_doc = {"payload": n, "received_at": now_utc(), "processed": False,
                 "result": "received"}
    if not gateway.verify_notification(n):
        event_doc["result"] = "rejected: invalid signature"
        await db.webhook_events.insert_one(event_doc)
        raise HTTPException(status_code=403, detail="Signature tidak valid")

    payment = await db.payments.find_one({"order_id": str(n.get("order_id", ""))})
    if not payment:
        event_doc["result"] = "rejected: unknown order"
        await db.webhook_events.insert_one(event_doc)
        raise HTTPException(status_code=404, detail="Order tidak ditemukan")

    # Amount check (integer IDR comparison, tolerant of float noise)
    try:
        notified_amount = float(str(n.get("gross_amount", "0")))
    except ValueError:
        notified_amount = -1
    if abs(notified_amount - float(payment["amount"])) > 0.01:
        event_doc["result"] = f"rejected: amount mismatch ({notified_amount} != {payment['amount']})"
        await db.webhook_events.insert_one(event_doc)
        raise HTTPException(status_code=422, detail="Jumlah pembayaran tidak sesuai")

    payment = await reconcile_payment(payment, str(n.get("transaction_status", "")),
                                      gateway_tx_id=n.get("transaction_id"))
    event_doc["processed"] = True
    event_doc["result"] = f"ok: {payment['status']}"
    await db.webhook_events.insert_one(event_doc)
    return {"ok": True, "status": payment["status"]}


@router.post("/payments/{payment_id}/simulate")
async def simulate_payment_event(payment_id: str, event: str = "paid",
                                 user: dict = Depends(require_roles("owner", "cashier"))):
    """Dev-only test harness: pushes a signed notification through the real webhook path."""
    if USE_MIDTRANS:
        raise HTTPException(status_code=403, detail="Simulasi hanya aktif di mode simulator")
    if event not in ("paid", "pending", "expire", "fail", "mismatch"):
        raise HTTPException(status_code=400, detail="Event tidak dikenal")
    payment = await db.payments.find_one({"_id": rid(payment_id)})
    if not payment:
        raise HTTPException(status_code=404, detail="Pembayaran tidak ditemukan")
    n = build_simulator_notification(payment["order_id"], float(payment["amount"]), event)
    request = None  # webhook handler builds its own JSON from dict
    # Feed through the same webhook pipeline (signature + amount + idempotency checks):
    from fastapi import Request as FastAPIRequest

    class FakeRequest:
        async def json(self):
            return n

    result = await payment_webhook(FakeRequest())
    payment = await db.payments.find_one({"_id": rid(payment_id)})
    sale = await db.sales.find_one({"_id": ObjectId(payment["sale_id"])})
    return {"webhook_result": result, "payment": serialize(payment), "sale_status": sale["status"]}
