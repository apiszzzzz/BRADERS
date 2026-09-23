"""BRADERS backend E2E test suite (pytest).

Covers: auth, role guards, POS cash, discounts + promo, QRIS simulator flow
(idempotency, mismatch, expire), void, purchases -> stock + weighted-avg,
expenses, cash sessions, reports (P&L, sales), CSV export, dashboard, HPP
recompute after ingredient patch, inventory deduction accuracy.
"""
import os
import uuid
import time
import pytest
import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL",
                     "https://braders-operations.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"
PW = "braders123"


# ---------- shared session helpers ----------
def _login(email: str) -> dict:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": PW}, timeout=30)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def owner():
    d = _login("owner@braders.id")
    return {"token": d["token"], "user": d["user"], "h": {"Authorization": f"Bearer {d['token']}"}}


@pytest.fixture(scope="session")
def cashier():
    d = _login("kasir@braders.id")
    return {"token": d["token"], "user": d["user"], "h": {"Authorization": f"Bearer {d['token']}"}}


@pytest.fixture(scope="session")
def staff():
    d = _login("staff@braders.id")
    return {"token": d["token"], "user": d["user"], "h": {"Authorization": f"Bearer {d['token']}"}}


# ---------- module: auth ----------
class TestAuth:
    def test_health(self):
        r = requests.get(f"{API}/health", timeout=15)
        assert r.status_code == 200 and r.json()["status"] == "ok"

    def test_login_bad_password(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": "owner@braders.id", "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_me_all_roles(self, owner, cashier, staff):
        for u, role in [(owner, "owner"), (cashier, "cashier"), (staff, "staff")]:
            r = requests.get(f"{API}/auth/me", headers=u["h"], timeout=15)
            assert r.status_code == 200
            assert r.json()["role"] == role


# ---------- module: role guards ----------
class TestRoleGuards:
    def test_staff_forbidden_on_financial_report(self, staff):
        r = requests.get(f"{API}/reports/financial?range_name=today",
                         headers=staff["h"], timeout=20)
        assert r.status_code == 403, r.text

    def test_staff_forbidden_on_product_create(self, staff):
        r = requests.post(f"{API}/products",
                          headers=staff["h"],
                          json={"name": "TEST_x", "category": "test", "price": 1000, "active": True},
                          timeout=20)
        assert r.status_code == 403

    def test_owner_can_read_financial(self, owner):
        r = requests.get(f"{API}/reports/financial?range_name=today",
                         headers=owner["h"], timeout=20)
        assert r.status_code == 200


# ---------- helpers to grab a product with a recipe ----------
def _pick_products(headers, n=2):
    r = requests.get(f"{API}/products", headers=headers, timeout=20)
    assert r.status_code == 200
    prods = [p for p in r.json() if p.get("active")]
    assert len(prods) >= n, "not enough active products in demo"
    return prods[:n]


def _ingredients_map(headers):
    r = requests.get(f"{API}/ingredients", headers=headers, timeout=20)
    assert r.status_code == 200
    body = r.json()
    items = body["items"] if isinstance(body, dict) else body
    return {i["id"]: i for i in items}


# ---------- module: POS cash ----------
class TestPOSCash:
    def test_cash_sale_deducts_inventory_and_computes_cogs(self, cashier, owner):
        products = _pick_products(owner["h"], 2)
        pid, pname = products[0]["id"], products[0]["name"]

        before = _ingredients_map(owner["h"])
        stock_before = {k: v["stock"] for k, v in before.items()}

        payload = {"items": [{"product_id": pid, "qty": 2}],
                   "payment_method": "cash", "amount_paid": 1000000,
                   "note": "TEST_cash"}
        r = requests.post(f"{API}/sales", headers=cashier["h"], json=payload, timeout=30)
        assert r.status_code == 200, r.text
        sale = r.json()["sale"]
        assert sale["status"] == "completed"
        assert sale["payment_status"] == "PAID"
        assert sale["change"] > 0
        assert sale["cogs_total"] > 0
        assert sale["gross_profit"] > 0
        assert sale["gross_profit"] == pytest.approx(sale["total"] - sale["cogs_total"], rel=0.01)

        after = _ingredients_map(owner["h"])
        deducted_any = False
        for iid, ing in after.items():
            if ing["stock"] < stock_before[iid] - 1e-6:
                deducted_any = True
        assert deducted_any, "no ingredient was deducted after cash sale"

    def test_cash_underpayment_rejected(self, cashier, owner):
        products = _pick_products(owner["h"], 1)
        pid = products[0]["id"]
        r = requests.post(f"{API}/sales", headers=cashier["h"],
                          json={"items": [{"product_id": pid, "qty": 1}],
                                "payment_method": "cash", "amount_paid": 1},
                          timeout=20)
        assert r.status_code == 400


# ---------- module: discounts + promo ----------
class TestDiscounts:
    def test_percent_discount(self, cashier, owner):
        p = _pick_products(owner["h"], 1)[0]
        subtotal = p["price"] * 2
        r = requests.post(f"{API}/sales", headers=cashier["h"],
                          json={"items": [{"product_id": p["id"], "qty": 2}],
                                "payment_method": "cash", "amount_paid": 10_000_000,
                                "discount_type": "percent", "discount_value": 10},
                          timeout=20)
        assert r.status_code == 200, r.text
        sale = r.json()["sale"]
        assert sale["discount_amount"] == pytest.approx(subtotal * 0.10, rel=0.01)

    def test_promo_lezatoss10(self, cashier, owner):
        # promo requires min purchase 30000; buy enough qty
        p = _pick_products(owner["h"], 1)[0]
        qty = max(2, int(30000 / p["price"]) + 1)
        r = requests.post(f"{API}/sales", headers=cashier["h"],
                          json={"items": [{"product_id": p["id"], "qty": qty}],
                                "payment_method": "cash", "amount_paid": 10_000_000,
                                "promo_code": "LEZATOSS10"},
                          timeout=20)
        assert r.status_code == 200, r.text
        sale = r.json()["sale"]
        assert sale["promo_code"].upper() == "LEZATOSS10"
        assert sale["discount_amount"] > 0

    def test_promo_below_min_rejected(self, cashier, owner):
        p = _pick_products(owner["h"], 1)[0]
        # find a qty that keeps subtotal below 30000
        if p["price"] >= 30000:
            pytest.skip("all products priced above promo min")
        r = requests.post(f"{API}/sales", headers=cashier["h"],
                          json={"items": [{"product_id": p["id"], "qty": 1}],
                                "payment_method": "cash", "amount_paid": 10_000_000,
                                "promo_code": "LEZATOSS10"},
                          timeout=20)
        # Only reject if subtotal < 30000
        if p["price"] < 30000:
            assert r.status_code == 400


# ---------- module: QRIS simulator ----------
class TestQRIS:
    def _create_qris(self, cashier, owner):
        p = _pick_products(owner["h"], 1)[0]
        r = requests.post(f"{API}/sales", headers=cashier["h"],
                          json={"items": [{"product_id": p["id"], "qty": 1}],
                                "payment_method": "qris"},
                          timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        return d["sale"], d["payment"]

    def test_qris_creation_pending_no_deduction(self, cashier, owner):
        before = _ingredients_map(owner["h"])
        sale, payment = self._create_qris(cashier, owner)
        assert sale["status"] == "pending_payment"
        assert sale["payment_status"] == "PAYMENT_PENDING"
        assert payment["qr_string"]
        after = _ingredients_map(owner["h"])
        # no ingredient should decrease
        for iid, ing in before.items():
            assert after[iid]["stock"] >= ing["stock"] - 1e-6, "QRIS created should NOT deduct stock"

    def test_qris_simulate_paid_then_idempotent(self, cashier, owner):
        before = _ingredients_map(owner["h"])
        sale, payment = self._create_qris(cashier, owner)
        r1 = requests.post(f"{API}/payments/{payment['id']}/simulate?event=paid",
                           headers=cashier["h"], timeout=30)
        assert r1.status_code == 200, r1.text
        j = r1.json()
        assert j["payment"]["status"] == "PAID"
        assert j["sale_status"] == "completed"

        mid = _ingredients_map(owner["h"])
        deducted = sum(1 for iid, ing in mid.items() if ing["stock"] < before[iid]["stock"] - 1e-6)
        assert deducted > 0, "PAID must deduct inventory"

        # Second simulate=paid must be idempotent
        r2 = requests.post(f"{API}/payments/{payment['id']}/simulate?event=paid",
                           headers=cashier["h"], timeout=30)
        assert r2.status_code == 200
        assert r2.json()["payment"]["status"] == "PAID"
        after = _ingredients_map(owner["h"])
        # stock unchanged from first-deduction snapshot
        for iid in mid:
            assert after[iid]["stock"] == pytest.approx(mid[iid]["stock"], abs=1e-6), \
                f"Idempotency violated: {iid}"

        # Verify sale numbers
        r3 = requests.get(f"{API}/sales/{sale['id']}", headers=owner["h"], timeout=20)
        assert r3.status_code == 200
        s = r3.json()
        assert s["cogs_total"] > 0
        assert s["gateway_fee"] > 0  # 0.7% QRIS fee
        assert s["gateway_fee"] == pytest.approx(s["total"] * 0.007, rel=0.02)

    def test_qris_mismatch_returns_422(self, cashier, owner):
        sale, payment = self._create_qris(cashier, owner)
        r = requests.post(f"{API}/payments/{payment['id']}/simulate?event=mismatch",
                          headers=cashier["h"], timeout=20)
        # simulator invokes webhook that raises 422 amount mismatch
        assert r.status_code == 422, r.text

    def test_qris_expire_no_deduction(self, cashier, owner):
        before = _ingredients_map(owner["h"])
        sale, payment = self._create_qris(cashier, owner)
        r = requests.post(f"{API}/payments/{payment['id']}/simulate?event=expire",
                          headers=cashier["h"], timeout=20)
        assert r.status_code == 200
        assert r.json()["payment"]["status"] == "EXPIRED"
        after = _ingredients_map(owner["h"])
        for iid in before:
            assert after[iid]["stock"] >= before[iid]["stock"] - 1e-6

    def test_qris_retry_creates_new_payment(self, cashier, owner):
        sale, payment = self._create_qris(cashier, owner)
        requests.post(f"{API}/payments/{payment['id']}/simulate?event=expire",
                      headers=cashier["h"], timeout=20)
        r = requests.post(f"{API}/sales/{sale['id']}/retry-payment",
                         headers=cashier["h"], timeout=20)
        assert r.status_code == 200, r.text
        new_pay = r.json()
        assert new_pay["id"] != payment["id"]
        assert new_pay["status"] == "PAYMENT_PENDING"


# ---------- module: void ----------
class TestVoid:
    def test_void_paid_sale_restores(self, cashier, owner):
        p = _pick_products(owner["h"], 1)[0]
        # capture stock right before creating the sale
        pre_sale = _ingredients_map(owner["h"])
        r = requests.post(f"{API}/sales", headers=cashier["h"],
                          json={"items": [{"product_id": p["id"], "qty": 1}],
                                "payment_method": "cash", "amount_paid": 10_000_000},
                          timeout=20)
        assert r.status_code == 200
        sale_id = r.json()["sale"]["id"]
        # snapshot right after sale (this is the "delta introduced by this sale")
        post_sale = _ingredients_map(owner["h"])

        r2 = requests.post(f"{API}/sales/{sale_id}/void", headers=owner["h"],
                           json={"reason": "TEST_regression"}, timeout=20)
        assert r2.status_code == 200

        post_void = _ingredients_map(owner["h"])
        # For each ingredient the sale touched, void must restore at least the delta
        for iid in pre_sale:
            deducted = pre_sale[iid]["stock"] - post_sale[iid]["stock"]
            restored = post_void[iid]["stock"] - post_sale[iid]["stock"]
            if deducted > 1e-6:
                assert restored + 1e-6 >= deducted, \
                    f"Void did not fully restore {iid}: deducted {deducted}, restored {restored}"

        # Second void must fail
        r3 = requests.post(f"{API}/sales/{sale_id}/void", headers=owner["h"],
                           json={"reason": "again"}, timeout=20)
        assert r3.status_code == 400

    def test_void_staff_forbidden(self, cashier, owner, staff):
        p = _pick_products(owner["h"], 1)[0]
        r = requests.post(f"{API}/sales", headers=cashier["h"],
                          json={"items": [{"product_id": p["id"], "qty": 1}],
                                "payment_method": "cash", "amount_paid": 10_000_000},
                          timeout=20)
        sid = r.json()["sale"]["id"]
        r2 = requests.post(f"{API}/sales/{sid}/void", headers=staff["h"],
                           json={"reason": "nope"}, timeout=20)
        assert r2.status_code == 403


# ---------- module: HPP recompute after ingredient patch ----------
class TestHPPRecompute:
    def test_products_have_est_hpp(self, owner):
        r = requests.get(f"{API}/products", headers=owner["h"], timeout=20)
        assert r.status_code == 200
        prods = r.json()
        with_hpp = [p for p in prods if p.get("est_hpp", 0) > 0]
        assert with_hpp, "expected demo products to have est_hpp"

    def test_ingredient_cost_update_recomputes_hpp(self, owner):
        # find a product with a recipe (need to fetch detail)
        listed = requests.get(f"{API}/products", headers=owner["h"], timeout=20).json()
        target = None
        for p in listed:
            if p.get("est_hpp", 0) > 0:
                detail = requests.get(f"{API}/products/{p['id']}",
                                      headers=owner["h"], timeout=20).json()
                if detail.get("recipe"):
                    target = detail
                    break
        assert target, "no product with recipe found"
        recipe_iid = target["recipe"][0]["ingredient_id"]
        before_hpp = target["est_hpp"]

        # bump cost by +20%
        ings_body = requests.get(f"{API}/ingredients", headers=owner["h"], timeout=20).json()
        items = ings_body["items"] if isinstance(ings_body, dict) else ings_body
        ing = next(i for i in items if i["id"] == recipe_iid)
        current_cost = float(ing.get("cost_per_unit") or ing.get("purchase_price") or 0)
        if current_cost <= 0:
            pytest.skip("ingredient has zero cost, cannot exercise recompute")
        new_cost = round(current_cost * 1.2, 2)
        # PATCH requires full body per API contract
        full_body = {
            "name": ing["name"], "unit": ing["unit"],
            "purchase_price": float(ing.get("purchase_price") or new_cost),
            "cost_per_unit": new_cost,
            "stock": float(ing["stock"]),
            "min_stock": float(ing.get("min_stock") or 0),
            "supplier": ing.get("supplier") or "",
        }
        r2 = requests.patch(f"{API}/ingredients/{recipe_iid}",
                            headers=owner["h"], json=full_body, timeout=20)
        assert r2.status_code == 200, r2.text

        after_prod = requests.get(f"{API}/products/{target['id']}",
                                  headers=owner["h"], timeout=20).json()
        assert after_prod["est_hpp"] > before_hpp, \
            f"est_hpp did not recompute: {before_hpp} -> {after_prod['est_hpp']}"

        # revert
        full_body["cost_per_unit"] = current_cost
        requests.patch(f"{API}/ingredients/{recipe_iid}",
                       headers=owner["h"], json=full_body, timeout=20)


# ---------- module: purchases & expenses ----------
class TestPurchasesExpenses:
    def test_purchase_increases_stock_and_updates_avg_cost(self, owner, staff):
        from datetime import date as _date
        body = requests.get(f"{API}/ingredients", headers=owner["h"], timeout=20).json()
        ings = body["items"] if isinstance(body, dict) else body
        target = ings[0]
        before_stock = float(target["stock"])
        before_cost = float(target.get("cost_per_unit") or 0)
        buy_qty = 10.0
        buy_price = round(max(before_cost, 100) * 1.5, 2)

        payload = {"supplier_name": "TEST_supplier",
                   "date": _date.today().isoformat(),
                   "items": [{"ingredient_id": target["id"], "qty": buy_qty,
                              "unit_price": buy_price}],
                   "payment_status": "paid",
                   "payment_method": "cash",
                   "notes": "TEST_purchase"}
        r = requests.post(f"{API}/purchases", headers=staff["h"], json=payload, timeout=20)
        assert r.status_code in (200, 201), r.text

        body2 = requests.get(f"{API}/ingredients", headers=owner["h"], timeout=20).json()
        items2 = body2["items"] if isinstance(body2, dict) else body2
        after_target = next(i for i in items2 if i["id"] == target["id"])
        assert after_target["stock"] == pytest.approx(before_stock + buy_qty, abs=1e-6)
        new_cost = float(after_target["cost_per_unit"])
        # weighted avg must be between prior cost and new buy price
        lo = min(before_cost, buy_price) - 0.01
        hi = max(before_cost, buy_price) + 0.01
        assert lo <= new_cost <= hi, f"weighted-avg out of range: {new_cost} not in [{lo},{hi}]"

    def test_expense_records(self, owner):
        from datetime import date as _date
        r = requests.post(f"{API}/expenses", headers=owner["h"],
                          json={"category": "Listrik", "amount": 25000,
                                "date": _date.today().isoformat(),
                                "note": "TEST_expense"},
                          timeout=20)
        assert r.status_code in (200, 201), r.text


# ---------- module: cash sessions ----------
class TestCashSession:
    def test_open_tx_close(self, cashier):
        # Close any currently-open shift so we start clean
        status = requests.get(f"{API}/cash/status", headers=cashier["h"], timeout=20)
        if status.status_code == 200:
            sess = status.json().get("session")
            if sess and sess.get("status") == "open":
                requests.post(f"{API}/cash/sessions/{sess['id']}/close",
                              headers=cashier["h"],
                              json={"actual_cash": float(sess.get("opening_cash", 0)),
                                    "note": "TEST_precleanup"}, timeout=20)

        r = requests.post(f"{API}/cash/sessions/open", headers=cashier["h"],
                          json={"opening_cash": 100000, "note": "TEST_open"}, timeout=20)
        assert r.status_code in (200, 201), r.text
        sid = r.json()["id"]

        r2 = requests.post(f"{API}/cash/transactions", headers=cashier["h"],
                           json={"type": "addition", "amount": 50000, "note": "TEST_tx"},
                           timeout=20)
        assert r2.status_code in (200, 201), r2.text

        r3 = requests.post(f"{API}/cash/sessions/{sid}/close",
                           headers=cashier["h"],
                           json={"actual_cash": 150000, "note": "TEST_close"},
                           timeout=20)
        assert r3.status_code == 200, r3.text
        body = r3.json()
        assert "expected_cash" in body
        assert "difference" in body


# ---------- module: reports & CSV export ----------
class TestReports:
    def test_financial_pnl_math(self, owner):
        r = requests.get(f"{API}/reports/financial?range_name=month",
                         headers=owner["h"], timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("net_sales", "cogs", "gross_profit", "opex_total", "net_profit"):
            assert k in d, f"missing {k}"
        assert d["gross_profit"] == pytest.approx(d["net_sales"] - d["cogs"], abs=1.0)
        assert d["net_profit"] == pytest.approx(d["gross_profit"] - d["opex_total"], abs=1.0)

    def test_sales_report_shape(self, owner):
        r = requests.get(f"{API}/reports/sales?range_name=month",
                         headers=owner["h"], timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("best_sellers", "by_payment", "by_category", "by_hour"):
            assert k in d, f"missing {k}"

    @pytest.mark.parametrize("kind", ["pnl", "sales", "expenses", "inventory", "purchases", "products"])
    def test_csv_export(self, owner, kind):
        r = requests.get(f"{API}/reports/export?type={kind}&range_name=month",
                         headers=owner["h"], timeout=30)
        assert r.status_code == 200, r.text
        ct = r.headers.get("content-type", "")
        assert "csv" in ct.lower() or r.text.count(",") > 0


# ---------- module: dashboard ----------
class TestDashboard:
    def test_dashboard(self, owner):
        r = requests.get(f"{API}/dashboard", headers=owner["h"], timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ("kpis", "trend", "low_stock", "best_sellers"):
            assert k in d
        assert len(d["trend"]) == 14
