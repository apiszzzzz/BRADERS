"""Demo data seeding — clearly marked as demo (settings.demo_mode = True)."""
import random
from datetime import datetime, timedelta, timezone

from bson import ObjectId

from core import WIB, db, hash_password, next_order_no, now_utc, round2
from services import finalize_sale, get_settings, record_cash_tx, recompute_product_hpp

DEMO_USERS = [
    {"name": "Owner BRADERS", "email": "owner@braders.id", "role": "owner"},
    {"name": "Kasir BRADERS", "email": "kasir@braders.id", "role": "cashier"},
    {"name": "Staff BRADERS", "email": "staff@braders.id", "role": "staff"},
]
DEMO_PASSWORD = "braders123"

INGREDIENTS = [
    # name, unit, cost_per_unit, stock, min_stock, supplier
    ("Tepung Terigu", "gram", 14, 80000, 5000, "Sumber Rezeki"),
    ("Gula Pasir", "gram", 16, 30000, 3000, "Sumber Rezeki"),
    ("Gula Kayu Manis", "gram", 80, 6000, 800, "Sumber Rezeki"),
    ("Mentega/Margarin", "gram", 30, 18000, 1500, "Dapur Sejahtera"),
    ("Telur", "butir", 2200, 400, 50, "Dapur Sejahtera"),
    ("Saus Cokelat", "ml", 25, 15000, 1500, "Rasa Nusantara"),
    ("Saus Vanila", "ml", 28, 6000, 1000, "Rasa Nusantara"),
    ("Saus Matcha", "ml", 45, 5000, 800, "Rasa Nusantara"),
    ("Saus Tiramisu", "ml", 50, 4000, 800, "Rasa Nusantara"),
    ("Minyak Goreng", "ml", 18, 25000, 2500, "Dapur Sejahtera"),
    ("Air", "ml", 0, 50000, 5000, "-"),
    ("Food Box", "pcs", 1500, 600, 80, "Kemasan Untung"),
    ("Cup Saus", "pcs", 350, 1200, 150, "Kemasan Untung"),
    ("Paper Bag", "pcs", 900, 900, 100, "Kemasan Untung"),
    ("Stiker BRADERS", "pcs", 250, 1500, 200, "Kemasan Untung"),
]

CATEGORIES = ["Mini Bites", "Classic", "Share Box"]

PRODUCTS = [
    # name, category, price, recipe: [(ingredient, qty per 1 porsi)]
    ("Mini Bites 12K", "Mini Bites", 12000, [("Tepung Terigu", 100), ("Gula Pasir", 15), ("Mentega/Margarin", 15),
                                             ("Telur", 0.3), ("Minyak Goreng", 25), ("Gula Kayu Manis", 4),
                                             ("Saus Cokelat", 30), ("Cup Saus", 1), ("Paper Bag", 1), ("Stiker BRADERS", 1)]),
    ("Mini Bites 15K", "Mini Bites", 15000, [("Tepung Terigu", 140), ("Gula Pasir", 20), ("Mentega/Margarin", 20),
                                             ("Telur", 0.5), ("Minyak Goreng", 30), ("Gula Kayu Manis", 5),
                                             ("Saus Cokelat", 40), ("Cup Saus", 2), ("Paper Bag", 1), ("Stiker BRADERS", 1)]),
    ("Mini Bites 20K", "Mini Bites", 20000, [("Tepung Terigu", 180), ("Gula Pasir", 25), ("Mentega/Margarin", 25),
                                             ("Telur", 0.8), ("Minyak Goreng", 40), ("Gula Kayu Manis", 7),
                                             ("Saus Matcha", 45), ("Cup Saus", 3), ("Paper Bag", 1), ("Stiker BRADERS", 1)]),
    ("Classic 15K", "Classic", 15000, [("Tepung Terigu", 150), ("Gula Pasir", 25), ("Mentega/Margarin", 25),
                                       ("Telur", 0.7), ("Minyak Goreng", 40), ("Gula Kayu Manis", 6),
                                       ("Saus Cokelat", 40), ("Cup Saus", 2), ("Paper Bag", 1), ("Stiker BRADERS", 1)]),
    ("Classic 18K", "Classic", 18000, [("Tepung Terigu", 180), ("Gula Pasir", 30), ("Mentega/Margarin", 30),
                                       ("Telur", 0.8), ("Minyak Goreng", 50), ("Gula Kayu Manis", 8),
                                       ("Saus Tiramisu", 45), ("Cup Saus", 2), ("Paper Bag", 1), ("Stiker BRADERS", 1)]),
    ("Classic 20K", "Classic", 20000, [("Tepung Terigu", 220), ("Gula Pasir", 35), ("Mentega/Margarin", 35),
                                       ("Telur", 1), ("Minyak Goreng", 55), ("Gula Kayu Manis", 10),
                                       ("Saus Vanila", 50), ("Cup Saus", 3), ("Paper Bag", 1), ("Stiker BRADERS", 1)]),
    ("Share Box 30K", "Share Box", 30000, [("Tepung Terigu", 350), ("Gula Pasir", 60), ("Mentega/Margarin", 60),
                                           ("Telur", 1.5), ("Minyak Goreng", 100), ("Gula Kayu Manis", 15),
                                           ("Saus Cokelat", 80), ("Food Box", 1), ("Cup Saus", 3), ("Stiker BRADERS", 1)]),
]

