"""Reports: dashboard, financial (P&L), sales analytics, CSV export."""
import csv
import io
from datetime import timedelta

from bson import ObjectId
from fastapi import APIRouter, Depends
from fastapi.responses import Response

from core import WIB, db, now_utc, parse_range, require_roles, round2, serialize
from services import cash_balance, get_settings

router = APIRouter(tags=["reports"])

ALL = require_roles("owner", "cashier", "staff")
SALES_REPORT = require_roles("owner", "cashier")
FINANCE = require_roles("owner")
EXPORT = require_roles("owner")


def paid_sales_match(s, e):
    return {"status": "completed", "payment_status": "PAID", "paid_at": {"$gte": s, "$lt": e}}


async def compute_financial(s, e):
    sales = await db.sales.find(paid_sales_match(s, e)).to_list(10000)
    gross_sales = sum(float(x["total"]) for x in sales)
    discounts = sum(float(x.get("discount_amount", 0)) for x in sales)
    tax = sum(float(x.get("tax", 0)) for x in sales)
    net_sales = gross_sales - tax
    cogs = sum(float(x.get("cogs_total", 0)) for x in sales)
    gross_profit = net_sales - cogs
    qris_fee = sum(float(x.get("gateway_fee", 0)) for x in sales if x.get("payment_method") == "qris")
    net_received = sum(float(x.get("net_received", 0)) for x in sales if x.get("payment_method") == "qris")
    transactions = len(sales)
    units = sum(float(i["qty"]) for x in sales for i in x["items"])

    exp_match = {"voided": {"$ne": True}, "date_dt": {"$gte": s, "$lt": e}}
    opex_total, opex_by_cat = 0.0, {}
    async for exp in db.expenses.find(exp_match):
        amt = float(exp["amount"])
        opex_total += amt
        opex_by_cat[exp["category"]] = round2(opex_by_cat.get(exp["category"], 0) + amt)

    net_profit = gross_profit - opex_total
    return {
        "gross_sales": round2(gross_sales), "discounts": round2(discounts), "net_sales": round2(net_sales),
        "cogs": round2(cogs), "gross_profit": round2(gross_profit),
        "opex_total": round2(opex_total), "opex_by_category": opex_by_cat,
        "net_profit": round2(net_profit),
        "gross_margin": round2(gross_profit / net_sales * 100) if net_sales else 0,
        "net_margin": round2(net_profit / net_sales * 100) if net_sales else 0,
        "transactions": transactions, "units_sold": int(units),
        "avg_transaction": round2(gross_sales / transactions) if transactions else 0,
        "qris": {"fee": round2(qris_fee), "net_received": round2(net_received)},
        "note_tax": tax,
    }


async def compute_sales_report(s, e):
    sales = await db.sales.find(paid_sales_match(s, e)).to_list(10000)
    totals = {"total_sales": 0, "transactions": 0, "units_sold": 0, "discounts": 0, "avg_order_value": 0}
    best, by_cat, by_pay, by_date, by_hour = {}, {}, {}, {}, {}
    for x in sales:
        t = float(x["total"])
        totals["total_sales"] += t
        totals["transactions"] += 1
        totals["discounts"] += float(x.get("discount_amount", 0))
        day = x["paid_at"].astimezone(WIB).strftime("%Y-%m-%d")
        hour = x["paid_at"].astimezone(WIB).strftime("%H:00")
        by_date[day] = round2(by_date.get(day, 0) + t)
        by_hour[hour] = round2(by_hour.get(hour, 0) + t)
        by_pay[x["payment_method"]] = round2(by_pay.get(x["payment_method"], 0) + t)
        for i in x["items"]:
            totals["units_sold"] += float(i["qty"])
            b = best.setdefault(i["product_id"], {"name": i["name"], "qty": 0, "revenue": 0})
            b["qty"] += float(i["qty"])
            b["revenue"] = round2(b["revenue"] + float(i["line_total"]))
    # category names
    pids = list({i["product_id"] for x in sales for i in x["items"]})
    products = {str(p["_id"]): p for p in await db.products.find({"_id": {"$in": [ObjectId(p) for p in pids]}}).to_list(500)} if pids else {}
    for pid, b in best.items():
        p = products.get(pid)
        cat = p.get("category_name", "Lainnya") if p else "Lainnya"
        by_cat[cat] = round2(by_cat.get(cat, 0) + b["revenue"])
    best_sorted = sorted(best.values(), key=lambda x: -x["qty"])
    totals["total_sales"] = round2(totals["total_sales"])
    totals["transactions"] = len(sales)
    totals["units_sold"] = int(totals["units_sold"])
    totals["discounts"] = round2(totals["discounts"])
    totals["avg_order_value"] = round2(totals["total_sales"] / totals["transactions"]) if totals["transactions"] else 0
    return {
        "totals": totals, "best_sellers": best_sorted[:10],
        "by_category": by_cat, "by_payment": by_pay, "by_date": by_date, "by_hour": by_hour,
    }


