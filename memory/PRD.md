# BRADERS — Business Management & POS (PRD)

## Original Problem Statement
Full-stack business management + POS app for "BRADERS" (Churros Lezatoss), a small Indonesian
churros business. One integrated system where sales → inventory → HPP/COGS → profit are connected
automatically, with real Midtrans QRIS payment architecture (verified via webhook, never client-trust).

## Architecture
- **Backend**: FastAPI (modular: `core`, `services`, `payments`, routers `auth/catalog/sales/ops/reports/misc`), MongoDB (motor, tz-aware). JWT auth + bcrypt, role guards (owner/cashier/staff).
- **Payments**: Clean gateway abstraction (`payments.py`) — `MidtransGateway` (Core API `/v2/charge` QRIS + sha512 webhook signature) and `SimulatorGateway` (dev). `PAYMENT_SIMULATOR=true`. Adding another Indonesian gateway = implement `charge_qris/status/verify_notification` only.
- **Frontend**: Expo Router (React Native, also web). Bahasa Indonesia, IDR. Bottom tabs Beranda/Kasir/Pesanan/Lainnya (NativeTabs iOS26+, classic elsewhere). Theme from design_guidelines (warm cream/brown/golden). react-query for all data.

## Business Logic (server-validated)
- Net Sales = Gross − Discounts; COGS = actual ingredient cost consumed (snapshot at payment)
- Gross Profit = Net Sales − COGS; Net Profit = Gross Profit − Opex
- Gross/Net margin %; QRIS fee (MDR) tracked separately (gross_sales / fee / net_received), never reduces price or HPP
- Idempotent finalize: inventory deducted once, revenue affected once. Void = reversal (no hard deletes).

## User Personas
- **Owner/Admin**: full access — finance, users, settings, products, void.
- **Kasir**: POS, orders, customers, sales reports, cash, expenses.
- **Staff**: inventory & purchases (operational).

## Implemented (2026-06)
- Auth + 3 roles with route guards; demo users (owner/kasir/staff @braders.id / braders123)
- Dashboard: KPIs, 14-day sales+profit trend, low-stock, best sellers, quick actions, date filter (today/yesterday/week/month)
- POS: category chips, search, product grid, cart (qty/remove/discount/promo/customer), cash change calc, digital receipt + print (expo-print)
- QRIS checkout: QR render, 30-min countdown, status polling, webhook-driven PAID (idempotent), simulator buttons (paid/expire/fail), retry/cancel
- Products+Recipe/BOM CRUD with live HPP/margin; ingredient price change recomputes HPP
- Inventory: stock, min-stock, valuation, in/out/adjust movements + history, low-stock warnings
- Purchases (stock-in, weighted-avg cost, cash-out), Expenses (categories, cash ledger)
- Financial P&L + Sales analytics (best sellers, by payment/category/hour) + CSV export (6 types)
- Marketing/promotions (with performance), Customers (history/segmentation), Cash register shift (expected vs actual)
- Settings (business profile, tax toggle, QRIS fee, negative-stock toggle, payment methods) + Users management
- Demo data seeded (clearly marked demo_mode), reset-demo action

## Verified
32/32 backend e2e tests pass (`/app/backend/tests/test_braders_e2e.py`): cash+QRIS flows, idempotency,
mismatch/expire, void reversal, HPP recompute, purchases, cash sessions, P&L math, CSV, role guards.
Frontend smoke: login → dashboard → POS → cart → QRIS modal all working.

## Backlog / Next
- P1: Midtrans sandbox keys (swap simulator → real by setting MIDTRANS_SERVER_KEY + PAYMENT_SIMULATOR=false)
- P2: PDF/Excel export (currently CSV), receipt printer hardware, image upload for products (currently URL)
- P2: Optional partial PATCH schema for ingredients; `opex` key alias in financial report