EXPENSE_SEED = [
    ("Sewa", 1200000, "Sewa lokasi bulan ini", "transfer", 12),
    ("Listrik", 285000, "Token listrik gerobak", "cash", 9),
    ("Gas", 150000, "Gas kaleng 12kg", "cash", 7),
    ("Transportasi", 90000, "Bensin + parkir keliling", "cash", 5),
    ("Marketing", 250000, "Boost IG promo weekend", "qris", 4),
    ("Packaging", 320000, "Cashbon paper bag & cup saus", "cash", 3),
    ("Biaya Platform", 45000, "Fee QRIS settlement", "cash", 2),
    ("Lainnya", 60000, "Es batu & air galon", "cash", 1),
]


async def seed_demo_data(force: bool = False):
    """Idempotent: seeds only what is missing. force=True recreates demo sales/expenses."""
    # 1. Users (never duplicated)
    for u in DEMO_USERS:
        if not await db.users.find_one({"email": u["email"]}):
            await db.users.insert_one({
                "name": u["name"], "email": u["email"], "role": u["role"],
                "password_hash": hash_password(DEMO_PASSWORD), "active": True,
                "created_at": now_utc(), "updated_at": now_utc(),
            })

    # 2. Settings
    settings = await get_settings()
    if not settings.get("business_name") or settings.get("business_name") == "BRADERS" and not settings.get("address"):
        await db.business_settings.update_one({}, {"$set": {
            "business_name": "BRADERS", "tagline": "Churros Lezatoss",
            "address": "Jl. Merdeka No. 10, Bandung", "phone": "0812-3456-7890",
            "demo_mode": True, "updated_at": now_utc()}})
        settings = await get_settings()

    # 3. Catalog (only if products are empty)
    if await db.products.count_documents({}) == 0:
        cat_ids = {}
        for cname in CATEGORIES:
            res = await db.categories.insert_one({"name": cname, "name_lower": cname.lower(),
                                                  "deleted": False, "created_at": now_utc(), "updated_at": now_utc()})
            cat_ids[cname] = str(res.inserted_id)

        ing_ids = {}
        for name, unit, cost, stock, min_stock, supplier in INGREDIENTS:
            res = await db.ingredients.insert_one({
                "name": name, "name_lower": name.lower(), "unit": unit,
                "purchase_price": cost, "cost_per_unit": cost, "stock": float(stock),
                "min_stock": float(min_stock), "supplier": supplier, "expires_at": None,
                "deleted": False, "created_at": now_utc(), "updated_at": now_utc()})
            ing_ids[name] = str(res.inserted_id)

        img_urls = {
            "Mini Bites": "https://images.pexels.com/photos/36361401/pexels-photo-36361401.jpeg?auto=compress&cs=tinysrgb&w=600",
            "Classic": "https://images.unsplash.com/photo-1767489386700-cb3dbcbab13d?auto=compress&cs=tinysrgb&w=600",
            "Share Box": "https://images.pexels.com/photos/21792158/pexels-photo-21792158.jpeg?auto=compress&cs=tinysrgb&w=600",
        }
        for name, cat, price, recipe in PRODUCTS:
            pid = (await db.products.insert_one({
                "name": name, "name_lower": name.lower(), "category_id": cat_ids[cat],
                "category_name": cat, "description": f"Churros {cat} BRADERS, gurih renyah dengan topping lezat.",
                "price": float(price), "image_url": img_urls[cat], "active": True,
                "est_hpp": 0, "est_gross_profit": 0, "gross_margin": 0,
                "deleted": False, "created_at": now_utc(), "updated_at": now_utc(),
            })).inserted_id
            await db.recipes.insert_one({
                "product_id": str(pid),
                "items": [{"ingredient_id": ing_ids[i], "name": i, "qty": float(q),
                           "unit": next(u for n, u, *_ in INGREDIENTS if n == i)} for i, q in recipe],
                "created_at": now_utc(), "updated_at": now_utc()})
            await recompute_product_hpp(pid)

    # 4. Suppliers
    if await db.suppliers.count_documents({}) == 0:
        for s in [("Sumber Rezeki", "0812-1111-2222"), ("Dapur Sejahtera", "0813-3333-4444"),
                  ("Rasa Nusantara", "0815-5555-6666"), ("Kemasan Untung", "0817-7777-8888")]:
            await db.suppliers.insert_one({"name": s[0], "name_lower": s[0].lower(), "phone": s[1],
                                           "notes": "", "deleted": False, "created_at": now_utc(), "updated_at": now_utc()})

    # 5. Customers
    cust_ids = []
    if await db.customers.count_documents({}) == 0:
        for c in [("Rina Wulandari", "0812-9000-1111", "Suka matcha"), ("Dimas Prakoso", "0813-8000-2222", ""),
                  ("Ayu Lestari", "0815-7000-3333", "Pelanggan tetap kantor dekat")]:
            res = await db.customers.insert_one({
                "name": c[0], "name_lower": c[0].lower(), "phone": c[1], "notes": c[2],
                "total_orders": 0, "total_spending": 0, "last_purchase": None,
                "active": True, "created_at": now_utc(), "updated_at": now_utc()})
            cust_ids.append(str(res.inserted_id))

    # 6. Promotion
    if await db.promotions.count_documents({}) == 0:
        today = now_utc().astimezone(WIB).date()
        await db.promotions.insert_one({
            "code": "LEZATOSS10", "discount_type": "percent", "value": 10,
            "start_date": (today - timedelta(days=7)).isoformat(),
            "end_date": (today + timedelta(days=30)).isoformat(),
            "min_purchase": 30000, "max_discount": 15000, "active": True,
            "uses": 0, "revenue": 0, "discount_cost": 0,
            "created_by_name": "Owner BRADERS", "created_at": now_utc(), "updated_at": now_utc()})

    # 7. Demo sales / expenses / purchases — only once
    demo_sales_exist = await db.sales.count_documents({}) > 0
    if force or not demo_sales_exist:
        await _seed_transactions(cust_ids)


