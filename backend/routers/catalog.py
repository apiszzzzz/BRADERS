"""Catalog: categories, products (+recipe/BOM), ingredients, suppliers."""
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, now_utc, require_roles, rid, round2, serialize
from services import recompute_hpp_for_ingredient, recompute_product_hpp

router = APIRouter(tags=["catalog"])

OWNER = require_roles("owner")
ALL = require_roles("owner", "cashier", "staff")
SALES_ROLES = require_roles("owner", "cashier")
OPS_ROLES = require_roles("owner", "staff", "cashier")


def slug(s: str) -> str:
    return s.strip().lower().replace(" ", "-")


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------
class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=50)


@router.get("/categories")
async def list_categories(user: dict = Depends(ALL)):
    cats = await db.categories.find({"deleted": {"$ne": True}}).sort("name", 1).to_list(100)
    return serialize(cats)


@router.post("/categories")
async def create_category(body: CategoryIn, user: dict = Depends(OWNER)):
    if await db.categories.find_one({"name_lower": body.name.strip().lower(), "deleted": {"$ne": True}}):
        raise HTTPException(status_code=409, detail="Kategori sudah ada")
    doc = {"name": body.name.strip(), "name_lower": body.name.strip().lower(), "deleted": False,
           "created_at": now_utc(), "updated_at": now_utc()}
    res = await db.categories.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize(doc)


@router.delete("/categories/{category_id}")
async def delete_category(category_id: str, user: dict = Depends(OWNER)):
    used = await db.products.count_documents({"category_id": category_id, "deleted": {"$ne": True}})
    if used:
        raise HTTPException(status_code=400, detail=f"Kategori dipakai {used} produk")
    await db.categories.update_one({"_id": rid(category_id)}, {"$set": {"deleted": True, "updated_at": now_utc()}})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------
class RecipeItemIn(BaseModel):
    ingredient_id: str
    qty: float = Field(gt=0)


class ProductIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    category_id: str
    description: str = ""
    price: float = Field(ge=0)
    image_url: str = ""
    active: bool = True
    recipe: list[RecipeItemIn] = []


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    category_id: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    image_url: Optional[str] = None
    active: Optional[bool] = None
    recipe: Optional[list[RecipeItemIn]] = None


async def _save_recipe(product_id: ObjectId, recipe: list[RecipeItemIn]):
    ings = await db.ingredients.find({"_id": {"$in": [rid(i.ingredient_id) for i in recipe]}}).to_list(100)
    ing_map = {str(g["_id"]): g for g in ings}
    items = []
    for i in recipe:
        ing = ing_map.get(str(rid(i.ingredient_id)))
        if not ing:
            raise HTTPException(status_code=400, detail="Bahan baku tidak ditemukan")
        items.append({"ingredient_id": i.ingredient_id, "name": ing["name"],
                      "qty": float(i.qty), "unit": ing.get("unit", "")})
    await db.recipes.update_one(
        {"product_id": str(product_id)},
        {"$set": {"items": items, "updated_at": now_utc()},
         "$setOnInsert": {"created_at": now_utc()}},
        upsert=True,
    )


@router.get("/products")
async def list_products(search: str = "", category_id: str = "", active_only: bool = False,
                        user: dict = Depends(ALL)):
    q = {"deleted": {"$ne": True}}
    if active_only:
        q["active"] = True
    if search:
        q["name_lower"] = {"$regex": search.strip().lower(), "$options": "i"}
    if category_id:
        q["category_id"] = category_id
    products = await db.products.find(q).sort("name", 1).to_list(500)
    out = []
    for p in products:
        p["category_name"] = None
        if p.get("category_id"):
            cat = await db.categories.find_one({"_id": rid(p["category_id"])})
            p["category_name"] = cat.get("name") if cat else None
        out.append(serialize(p))
    return out


@router.get("/products/{product_id}")
async def get_product(product_id: str, user: dict = Depends(ALL)):
    p = await db.products.find_one({"_id": rid(product_id), "deleted": {"$ne": True}})
    if not p:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    recipe = await db.recipes.find_one({"product_id": product_id})
    p["recipe"] = serialize(recipe.get("items", [])) if recipe else []
    if p.get("category_id"):
        cat = await db.categories.find_one({"_id": rid(p["category_id"])})
        p["category_name"] = cat.get("name") if cat else None
    return serialize(p)


@router.post("/products")
async def create_product(body: ProductIn, user: dict = Depends(OWNER)):
    cat = await db.categories.find_one({"_id": rid(body.category_id)})
    if not cat:
        raise HTTPException(status_code=400, detail="Kategori tidak ditemukan")
    doc = {
        "name": body.name.strip(), "name_lower": body.name.strip().lower(),
        "category_id": body.category_id, "category_name": cat["name"],
        "description": body.description.strip(), "price": round2(body.price),
        "image_url": body.image_url.strip(), "active": body.active,
        "est_hpp": 0, "est_gross_profit": 0, "gross_margin": 0,
        "deleted": False, "created_at": now_utc(), "updated_at": now_utc(),
    }
    res = await db.products.insert_one(doc)
    pid = res.inserted_id
    if body.recipe:
        await _save_recipe(pid, body.recipe)
    await recompute_product_hpp(pid)
    return await get_product(str(pid), user)


