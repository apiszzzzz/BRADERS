"""Core: env/mongo, ids, time helpers, auth (JWT + roles), shared models."""
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

import jwt as pyjwt
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from pydantic import BaseModel, Field

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

WIB = ZoneInfo("Asia/Jakarta")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url, tz_aware=True, tzinfo=timezone.utc)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ["JWT_SECRET"]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# PyObjectId / BaseDocument (MongoDB adherence)
# ---------------------------------------------------------------------------
class PyObjectId(str):
    @classmethod
    def __get_pydantic_core_schema__(cls, source_type, handler):
        from pydantic_core import core_schema

        return core_schema.no_info_plain_validator_function(
            cls.validate, serialization=core_schema.to_string_ser_schema()
        )

    @classmethod
    def validate(cls, v):
        if isinstance(v, ObjectId):
            return str(v)
        s = str(v)
        if not ObjectId.is_valid(s):
            raise ValueError("Invalid ObjectId")
        return s


class BaseDocument(BaseModel):
    model_config = {"populate_by_name": True, "extra": "ignore"}

    id: Optional[PyObjectId] = Field(None, alias="_id")
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    def to_mongo(self) -> dict:
        return self.model_dump(by_alias=True, exclude={"id"}, exclude_none=True)

    @classmethod
    def from_mongo(cls, doc: Optional[dict]):
        if not doc:
            return None
        d = dict(doc)
        d["_id"] = str(d["_id"])
        return cls.model_validate(d)


def serialize(doc: Any) -> Any:
    """Recursively convert ObjectId -> str and datetime -> ISO for JSON responses."""
    if isinstance(doc, ObjectId):
        return str(doc)
    if isinstance(doc, datetime):
        return doc.isoformat()
    if isinstance(doc, dict):
        out = {}
        for k, v in doc.items():
            if k == "_id":
                out["id"] = serialize(v)
            else:
                out[k] = serialize(v)
        return out
    if isinstance(doc, list):
        return [serialize(x) for x in doc]
    return doc


def clean(doc: Optional[dict]) -> Optional[dict]:
    """Serialize + strip internal flags before returning to clients."""
    if doc is None:
        return None
    d = serialize(dict(doc))
    for k in ("password_hash", "deducted", "restored"):
        d.pop(k, None)
    return d


def round2(x: float) -> float:
    return round(float(x or 0) + 1e-9, 2)


def rid(s: str) -> ObjectId:
    if not ObjectId.is_valid(s or ""):
        raise HTTPException(status_code=400, detail="ID tidak valid")
    return ObjectId(s)


# ---------------------------------------------------------------------------
# Date range filtering (WIB business timezone)
# ---------------------------------------------------------------------------
def parse_range(range_name: str = "today", start: str = None, end: str = None):
    """Returns (start_utc, end_utc_exclusive, start_date, end_date)."""
    from datetime import date as date_cls

    today = now_utc().astimezone(WIB).date()
    if range_name == "yesterday":
        d0 = d1 = today - timedelta(days=1)
    elif range_name == "week":
        d0 = today - timedelta(days=today.weekday())
        d1 = today
    elif range_name == "month":
        d0 = today.replace(day=1)
        d1 = today
    elif range_name == "custom" and start and end:
        d0 = date_cls.fromisoformat(start)
        d1 = date_cls.fromisoformat(end)
        if d1 < d0:
            d0, d1 = d1, d0
    else:  # today
        d0 = d1 = today
    s = datetime(d0.year, d0.month, d0.day, tzinfo=WIB).astimezone(timezone.utc)
    e_excl = datetime(d1.year, d1.month, d1.day, tzinfo=WIB) + timedelta(days=1)
    e_excl = e_excl.astimezone(timezone.utc)
    return s, e_excl, d0, d1


# ---------------------------------------------------------------------------
# Sequential numbers (order numbers etc.)
# ---------------------------------------------------------------------------
async def next_number(key: str) -> int:
    from pymongo import ReturnDocument

    doc = await db.counters.find_one_and_update(
        {"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER
    )
    return doc["seq"]


async def next_order_no() -> str:
    seq = await next_number("order")
    d = now_utc().astimezone(WIB)
    return f"BRD-{d.strftime('%y%m%d')}-{seq:04d}"


# ---------------------------------------------------------------------------
# Passwords & JWT
# ---------------------------------------------------------------------------
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(p: str) -> str:
    return pwd_context.hash(p)


def verify_password(p: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(p, hashed)
    except Exception:
        return False


def create_access_token(user: dict) -> str:
    payload = {
        "sub": str(user["_id"]),
        "role": user.get("role", "staff"),
        "exp": now_utc() + timedelta(hours=24),
        "iat": now_utc(),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm="HS256")


bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(cred: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> dict:
    exc = HTTPException(status_code=401, detail="Sesi berakhir, silakan masuk kembali")
    if cred is None or not cred.credentials:
        raise exc
    try:
        payload = pyjwt.decode(cred.credentials, JWT_SECRET, algorithms=["HS256"])
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
    except HTTPException:
        raise
    except Exception:
        raise exc
    if not user or not user.get("active", True):
        raise HTTPException(status_code=401, detail="Akun tidak aktif")
    user["id"] = str(user["_id"])
    return user


def require_roles(*roles: str):
    async def guard(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Akses ditolak untuk peran Anda")
        return user

    return guard


ROLE_LABELS = {"owner": "Owner/Admin", "cashier": "Kasir", "staff": "Staff"}
