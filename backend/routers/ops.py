"""Operations: inventory movements, purchases, expenses, cash register."""
from datetime import datetime
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import WIB, db, next_number, now_utc, parse_range, require_roles, rid, round2, serialize
from services import cash_balance, get_settings, record_cash_tx

router = APIRouter(tags=["ops"])

ALL = require_roles("owner", "cashier", "staff")
OPS_ROLES = require_roles("owner", "staff", "cashier")
STAFF_OPS = require_roles("owner", "staff")
CASH_ROLES = require_roles("owner", "cashier")
OWNER = require_roles("owner")


# ---------------------------------------------------------------------------
# Inventory movements
# ---------------------------------------------------------------------------
class MovementIn(BaseModel):
    ingredient_id: str
    type: str  # in | out | adjust
    qty: float
    note: str = ""


@router.get("/inventory/transactions")
async def list_movements(ingredient_id: str = "", start: str = "", end: str = "",
                         limit: int = 100, user: dict = Depends(ALL)):
    q = {}
    if ingredient_id:
        q["ingredient_id"] = ingredient_id
    if start or end:
        s, e, _, _ = parse_range("custom", start or "2000-01-01", end or "2999-12-31")
        q["created_at"] = {"$gte": s, "$lt": e}
    items = await db.inventory_transactions.find(q).sort("created_at", -1).limit(min(limit, 300)).to_list(300)
    return serialize(items)


@router.post("/inventory/transactions")
async def create_movement(body: MovementIn, user: dict = Depends(STAFF_OPS)):
    if body.type not in ("in", "out", "adjust"):
        raise HTTPException(status_code=400, detail="Jenis pergerakan tidak valid")
    ing = await db.ingredients.find_one({"_id": rid(body.ingredient_id), "deleted": {"$ne": True}})
    if not ing:
        raise HTTPException(status_code=404, detail="Bahan tidak ditemukan")
    qty = float(body.qty)
    if body.type in ("in", "out") and qty <= 0:
        raise HTTPException(status_code=400, detail="Jumlah harus lebih dari 0")
    delta = {"in": qty, "out": -qty, "adjust": qty - float(ing.get("stock", 0))}[body.type]

    await db.ingredients.update_one({"_id": ing["_id"]}, {"$inc": {"stock": delta}, "$set": {"updated_at": now_utc()}})
    doc = {
        "ingredient_id": str(ing["_id"]), "ingredient_name": ing["name"],
        "type": body.type, "qty": round2(delta), "unit": ing.get("unit", ""),
        "note": body.note.strip() or {"in": "Stok masuk", "out": "Stok keluar", "adjust": "Penyesuaian stok"}[body.type],
        "ref_id": None, "created_by_id": user["id"], "created_by_name": user.get("name", ""),
        "created_at": now_utc(),
    }
    res = await db.inventory_transactions.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize(doc)


# ---------------------------------------------------------------------------
# Purchases (stock in)
# ---------------------------------------------------------------------------
class PurchaseItemIn(BaseModel):
    ingredient_id: str
    qty: float = Field(gt=0)
    unit_price: float = Field(ge=0)


class PurchaseIn(BaseModel):
    supplier_id: str = ""
    supplier_name: str = ""
    date: str  # YYYY-MM-DD
    items: list[PurchaseItemIn] = Field(min_length=1)
    payment_status: str = "paid"  # paid | unpaid
    payment_method: str = "cash"  # when paid in cash -> cash ledger out
    notes: str = ""


@router.get("/purchases")
async def list_purchases(start: str = "", end: str = "", limit: int = 100, user: dict = Depends(ALL)):
    q = {}
    if start or end:
        s, e, _, _ = parse_range("custom", start or "2000-01-01", end or "2999-12-31")
        q["date_dt"] = {"$gte": s, "$lt": e}
    items = await db.purchases.find(q).sort("created_at", -1).limit(min(limit, 200)).to_list(200)
    return serialize(items)