@router.patch("/products/{product_id}")
async def update_product(product_id: str, body: ProductUpdate, user: dict = Depends(OWNER)):
    pid = rid(product_id)
    p = await db.products.find_one({"_id": pid, "deleted": {"$ne": True}})
    if not p:
        raise HTTPException(status_code=404, detail="Produk tidak ditemukan")
    patch = {"updated_at": now_utc()}
    if body.name is not None:
        patch["name"] = body.name.strip()
        patch["name_lower"] = body.name.strip().lower()
    if body.category_id is not None:
        cat = await db.categories.find_one({"_id": rid(body.category_id)})
        if not cat:
            raise HTTPException(status_code=400, detail="Kategori tidak ditemukan")
        patch["category_id"] = body.category_id
        patch["category_name"] = cat["name"]
    for f in ("description", "image_url", "active"):
        if getattr(body, f) is not None:
            patch[f] = getattr(body, f)
    if body.price is not None:
        patch["price"] = round2(body.price)
    await db.products.update_one({"_id": pid}, {"$set": patch})
    if body.recipe is not None:
        await _save_recipe(pid, body.recipe)
    await recompute_product_hpp(pid)
    return await get_product(product_id, user)


@router.delete("/products/{product_id}")
async def delete_product(product_id: str, user: dict = Depends(OWNER)):
    # Soft delete: financial history must stay intact.
    await db.products.update_one({"_id": rid(product_id)},
                                 {"$set": {"deleted": True, "active": False, "updated_at": now_utc()}})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Ingredients
# ---------------------------------------------------------------------------
class IngredientIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    unit: str
    purchase_price: float = Field(ge=0)
    cost_per_unit: Optional[float] = None
    stock: float = 0
    min_stock: float = 0
    supplier: str = ""
    expires_at: Optional[str] = None


@router.get("/ingredients")
async def list_ingredients(search: str = "", user: dict = Depends(ALL)):
    q = {"deleted": {"$ne": True}}
    if search:
        q["name_lower"] = {"$regex": search.strip().lower(), "$options": "i"}
    items = await db.ingredients.find(q).sort("name", 1).to_list(500)
    for i in items:
        i["stock_value"] = round2(float(i.get("stock", 0)) * float(i.get("cost_per_unit", 0)))
        i["low"] = float(i.get("stock", 0)) <= float(i.get("min_stock", 0))
    total_value = round2(sum(i["stock_value"] for i in items))
    return {"items": serialize(items), "total_value": total_value,
            "low_count": sum(1 for i in items if i["low"])}


@router.post("/ingredients")
async def create_ingredient(body: IngredientIn, user: dict = Depends(OPS_ROLES)):
    doc = {"name": body.name.strip(), "name_lower": body.name.strip().lower(),
           "unit": body.unit, "purchase_price": round2(body.purchase_price),
           "cost_per_unit": round2(body.cost_per_unit if body.cost_per_unit is not None else body.purchase_price),
           "stock": float(body.stock), "min_stock": float(body.min_stock),
           "supplier": body.supplier.strip(), "expires_at": body.expires_at,
           "deleted": False, "created_at": now_utc(), "updated_at": now_utc()}
    res = await db.ingredients.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize(doc)


@router.patch("/ingredients/{ingredient_id}")
async def update_ingredient(ingredient_id: str, body: IngredientIn, user: dict = Depends(OPS_ROLES)):
    iid = rid(ingredient_id)
    old = await db.ingredients.find_one({"_id": iid})
    if not old:
        raise HTTPException(status_code=404, detail="Bahan tidak ditemukan")
    patch = {"name": body.name.strip(), "name_lower": body.name.strip().lower(),
             "unit": body.unit, "purchase_price": round2(body.purchase_price),
             "cost_per_unit": round2(body.cost_per_unit if body.cost_per_unit is not None else body.purchase_price),
             "stock": float(body.stock), "min_stock": float(body.min_stock),
             "supplier": body.supplier.strip(), "expires_at": body.expires_at,
             "updated_at": now_utc()}
    await db.ingredients.update_one({"_id": iid}, {"$set": patch})
    # Stock edits through the edit form are logged as adjustments.
    old_stock = float(old.get("stock", 0))
    delta = float(body.stock) - old_stock
    if abs(delta) > 1e-9:
        await db.inventory_transactions.insert_one({
            "ingredient_id": ingredient_id, "ingredient_name": patch["name"], "type": "adjust",
            "qty": round2(delta), "unit": patch["unit"], "note": "Penyesuaian stok via edit bahan",
            "ref_id": None, "created_by_id": user["id"], "created_by_name": user.get("name", ""),
            "created_at": now_utc()})
    price_changed = abs(round2(body.cost_per_unit if body.cost_per_unit is not None else body.purchase_price)
                        - float(old.get("cost_per_unit", 0))) > 1e-9
    if price_changed:
        await recompute_hpp_for_ingredient(ingredient_id)
    doc = await db.ingredients.find_one({"_id": iid})
    return serialize(doc)


@router.delete("/ingredients/{ingredient_id}")
async def delete_ingredient(ingredient_id: str, user: dict = Depends(OWNER)):
    used = await db.recipes.count_documents({"items.ingredient_id": ingredient_id})
    if used:
        raise HTTPException(status_code=400, detail=f"Bahan dipakai di {used} resep produk")
    await db.ingredients.update_one({"_id": rid(ingredient_id)},
                                   {"$set": {"deleted": True, "updated_at": now_utc()}})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Suppliers
# ---------------------------------------------------------------------------
class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    phone: str = ""
    notes: str = ""


@router.get("/suppliers")
async def list_suppliers(user: dict = Depends(ALL)):
    items = await db.suppliers.find({"deleted": {"$ne": True}}).sort("name", 1).to_list(200)
    return serialize(items)


@router.post("/suppliers")
async def create_supplier(body: SupplierIn, user: dict = Depends(OPS_ROLES)):
    doc = {"name": body.name.strip(), "name_lower": body.name.strip().lower(),
           "phone": body.phone.strip(), "notes": body.notes.strip(),
           "deleted": False, "created_at": now_utc(), "updated_at": now_utc()}
    res = await db.suppliers.insert_one(doc)
    doc["_id"] = res.inserted_id
    return serialize(doc)
