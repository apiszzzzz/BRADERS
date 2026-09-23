"""Customers, promotions, business settings."""
from datetime import datetime
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import WIB, db, now_utc, parse_range, require_roles, rid, round2, serialize
from services import DEFAULT_SETTINGS, get_settings

router = APIRouter(tags=["misc"])

OWNER = require_roles("owner")
SALES_ROLES = require_roles("owner", "cashier")
ALL = require_roles("owner", "cashier", "staff")


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------
class CustomerIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    phone: str = ""
    notes: str = ""


@router.get("/customers")
async def list_customers(search: str = "", user: dict = Depends(SALES_ROLES)):
    q = {}
    if search:
        q["$or"] = [{"name_lower": {"$regex": search.strip().lower(), "$options": "i"}},
                    {"phone": {"$regex": search.strip(), "$options": "i"}}]
    items = await db.customers.find(q).sort("total_spending", -1).limit(300).to_list(300)
    return serialize(items)


@router.post("/customers")
async def create_customer(body: CustomerIn, user: dict = Depends(SALES_ROLES)):
    doc = {"name": body.name.strip(), "name_lower": body.name.strip().lower(),
           "phone": body.phone.strip(), "notes": body.notes.strip(),
           "total_orders": 0, "total_spending": 0, "last_purchase": None,
           "active": True, "created_at": now_utc(), "updated_at": now_utc()}
    res = await db.customers.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize(doc)


@router.patch("/customers/{customer_id}")
async def update_customer(customer_id: str, body: CustomerIn, user: dict = Depends(SALES_ROLES)):
    patch = {"name": body.name.strip(), "name_lower": body.name.strip().lower(),
             "phone": body.phone.strip(), "notes": body.notes.strip(), "updated_at": now_utc()}
    res = await db.customers.find_one_and_update({"_id": rid(customer_id)}, {"$set": patch})
    if not res:
        raise HTTPException(status_code=404, detail="Pelanggan tidak ditemukan")
    res.update(patch)
    return serialize(res)


@router.get("/customers/{customer_id}")
async def customer_detail(customer_id: str, user: dict = Depends(SALES_ROLES)):
    c = await db.customers.find_one({"_id": rid(customer_id)})
    if not c:
        raise HTTPException(status_code=404, detail="Pelanggan tidak ditemukan")
    history = await db.sales.find({"customer.id": customer_id}).sort("created_at", -1).limit(50).to_list(50)
    c["history"] = history
    return serialize(c)


# ---------------------------------------------------------------------------
# Promotions
# ---------------------------------------------------------------------------
class PromoIn(BaseModel):
    code: str = Field(min_length=2, max_length=30)
    discount_type: str = "percent"  # percent | fixed
    value: float = Field(gt=0)
    start_date: str
    end_date: str
    min_purchase: float = Field(default=0, ge=0)
    max_discount: Optional[float] = Field(default=None, ge=0)
    active: bool = True


@router.get("/promotions")
async def list_promotions(user: dict = Depends(require_roles("owner", "cashier"))):
    items = await db.promotions.find({}).sort("created_at", -1).to_list(200)
    return serialize(items)


@router.post("/promotions")
async def create_promotion(body: PromoIn, user: dict = Depends(OWNER)):
    code = body.code.strip().upper().replace(" ", "")
    if await db.promotions.find_one({"code": code}):
        raise HTTPException(status_code=409, detail="Kode promo sudah ada")
    if body.discount_type not in ("percent", "fixed"):
        raise HTTPException(status_code=400, detail="Jenis diskon tidak valid")
    if body.discount_type == "percent" and body.value > 100:
        raise HTTPException(status_code=400, detail="Diskon persen maksimal 100")
    doc = {"code": code, "discount_type": body.discount_type, "value": float(body.value),
           "start_date": body.start_date, "end_date": body.end_date,
           "min_purchase": float(body.min_purchase),
           "max_discount": float(body.max_discount) if body.max_discount else None,
           "active": body.active, "uses": 0, "revenue": 0, "discount_cost": 0,
           "created_by_id": user["id"], "created_by_name": user.get("name", ""),
           "created_at": now_utc(), "updated_at": now_utc()}
    res = await db.promotions.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize(doc)


@router.patch("/promotions/{promo_id}")
async def update_promotion(promo_id: str, body: PromoIn, user: dict = Depends(OWNER)):
    patch = {"code": body.code.strip().upper().replace(" ", ""), "discount_type": body.discount_type,
             "value": float(body.value), "start_date": body.start_date, "end_date": body.end_date,
             "min_purchase": float(body.min_purchase),
             "max_discount": float(body.max_discount) if body.max_discount else None,
             "active": body.active, "updated_at": now_utc()}
    res = await db.promotions.find_one_and_update({"_id": rid(promo_id)}, {"$set": patch})
    if not res:
        raise HTTPException(status_code=404, detail="Promo tidak ditemukan")
    res.update(patch)
    return serialize(res)


@router.post("/promotions/{promo_id}/toggle")
async def toggle_promotion(promo_id: str, user: dict = Depends(OWNER)):
    p = await db.promotions.find_one({"_id": rid(promo_id)})
    if not p:
        raise HTTPException(status_code=404, detail="Promo tidak ditemukan")
    await db.promotions.update_one({"_id": p["_id"]}, {"$set": {"active": not p.get("active", True), "updated_at": now_utc()}})
    return {"ok": True, "active": not p.get("active", True)}


@router.post("/promotions/validate")
async def validate_promo(code: str = "", subtotal: float = 0, user: dict = Depends(SALES_ROLES)):
    from routers.sales import validate_promo_code
    promo = await validate_promo_code(code.strip().upper(), float(subtotal))
    from services import compute_discount
    discount = compute_discount(float(subtotal), promo["discount_type"], float(promo["value"]),
                                float(promo["max_discount"]) if promo.get("max_discount") else None)
    return {"code": promo["code"], "discount_amount": discount}


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
class SettingsIn(BaseModel):
    business_name: Optional[str] = None
    tagline: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    logo_url: Optional[str] = None
    receipt_footer: Optional[str] = None
    apply_tax: Optional[bool] = None
    tax_percent: Optional[float] = None
    qris_fee_percent: Optional[float] = None
    allow_negative_stock: Optional[bool] = None
    initial_cash: Optional[float] = None
    payment_methods: Optional[dict] = None
    expense_categories: Optional[list[str]] = None
    units: Optional[list[str]] = None


@router.get("/settings")
async def get_settings_route(user: dict = Depends(require_roles("owner", "cashier"))):
    s = await get_settings()
    return serialize(s)


@router.patch("/settings")
async def update_settings(body: SettingsIn, user: dict = Depends(OWNER)):
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(status_code=400, detail="Tidak ada perubahan")
    patch["updated_at"] = now_utc()
    patch["updated_by"] = user.get("name", "")
    await get_settings()  # ensure exists
    await db.business_settings.update_one({}, {"$set": patch})
    s = await get_settings()
    return serialize(s)


@router.post("/settings/reset-demo")
async def reset_demo(user: dict = Depends(OWNER)):
    from seed import seed_demo_data
    await seed_demo_data(force=True)
    return {"ok": True, "message": "Data demo berhasil dibuat ulang"}