@router.post("/purchases")
async def create_purchase(body: PurchaseIn, user: dict = Depends(STAFF_OPS)):
    try:
        date_dt = datetime.fromisoformat(body.date).replace(tzinfo=WIB)
    except Exception:
        raise HTTPException(status_code=400, detail="Tanggal tidak valid")

    supplier_name = body.supplier_name.strip()
    if body.supplier_id:
        sup = await db.suppliers.find_one({"_id": rid(body.supplier_id)})
        if not sup:
            raise HTTPException(status_code=400, detail="Supplier tidak ditemukan")
        supplier_name = sup["name"]
    if not supplier_name:
        raise HTTPException(status_code=400, detail="Supplier wajib diisi")

    ing_ids = [rid(i.ingredient_id) for i in body.items]
    ings = {str(g["_id"]): g for g in await db.ingredients.find({"_id": {"$in": ing_ids}}).to_list(200)}

    items_out = []
    total = 0.0
    for i in body.items:
        ing = ings.get(i.ingredient_id)
        if not ing:
            raise HTTPException(status_code=400, detail="Bahan tidak ditemukan")
        line = round2(float(i.qty) * float(i.unit_price))
        total += line
        items_out.append({"ingredient_id": i.ingredient_id, "name": ing["name"],
                          "qty": float(i.qty), "unit": ing.get("unit", ""),
                          "unit_price": round2(float(i.unit_price)), "total": line})
    total = round2(total)
    purchase_no = f"PO-{await next_number('purchase'):05d}"

    doc = {
        "purchase_no": purchase_no, "date": body.date, "date_dt": date_dt,
        "supplier_id": body.supplier_id or None, "supplier_name": supplier_name,
        "items": items_out, "total": total,
        "payment_status": body.payment_status, "payment_method": body.payment_method if body.payment_status == "paid" else None,
        "notes": body.notes.strip(),
        "created_by_id": user["id"], "created_by_name": user.get("name", ""),
        "created_at": now_utc(), "updated_at": now_utc(), "voided": False,
    }
    res = await db.purchases.insert_one(doc)

    # Update stock + weighted-average cost
    for i in items_out:
        iid = ObjectId(i["ingredient_id"])
        ing = ings[i["ingredient_id"]]
        old_stock = float(ing.get("stock", 0))
        old_cost = float(ing.get("cost_per_unit", 0))
        new_stock = old_stock + i["qty"]
        new_cost = round2(((old_stock * old_cost) + (i["qty"] * i["unit_price"])) / new_stock) if new_stock > 0 else i["unit_price"]
        await db.ingredients.update_one({"_id": iid},
                                        {"$set": {"stock": round2(new_stock), "cost_per_unit": new_cost,
                                                  "purchase_price": i["unit_price"], "updated_at": now_utc()}})
        await db.inventory_transactions.insert_one({
            "ingredient_id": i["ingredient_id"], "ingredient_name": i["name"],
            "type": "purchase", "qty": i["qty"], "unit": i["unit"],
            "note": f"Pembelian {purchase_no} ({supplier_name}) - Rp{i['unit_price']:,.0f}/unit".replace(",", "."),
            "ref_id": str(res.inserted_id), "created_by_id": user["id"],
            "created_by_name": user.get("name", ""), "created_at": date_dt,
        })

    # Financial record: cash out when paid in cash
    if body.payment_status == "paid":
        if body.payment_method == "cash":
            await record_cash_tx("purchase", -total, f"Pembelian {purchase_no} ({supplier_name})",
                                 "purchase", str(res.inserted_id), user=user, created_at=date_dt)

    doc["_id"] = res.inserted_id
    return serialize(doc)


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------
class ExpenseIn(BaseModel):
    date: str
    category: str
    amount: float = Field(gt=0)
    description: str = ""
    payment_method: str = "cash"


@router.get("/expenses")
async def list_expenses(start: str = "", end: str = "", category: str = "", limit: int = 200,
                        user: dict = Depends(require_roles("owner", "cashier"))):
    q = {"voided": {"$ne": True}}
    if start or end:
        s, e, _, _ = parse_range("custom", start or "2000-01-01", end or "2999-12-31")
        q["date_dt"] = {"$gte": s, "$lt": e}
    if category:
        q["category"] = category
    items = await db.expenses.find(q).sort("date_dt", -1).limit(min(limit, 300)).to_list(300)
    return serialize(items)


@router.post("/expenses")
async def create_expense(body: ExpenseIn, user: dict = Depends(require_roles("owner", "cashier"))):
    settings = await get_settings()
    cats = settings.get("expense_categories", [])
    if body.category not in cats:
        raise HTTPException(status_code=400, detail="Kategori tidak valid")
    try:
        date_dt = datetime.fromisoformat(body.date).replace(tzinfo=WIB)
    except Exception:
        raise HTTPException(status_code=400, detail="Tanggal tidak valid")
    doc = {
        "date": body.date, "date_dt": date_dt, "category": body.category,
        "amount": round2(float(body.amount)), "description": body.description.strip(),
        "payment_method": body.payment_method, "voided": False,
        "created_by_id": user["id"], "created_by_name": user.get("name", ""),
        "created_at": now_utc(), "updated_at": now_utc(),
    }
    res = await db.expenses.insert_one(doc)
    if body.payment_method == "cash":
        await record_cash_tx("expense", -round2(float(body.amount)), f"Pengeluaran {body.category}",
                             "expense", str(res.inserted_id), user=user, created_at=date_dt)
    doc["_id"] = res.inserted_id
    return serialize(doc)


