"""Auth & user management routers."""
import re
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import (ROLE_LABELS, db, get_current_user, hash_password, now_utc,
                  require_roles, serialize, verify_password, create_access_token)

router = APIRouter(prefix="/auth", tags=["auth"])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class LoginIn(BaseModel):
    email: str
    password: str


class UserIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str
    password: str = Field(default="", max_length=72)
    role: str = "staff"
    active: bool = True


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = Field(default=None, max_length=72)


def public_user(u: dict) -> dict:
    return {
        "id": str(u["_id"]), "name": u.get("name", ""), "email": u.get("email", ""),
        "role": u.get("role", "staff"), "role_label": ROLE_LABELS.get(u.get("role", ""), "-"),
        "active": u.get("active", True),
    }


@router.post("/login")
async def login(body: LoginIn):
    email = body.email.strip().lower()
    user = await db.users.find_one({"email": email})
    ok = verify_password(body.password, user["password_hash"]) if user else verify_password(
        body.password, hash_password("unusable-dummy"))
    if not user or not ok:
        raise HTTPException(status_code=401, detail="Email atau password salah")
    return {"token": create_access_token(user), "user": public_user(user)}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return public_user(user)


# ---------------------------------------------------------------------------
# User management (owner only)
# ---------------------------------------------------------------------------
users_router = APIRouter(prefix="/users", tags=["users"])


@users_router.get("")
async def list_users(user: dict = Depends(require_roles("owner"))):
    users = await db.users.find({}, {"password_hash": 0}).sort("created_at", 1).to_list(200)
    return [public_user(u) for u in users]


@users_router.post("")
async def create_user(body: UserIn, user: dict = Depends(require_roles("owner"))):
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Email tidak valid")
    if body.role not in ROLE_LABELS:
        raise HTTPException(status_code=400, detail="Peran tidak valid")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password minimal 6 karakter")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="Email sudah terdaftar")
    doc = {"name": body.name.strip(), "email": email, "role": body.role,
           "password_hash": hash_password(body.password), "active": body.active,
           "created_at": now_utc(), "updated_at": now_utc()}
    res = await db.users.insert_one(doc)
    doc["_id"] = res.inserted_id
    return public_user(doc)


@users_router.patch("/{user_id}")
async def update_user(user_id: str, body: UserUpdate, user: dict = Depends(require_roles("owner"))):
    patch = {}
    if body.name is not None:
        patch["name"] = body.name.strip()
    if body.role is not None:
        if body.role not in ROLE_LABELS:
            raise HTTPException(status_code=400, detail="Peran tidak valid")
        if user_id == user["id"] and body.role != "owner":
            raise HTTPException(status_code=400, detail="Tidak bisa menurunkan peran akun sendiri")
        patch["role"] = body.role
    if body.active is not None:
        if user_id == user["id"] and not body.active:
            raise HTTPException(status_code=400, detail="Tidak bisa menonaktifkan akun sendiri")
        patch["active"] = body.active
    if body.password:
        if len(body.password) < 6:
            raise HTTPException(status_code=400, detail="Password minimal 6 karakter")
        patch["password_hash"] = hash_password(body.password)
    if not patch:
        raise HTTPException(status_code=400, detail="Tidak ada perubahan")
    patch["updated_at"] = now_utc()
    res = await db.users.find_one_and_update({"_id": ObjectId(user_id)}, {"$set": patch})
    if not res:
        raise HTTPException(status_code=404, detail="Pengguna tidak ditemukan")
    res["password_hash"] = "x"
    return public_user(res)
