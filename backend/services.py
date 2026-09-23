"""Business logic: sales finalization, inventory deduction, cash ledger, settings.

Financial rules (server-side only, never trusted from client):
  Net Sales    = Gross Sales - Discounts
  COGS         = actual ingredient/packaging cost consumed by sold products (snapshot at payment)
  Gross Profit = Net Sales - COGS
  Net Profit   = Gross Profit - Operating Expenses
  QRIS fee is tracked separately and never subtracted from revenue or HPP.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from bson import ObjectId
from fastapi import HTTPException

from core import WIB, db, next_order_no, now_utc, round2
from payments import GATEWAY_NAME, gateway


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
DEFAULT_SETTINGS = {
    "business_name": "BRADERS",
    "tagline": "Churros Lezatoss",
    "address": "",
    "phone": "",
    "logo_url": "",
    "currency": "IDR",
    "apply_tax": False,
    "tax_percent": 0,
    "qris_fee_percent": 0.7,
    "allow_negative_stock": False,
    "initial_cash": 3000000,
    "receipt_footer": "Terima kasih sudah mampir di BRADERS!",
    "payment_methods": {"cash": True, "qris": True, "transfer": True, "other": True},
    "expense_categories": [
        "Sewa", "Listrik", "Gas", "Transportasi", "Marketing",
        "Packaging", "Peralatan", "Perawatan", "Biaya Platform", "Lainnya",
    ],
    "units": ["gram", "kg", "ml", "liter", "pcs", "pack", "butir", "bungkus"],
    "demo_mode": False,
}


async def get_settings() -> dict:
    doc = await db.business_settings.find_one()
    if not doc:
        doc = dict(DEFAULT_SETTINGS)
        doc["created_at"] = now_utc()
        await db.business_settings.insert_one(doc)
    return doc


# ---------------------------------------------------------------------------
# Money helpers
# ---------------------------------------------------------------------------
def compute_discount(subtotal: float, discount_type: str, discount_value: float,
                     max_discount: Optional[float] = None) -> float:
    if subtotal <= 0:
        return 0.0
    if discount_type == "percent":
        disc = subtotal * (discount_value / 100.0)
    elif discount_type == "fixed":
        disc = float(discount_value)
    else:
        disc = 0.0
    if max_discount is not None:
        disc = min(disc, max_discount)
    return round2(max(0.0, min(disc, subtotal)))


# ---------------------------------------------------------------------------
# Recipes / HPP
# ---------------------------------------------------------------------------
async def recompute_product_hpp(product_id: ObjectId) -> None:
    recipe = await db.recipes.find_one({"product_id": str(product_id)})
    product = await db.products.find_one({"_id": product_id})
    if not product:
        return
    hpp = 0.0
    if recipe:
        ids = [ObjectId(i["ingredient_id"]) for i in recipe.get("items", []) if ObjectId.is_valid(str(i["ingredient_id"]))]
        ings = {str(g["_id"]): g for g in await db.ingredients.find({"_id": {"$in": ids}}).to_list(500)}
        for item in recipe.get("items", []):
            ing = ings.get(str(item["ingredient_id"]))
            if ing:
                hpp += float(item.get("qty", 0)) * float(ing.get("cost_per_unit", 0))
    hpp = round2(hpp)
    price = float(product.get("price", 0))
    await db.products.update_one(
        {"_id": product_id},
        {"$set": {
            "est_hpp": hpp,
            "est_gross_profit": round2(price - hpp),
            "gross_margin": round2(((price - hpp) / price * 100) if price else 0),
            "updated_at": now_utc(),
        }},
    )


async def recompute_hpp_for_ingredient(ingredient_id: str) -> None:
    recipes = await db.recipes.find({"items.ingredient_id": ingredient_id}).to_list(500)
    for r in recipes:
        if ObjectId.is_valid(str(r.get("product_id"))):
            await recompute_product_hpp(ObjectId(r["product_id"]))


async def expand_bom(items: list) -> dict:
    """items: sale items [{product_id, qty}] -> {ingredient_id: {qty, name, unit, cost}}"""
    pids = [ObjectId(i["product_id"]) for i in items]
    products = {str(p["_id"]): p for p in await db.products.find({"_id": {"$in": pids}}).to_list(500)}
    recipes = {str(r["product_id"]): r for r in await db.recipes.find({"product_id": {"$in": [str(p) for p in pids]}}).to_list(500)}
    ing_ids = set()
    for r in recipes.values():
        for it in r.get("items", []):
            if ObjectId.is_valid(str(it["ingredient_id"])):
                ing_ids.add(ObjectId(it["ingredient_id"]))
    ings = {str(g["_id"]): g for g in await db.ingredients.find({"_id": {"$in": list(ing_ids)}}).to_list(1000)}

    needed: dict = {}
    for it in items:
        product = products.get(str(it["product_id"]))
        if not product:
            raise HTTPException(status_code=400, detail="Produk tidak ditemukan")
        recipe = recipes.get(str(it["product_id"]))
        if not recipe:
            continue  # product without recipe has no ingredient consumption
        qty_sold = float(it["qty"])
        for ritem in recipe.get("items", []):
            iid = str(ritem["ingredient_id"])
            ing = ings.get(iid)
            name = ing.get("name") if ing else ritem.get("name", "Bahan")
            unit = ing.get("unit") if ing else ritem.get("unit", "")
            cost = float(ing.get("cost_per_unit", 0)) if ing else 0.0
            entry = needed.setdefault(iid, {"qty": 0.0, "name": name, "unit": unit, "cost": cost})
            entry["qty"] += float(ritem.get("qty", 0)) * qty_sold
    return needed


async def validate_stock(needed: dict, allow_negative: bool) -> list:
    """Returns list of shortage strings. Empty = OK."""
    shortages = []
    for iid, e in needed.items():
        ing = await db.ingredients.find_one({"_id": ObjectId(iid)})
        stock = float(ing.get("stock", 0)) if ing else 0
        if e["qty"] > stock + 1e-9 and not allow_negative:
            shortages.append(f"{e['name']}: butuh {e['qty']:.2f} {e['unit']}, stok {stock:.2f}")
    return shortages


# ---------------------------------------------------------------------------
# Cash ledger
# ---------------------------------------------------------------------------
async def record_cash_tx(tx_type: str, amount: float, note: str, ref_type: str = None,
                         ref_id: str = None, user: dict = None, created_at: datetime = None) -> None:
    if not amount:
        return
    open_session = await db.cash_sessions.find_one({"status": "open"})
    await db.cash_transactions.insert_one({
        "type": tx_type,  # sale | expense | purchase | withdrawal | addition
        "amount": round2(amount),  # signed
        "note": note or "",
        "ref_type": ref_type,
        "ref_id": ref_id,
        "session_id": str(open_session["_id"]) if open_session else None,
        "created_by_id": str(user["id"]) if user else None,
        "created_by_name": user.get("name", "-") if user else "-",
        "created_at": created_at or now_utc(),
    })


async def cash_balance() -> float:
    settings = await get_settings()
    pipeline = [{"$group": {"_id": None, "total": {"$sum": "$amount"}}}]
    agg = await db.cash_transactions.aggregate(pipeline).to_list(1)
    balance = float(settings.get("initial_cash", 0)) + (agg[0]["total"] if agg else 0)
    return round2(balance)


# ---------------------------------------------------------------------------
# Sale finalization (idempotent) — the heart of the system
# ---------------------------------------------------------------------------
async def finalize_sale(sale_id: ObjectId, gateway_tx_id: str = None,
                        paid_at: datetime = None, user: dict = None) -> dict:
    sale = await db.sales.find_one({"_id": sale_id})
    if not sale:
        raise HTTPException(status_code=404, detail="Transaksi tidak ditemukan")
    if sale.get("payment_status") == "PAID":
        return {"already_finalized": True, "sale": sale}
    if sale.get("status") in ("void", "cancelled"):
        raise HTTPException(status_code=400, detail="Transaksi sudah dibatalkan")

    settings = await get_settings()

    # 1. COGS snapshot at payment time (current ingredient costs)
    bom = await expand_bom(sale["items"])
    cogs_total = round2(sum(e["qty"] * e["cost"] for e in bom.values()))

    # 2. Reserve the idempotency slot BEFORE any side effects
    res = await db.sales.update_one(
        {"_id": sale_id, "deducted": {"$ne": True}, "payment_status": {"$ne": "PAID"}},
        {"$set": {"deducted": True, "updated_at": now_utc()}},
    )
    if res.modified_count == 0:
        current = await db.sales.find_one({"_id": sale_id})
        return {"already_finalized": current.get("payment_status") == "PAID", "sale": current}

    # 3. Inventory deduction (only once, guarded above)
    blocked_by_stock = False
    shortages = await validate_stock(bom, settings.get("allow_negative_stock", False))
    if shortages:
        blocked_by_stock = True  # money received but no stock; owner resolves
    else:
        for iid, e in bom.items():
            await db.ingredients.update_one({"_id": ObjectId(iid)}, {"$inc": {"stock": -e["qty"]}})
            await db.inventory_transactions.insert_one({
                "ingredient_id": iid, "ingredient_name": e["name"],
                "type": "sale", "qty": -e["qty"], "unit": e["unit"],
                "note": f"Penjualan {sale['order_no']}", "ref_id": str(sale_id),
                "created_by_id": user["id"] if user else str((sale.get("cashier") or {}).get("id")),
                "created_by_name": user.get("name", (sale.get("cashier") or {}).get("name", "-")) if user else (sale.get("cashier") or {}).get("name", "-"),
                "created_at": paid_at or now_utc(),
            })

    total = float(sale["total"])
    fee = 0.0
    if sale.get("payment_method") == "qris":
        fee = round2(total * float(settings.get("qris_fee_percent", 0)) / 100.0)

    paid_time = paid_at or now_utc()
    await db.sales.update_one(
        {"_id": sale_id},
        {"$set": {
            "payment_status": "PAID",
            "status": "completed",
            "paid_at": paid_time,
            "cogs_total": cogs_total,
            "gross_profit": round2(total - cogs_total),
            "gateway_fee": fee,
            "net_received": round2(total - fee),
            "gateway": sale.get("gateway") or (GATEWAY_NAME if sale.get("payment_method") == "qris" else None),
            "gateway_transaction_id": gateway_tx_id or sale.get("gateway_transaction_id"),
            "stock_blocked": blocked_by_stock,
            "updated_at": now_utc(),
        }},
    )

    # 4. Cash ledger for cash payments
    if sale.get("payment_method") == "cash":
        await record_cash_tx("sale", total, f"Penjualan tunai {sale['order_no']}", "sale", str(sale_id),
                             user=user, created_at=paid_time)

    # 5. Customer stats
    if (sale.get("customer") or {}).get("id"):
        await db.customers.update_one(
            {"_id": ObjectId(sale["customer"]["id"])},
            {"$inc": {"total_orders": 1, "total_spending": round2(total)},
             "$set": {"last_purchase": paid_time}},
        )

    # 6. Promo usage
    if sale.get("promo_code"):
        await db.promotions.update_one(
            {"code": sale["promo_code"].upper()},
            {"$inc": {"uses": 1, "revenue": round2(total), "discount_cost": round2(float(sale.get("discount_amount", 0)))}},
        )

    updated = await db.sales.find_one({"_id": sale_id})
    if blocked_by_stock:
        await db.webhook_events.insert_one({
            "event": "stock_block", "sale_id": str(sale_id), "order_no": sale["order_no"],
            "shortages": shortages, "created_at": now_utc(), "processed": True,
            "payload": {"message": "Pembayaran diterima tetapi stok tidak cukup. Aktifkan stok minus atau lakukan restock, lalu cek status pembayaran lagi."},
        })
    return {"already_finalized": False, "sale": updated, "shortages": shortages if blocked_by_stock else None}