@router.post("/expenses/{expense_id}/void")
async def void_expense(expense_id: str, user: dict = Depends(OWNER)):
    exp = await db.expenses.find_one({"_id": rid(expense_id)})
    if not exp or exp.get("voided"):
        raise HTTPException(status_code=404, detail="Pengeluaran tidak ditemukan")
    await db.expenses.update_one({"_id": exp["_id"]}, {"$set": {"voided": True, "updated_at": now_utc()}})
    if exp.get("payment_method") == "cash":
        await record_cash_tx("expense_void", float(exp["amount"]), f"Batal pengeluaran {exp['category']}",
                             "expense", exp_id, user=user)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Cash register
# ---------------------------------------------------------------------------
class OpenSessionIn(BaseModel):
    opening_cash: float = Field(ge=0)


class CloseSessionIn(BaseModel):
    actual_cash: float = Field(ge=0)


class CashTxIn(BaseModel):
    type: str  # addition | withdrawal
    amount: float = Field(gt=0)
    note: str = ""


@router.get("/cash/status")
async def cash_status(user: dict = Depends(CASH_ROLES)):
    balance = await cash_balance()
    session = await db.cash_sessions.find_one({"status": "open"}, sort=[("opened_at", -1)])
    today = now_utc().astimezone(WIB).date().isoformat()
    expected = balance
    session_out = None
    if session:
        pipeline = [{"$match": {"session_id": str(session["_id"])}},
                    {"$group": {"_id": None, "total": {"$sum": "$amount"}}}]
        agg = await db.cash_transactions.aggregate(pipeline).to_list(1)
        moved = agg[0]["total"] if agg else 0
        session_out = serialize(session)
        session_out["moved_total"] = round2(moved)
        session_out["expected_cash"] = round2(float(session["opening_cash"]) + moved)
    return {"balance": balance, "session": session_out, "today": today}


@router.post("/cash/sessions/open")
async def open_session(body: OpenSessionIn, user: dict = Depends(CASH_ROLES)):
    existing = await db.cash_sessions.find_one({"status": "open"})
    if existing:
        raise HTTPException(status_code=400, detail="Masih ada shift yang terbuka")
    doc = {"opening_cash": round2(body.opening_cash), "opened_by_id": user["id"],
           "opened_by_name": user.get("name", ""), "opened_at": now_utc(),
           "status": "open", "closed_at": None, "closing_cash": None,
           "expected_cash": None, "difference": None, "created_at": now_utc()}
    res = await db.cash_sessions.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize(doc)


@router.post("/cash/sessions/{session_id}/close")
async def close_session(session_id: str, body: CloseSessionIn, user: dict = Depends(CASH_ROLES)):
    session = await db.cash_sessions.find_one({"_id": rid(session_id), "status": "open"})
    if not session:
        raise HTTPException(status_code=404, detail="Shift tidak ditemukan / sudah tutup")
    pipeline = [{"$match": {"session_id": session_id}}, {"$group": {"_id": None, "total": {"$sum": "$amount"}}}]
    agg = await db.cash_transactions.aggregate(pipeline).to_list(1)
    moved = agg[0]["total"] if agg else 0
    expected = round2(float(session["opening_cash"]) + moved)
    diff = round2(float(body.actual_cash) - expected)
    await db.cash_sessions.update_one({"_id": session["_id"]}, {"$set": {
        "status": "closed", "closed_at": now_utc(), "closing_cash": round2(body.actual_cash),
        "expected_cash": expected, "difference": diff, "closed_by_name": user.get("name", ""),
        "updated_at": now_utc()}})
    return {"expected_cash": expected, "actual_cash": round2(body.actual_cash), "difference": diff}


@router.post("/cash/transactions")
async def create_cash_tx(body: CashTxIn, user: dict = Depends(CASH_ROLES)):
    if body.type not in ("addition", "withdrawal"):
        raise HTTPException(status_code=400, detail="Jenis tidak valid")
    session = await db.cash_sessions.find_one({"status": "open"})
    amount = body.amount if body.type == "addition" else -body.amount
    await record_cash_tx(body.type, amount, body.note.strip() or ("Setoran kas" if body.type == "addition" else "Penarikan kas"),
                         "cash_manual", None, user=user)
    return {"ok": True, "balance": await cash_balance()}


@router.get("/cash/transactions")
async def list_cash_tx(session_id: str = "", limit: int = 100, user: dict = Depends(CASH_ROLES)):
    q = {}
    if session_id:
        q["session_id"] = session_id
    items = await db.cash_transactions.find(q).sort("created_at", -1).limit(min(limit, 300)).to_list(300)
    return serialize(items)