async def _seed_transactions(cust_ids: list):
    products = await db.products.find({"active": True}).to_list(50)
    if not products:
        return
    owner = await db.users.find_one({"role": "owner"})
    cashier = await db.users.find_one({"role": "cashier"})
    owner = owner or cashier
    random.seed(42)

    today = now_utc().astimezone(WIB).date()
    for day_offset in range(13, -1, -1):
        day = today - timedelta(days=day_offset)
        is_today = day_offset == 0
        n_sales = 0 if (day.weekday() == 6) else random.randint(4, 9)
        if is_today:
            n_sales = random.randint(3, 5)
        for _ in range(n_sales):
            hour = random.choice([10, 11, 12, 13, 15, 16, 17, 18, 19])
            if is_today and hour > now_utc().astimezone(WIB).hour:
                continue
            paid_at = datetime(day.year, day.month, day.day, hour, random.randint(0, 59), tzinfo=WIB).astimezone(timezone.utc)
            if paid_at > now_utc():
                continue
            n_items = random.choices([1, 2, 3], weights=[50, 35, 15])[0]
            items = random.choices(products, k=min(n_items, len(products)))
            method = random.choices(["cash", "qris", "transfer"], weights=[60, 30, 10])[0]
            use_customer = random.random() < 0.35 and cust_ids
            customer = None
            if use_customer:
                cid = random.choice(cust_ids)
                c = await db.customers.find_one({"_id": ObjectId(cid)})
                customer = {"id": cid, "name": c["name"]}

            item_docs = [{"product_id": str(p["_id"]), "name": p["name"], "price": float(p["price"]),
                          "qty": 1, "line_total": float(p["price"]), "cogs_unit": 0} for p in items]
            subtotal = sum(i["line_total"] for i in item_docs)
            order_no = await next_order_no()
            sale_doc = {
                "order_no": order_no, "items": item_docs, "subtotal": round2(subtotal),
                "discount_type": "none", "discount_value": 0, "discount_amount": 0, "promo_code": "",
                "tax": 0, "total": round2(subtotal), "payment_method": method,
                "payment_status": "UNPAID", "status": "completed",
                "cogs_total": 0, "gross_profit": 0, "gateway_fee": 0, "net_received": 0,
                "gateway": None, "customer": customer,
                "cashier": {"id": str(cashier["_id"]), "name": cashier["name"]},
                "note": "", "amount_paid": round2(subtotal) if method == "cash" else None,
                "change": 0, "deducted": False, "restored": False, "stock_blocked": False,
                "voided": None, "paid_at": paid_at, "created_at": paid_at, "updated_at": paid_at,
            }
            res = await db.sales.insert_one(sale_doc)
            await finalize_sale(res.inserted_id, paid_at=paid_at,
                                user={"id": str(cashier["_id"]), "name": cashier["name"]})

    # Demo expenses
    if await db.expenses.count_documents({}) == 0:
        for cat, amount, desc, method, days_ago in EXPENSE_SEED:
            day = today - timedelta(days=days_ago)
            date_dt = datetime(day.year, day.month, day.day, 9, 0, tzinfo=WIB)
            await db.expenses.insert_one({
                "date": day.isoformat(), "date_dt": date_dt, "category": cat, "amount": float(amount),
                "description": desc, "payment_method": method, "voided": False,
                "created_by_id": str(owner["_id"]), "created_by_name": owner["name"],
                "created_at": date_dt, "updated_at": date_dt})
            if method == "cash":
                await record_cash_tx("expense", -float(amount), f"Pengeluaran {cat}", "expense", None,
                                     user={"id": str(owner["_id"]), "name": owner["name"]}, created_at=date_dt)

    # Demo purchases
    if await db.purchases.count_documents({}) == 0:
        ings = await db.ingredients.find({"deleted": {"$ne": True}}).to_list(50)
        ing_map = {i["name"]: i for i in ings}
        for days_ago, sup_name, picks in [
            (10, "Sumber Rezeki", [("Tepung Terigu", 10000, 13), ("Gula Pasir", 5000, 15)]),
            (6, "Rasa Nusantara", [("Saus Cokelat", 2000, 24), ("Saus Matcha", 1000, 43)]),
            (3, "Kemasan Untung", [("Food Box", 100, 1400), ("Paper Bag", 150, 850)]),
        ]:
            day = today - timedelta(days=days_ago)
            date_dt = datetime(day.year, day.month, day.day, 8, 30, tzinfo=WIB)
            items_out, total = [], 0.0
            for name, qty, unit_price in picks:
                ing = ing_map[name]
                line = qty * unit_price
                total += line
                items_out.append({"ingredient_id": str(ing["_id"]), "name": name, "qty": float(qty),
                                  "unit": ing["unit"], "unit_price": float(unit_price), "total": float(line)})
            total = round2(total)
            res = await db.purchases.insert_one({
                "purchase_no": f"PO-{days_ago:05d}", "date": day.isoformat(), "date_dt": date_dt,
                "supplier_id": None, "supplier_name": sup_name, "items": items_out, "total": total,
                "payment_status": "paid", "payment_method": "cash", "notes": "Restock rutin (demo)",
                "created_by_id": str(owner["_id"]), "created_by_name": owner["name"],
                "created_at": date_dt, "updated_at": date_dt, "voided": False})
            for i in items_out:
                ing = ing_map[i["name"]]
                old_stock = float(ing.get("stock", 0))
                new_stock = old_stock + i["qty"]
                new_cost = round2(((old_stock * float(ing.get("cost_per_unit", 0))) + (i["qty"] * i["unit_price"])) / new_stock)
                await db.ingredients.update_one({"_id": ing["_id"]},
                                                {"$set": {"stock": round2(new_stock), "cost_per_unit": new_cost}})
                await db.inventory_transactions.insert_one({
                    "ingredient_id": i["ingredient_id"], "ingredient_name": i["name"], "type": "purchase",
                    "qty": i["qty"], "unit": i["unit"], "note": f"Pembelian (demo) {sup_name}",
                    "ref_id": str(res.inserted_id), "created_by_id": str(owner["_id"]),
                    "created_by_name": owner["name"], "created_at": date_dt})
            await record_cash_tx("purchase", -total, f"Pembelian (demo) {sup_name}", "purchase",
                                 str(res.inserted_id), user={"id": str(owner["_id"]), "name": owner["name"]},
                                 created_at=date_dt)

    await db.business_settings.update_one({}, {"$set": {"demo_mode": True}})
