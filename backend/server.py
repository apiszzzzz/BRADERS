"""BRADERS — Business Management & POS API."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core import db
from routers import auth, catalog, misc, ops, reports, sales
from seed import seed_demo_data

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("braders")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Indexes (unique keys for idempotency & integrity)
    await db.users.create_index("email", unique=True)
    await db.sales.create_index("order_no", unique=True)
    await db.payments.create_index("order_id", unique=True)
    await db.promotions.create_index("code", unique=True)
    logger.info("Seeding demo data if needed…")
    await seed_demo_data()
    logger.info("BRADERS API ready")
    yield
    db.client.close()


app = FastAPI(title="BRADERS API", version="1.0.0", lifespan=lifespan)

app.include_router(auth.router, prefix="/api")
app.include_router(catalog.router, prefix="/api")
app.include_router(sales.router, prefix="/api")
app.include_router(ops.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(misc.router, prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok", "app": "BRADERS"}