@router.get("/reports/financial")
async def financial_report(range_name: str = "today", start: str = "", end: str = "",
                           user: dict = Depends(FINANCE)):
    s, e, d0, d1 = parse_range(range_name, start, end)
    data = await compute_financial(s, e)
    data["start_date"], data["end_date"] = d0.isoformat(), d1.isoformat()
    return data


@router.get("/reports/sales")
async def sales_report(range_name: str = "today", start: str = "", end: str = "",
                       user: dict = Depends(SALES_REPORT)):
    s, e, d0, d1 = parse_range(range_name, start, end)
    data = await compute_sales_report(s, e)
    data["start_date"], data["end_date"] = d0.isoformat(), d1.isoformat()
    return data


@router.get("/dashboard")
async def dashboard(range_name: str = "today", start: str = "", end: str = "",
                    user: dict = Depends(ALL)):
    s, e, d0, d1 = parse_range(range_name, start, end)
    fin = await compute_financial(s, e)
    sal = await compute_sales_report(s, e)
    settings = await get_settings()

    # Trends: last 14 days daily sales & gross profit (WIB days)
    trend_days = []
    today = now_utc().astimezone(WIB).date()
    for i in range(13, -1, -1):
        day = today - timedelta(days=i)
        trend_days.append(day.isoformat())
    trend_sales = {d: 0.0 for d in trend_days}
    trend_profit = {d: 0.0 for d in trend_days}
    async for x in db.sales.find({"status": "completed", "payment_status": "PAID",
                                  "paid_at": {"$gte": now_utc() - timedelta(days=14)}}):
        day = x["paid_at"].astimezone(WIB).strftime("%Y-%m-%d")
        if day in trend_sales:
            trend_sales[day] += float(x["total"])
            trend_profit[day] += float(x.get("gross_profit", 0))

    # Low stock
    low_stock = await db.ingredients.find({
        "deleted": {"$ne": True},
        "$expr": {"$lte": ["$stock", "$min_stock"]},
    }).sort("name", 1).to_list(50)

    expenses_today = fin["opex_total"]
    return {
        "range": {"name": range_name, "start": d0.isoformat(), "end": d1.isoformat()},
        "kpis": {
            "sales": fin["gross_sales"], "transactions": fin["transactions"],
            "gross_profit": fin["gross_profit"], "net_profit": fin["net_profit"],
            "expenses": expenses_today, "cash_balance": await cash_balance(),
            "cogs": fin["cogs"], "discounts": fin["discounts"],
            "gross_margin": fin["gross_margin"], "net_margin": fin["net_margin"],
            "units_sold": fin["units_sold"], "avg_transaction": fin["avg_transaction"],
            "qris_fee": fin["qris"]["fee"], "net_received": fin["qris"]["net_received"],
        },
        "trend": [{"date": d, "sales": round2(trend_sales[d]), "profit": round2(trend_profit[d])} for d in trend_days],
        "low_stock": serialize(low_stock),
        "best_sellers": sal["best_sellers"][:5],
        "settings": {"business_name": settings.get("business_name", "BRADERS"),
                     "tagline": settings.get("tagline", ""), "demo_mode": settings.get("demo_mode", False)},
    }


# ---------------------------------------------------------------------------
# CSV export
# ---------------------------------------------------------------------------
@router.get("/reports/export")
async def export_report(type: str = "sales", range_name: str = "month", start: str = "", end: str = "",
                        user: dict = Depends(EXPORT)):
    s, e, d0, d1 = parse_range(range_name, start, end)
    buf = io.StringIO()
    w = csv.writer(buf)

    if type == "sales":
        w.writerow(["order_no", "tanggal_bayar", "kasir", "pelanggan", "metode", "subtotal",
                    "diskon", "pajak", "total", "hpp", "laba_kotor", "biaya_gateway", "status"])
        async for x in db.sales.find({"paid_at": {"$gte": s, "$lt": e}}).sort("paid_at", 1):
            w.writerow([x["order_no"],
                        x["paid_at"].astimezone(WIB).strftime("%Y-%m-%d %H:%M") if x.get("paid_at") else "-",
                        (x.get("cashier") or {}).get("name", "-"), (x.get("customer") or {}).get("name", "-"),
                        x.get("payment_method"), x.get("subtotal"), x.get("discount_amount"),
                        x.get("tax"), x.get("total"), x.get("cogs_total"), x.get("gross_profit"),
                        x.get("gateway_fee", 0), x.get("status")])
        name = "penjualan"
    elif type == "expenses":
        w.writerow(["tanggal", "kategori", "jumlah", "metode", "keterangan", "dicatat_oleh", "void"])
        async for x in db.expenses.find({"date_dt": {"$gte": s, "$lt": e}}).sort("date_dt", 1):
            w.writerow([x["date"], x["category"], x["amount"], x.get("payment_method"),
                        x.get("description"), x.get("created_by_name"), "ya" if x.get("voided") else "tidak"])
        name = "pengeluaran"
    elif type == "pnl":
        fin = await compute_financial(s, e)
        w.writerow(["laporan", "nilai"])
        for k, label in [("gross_sales", "Penjualan Kotor"), ("discounts", "Diskon"), ("net_sales", "Penjualan Bersih"),
                         ("cogs", "HPP"), ("gross_profit", "Laba Kotor"), ("opex_total", "Beban Operasional"),
                         ("net_profit", "Laba Bersih"), ("qris_fee", "Biaya QRIS"), ("net_received", "Penerimaan Bersih QRIS")]:
            v = fin.get(k)
            if isinstance(v, dict):
                v = sum(v.values())
            w.writerow([label, v if not isinstance(v, float) else round2(v)])
        name = "laba_rugi"
    elif type == "inventory":
        w.writerow(["bahan", "stok", "satuan", "harga_per_satuan", "nilai_stok", "min_stok", "supplier", "kadaluarsa"])
        async for x in db.ingredients.find({"deleted": {"$ne": True}}).sort("name", 1):
            w.writerow([x["name"], x.get("stock"), x.get("unit"), x.get("cost_per_unit"),
                        round2(float(x.get("stock", 0)) * float(x.get("cost_per_unit", 0))),
                        x.get("min_stock"), x.get("supplier", ""), x.get("expires_at", "")])
        name = "inventaris"
    elif type == "purchases":
        w.writerow(["no_pembelian", "tanggal", "supplier", "total", "status_bayar", "metode", "dicatat_oleh"])
        async for x in db.purchases.find({"date_dt": {"$gte": s, "$lt": e}}).sort("date_dt", 1):
            w.writerow([x["purchase_no"], x["date"], x["supplier_name"], x["total"],
                        x.get("payment_status"), x.get("payment_method"), x.get("created_by_name")])
        name = "pembelian"
    else:  # products
        w.writerow(["produk", "kategori", "harga", "est_hpp", "est_laba_kotor", "margin_%", "status"])
        async for x in db.products.find({"deleted": {"$ne": True}}).sort("name", 1):
            w.writerow([x["name"], x.get("category_name", ""), x.get("price"), x.get("est_hpp"),
                        x.get("est_gross_profit"), x.get("gross_margin"),
                        "aktif" if x.get("active") else "nonaktif"])
        name = "produk"

    csv_content = "\ufeff" + buf.getvalue()  # BOM for Excel
    return Response(
        content=csv_content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="braders-{name}-{d0.isoformat()}-{d1.isoformat()}.csv"'},
    )
