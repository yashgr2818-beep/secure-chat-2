import os
import asyncio
import json
import base64
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from jose import JWTError, jwt
from bson import ObjectId

# ── Config ──────────────────────────────────────────────────────────────────
MONGODB_URI = os.environ.get("MONGODB_URI", "")
JWT_SECRET  = os.environ.get("SESSION_SECRET", "changeme-secret-key")
JWT_ALGO    = "HS256"
JWT_EXPIRE_HOURS = 24 * 7  # 7 days
PORT        = int(os.environ.get("PORT", 8080))

if not MONGODB_URI:
    raise RuntimeError("MONGODB_URI environment variable is not set")

# ── Database ─────────────────────────────────────────────────────────────────
mongo_client: AsyncIOMotorClient = None
db = None

async def get_db():
    return db

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="SecureChat API", root_path="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup():
    global mongo_client, db
    mongo_client = AsyncIOMotorClient(MONGODB_URI)
    db = mongo_client["securechat"]
    # Indexes
    await db.users.create_index("username", unique=True)
    await db.messages.create_index([("fromUsername", 1), ("toUsername", 1)])
    await db.messages.create_index([("toUsername", 1), ("delivered", 1)])
    print(f"Connected to MongoDB — SecureChat API running on port {PORT}")

@app.on_event("shutdown")
async def shutdown():
    if mongo_client:
        mongo_client.close()

# ── Security ─────────────────────────────────────────────────────────────────
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer  = HTTPBearer()

def hash_password(pw: str) -> str:
    return pwd_ctx.hash(pw)

def verify_password(pw: str, hashed: str) -> bool:
    return pwd_ctx.verify(pw, hashed)

def create_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    return jwt.encode({"sub": username, "exp": expire}, JWT_SECRET, algorithm=JWT_ALGO)

async def current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
    database=Depends(get_db),
) -> dict:
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGO])
        username: str = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await database.users.find_one({"username": username})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ── Pydantic models ───────────────────────────────────────────────────────────
class SignupInput(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=6)
    publicKey: str  # JWK-encoded RSA-OAEP public key

class LoginInput(BaseModel):
    username: str
    password: str

class MessageInput(BaseModel):
    toUsername: str
    encryptedContent: str   # base64 AES-GCM ciphertext
    encryptedKey: str       # base64 AES key encrypted with recipient RSA public key
    iv: str                 # base64 AES-GCM IV

def serialize_user(u: dict, online: bool = False) -> dict:
    return {
        "id": str(u["_id"]),
        "username": u["username"],
        "online": online,
        "lastSeen": u.get("lastSeen"),
    }

def serialize_message(m: dict) -> dict:
    return {
        "id": str(m["_id"]),
        "fromUsername": m["fromUsername"],
        "toUsername": m["toUsername"],
        "encryptedContent": m["encryptedContent"],
        "encryptedKey": m.get("encryptedKey"),
        "iv": m.get("iv"),
        "timestamp": m["timestamp"].isoformat() if hasattr(m["timestamp"], "isoformat") else str(m["timestamp"]),
        "delivered": m.get("delivered", False),
    }

# ── WebSocket connection manager ──────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active: dict[str, WebSocket] = {}  # username → ws

    async def connect(self, username: str, ws: WebSocket):
        await ws.accept()
        self.active[username] = ws

    def disconnect(self, username: str):
        self.active.pop(username, None)

    def is_online(self, username: str) -> bool:
        return username in self.active

    async def send_to(self, username: str, payload: dict) -> bool:
        ws = self.active.get(username)
        if ws:
            try:
                await ws.send_text(json.dumps(payload))
                return True
            except Exception:
                self.disconnect(username)
        return False

manager = ConnectionManager()

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/healthz")
async def health():
    return {"status": "ok"}

# Auth
@app.post("/auth/signup", status_code=201)
async def signup(body: SignupInput, database=Depends(get_db)):
    existing = await database.users.find_one({"username": body.username})
    if existing:
        raise HTTPException(status_code=409, detail="Username already taken")
    doc = {
        "username": body.username,
        "passwordHash": hash_password(body.password),
        "publicKey": body.publicKey,
        "createdAt": datetime.now(timezone.utc),
        "lastSeen": None,
    }
    result = await database.users.insert_one(doc)
    doc["_id"] = result.inserted_id
    token = create_token(body.username)
    return {"token": token, "user": serialize_user(doc, online=True)}

@app.post("/auth/login")
async def login(body: LoginInput, database=Depends(get_db)):
    user = await database.users.find_one({"username": body.username})
    if not user or not verify_password(body.password, user["passwordHash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_token(body.username)
    return {"token": token, "user": serialize_user(user, online=manager.is_online(body.username))}

# Users
@app.get("/users")
async def list_users(me=Depends(current_user), database=Depends(get_db)):
    users = await database.users.find({"username": {"$ne": me["username"]}}).to_list(200)
    return [serialize_user(u, online=manager.is_online(u["username"])) for u in users]

@app.get("/users/{username}/public-key")
async def get_public_key(username: str, me=Depends(current_user), database=Depends(get_db)):
    user = await database.users.find_one({"username": username})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"username": username, "publicKey": user["publicKey"]}

# Messages
@app.get("/messages/unread")
async def get_unread(me=Depends(current_user), database=Depends(get_db)):
    msgs = await database.messages.find({
        "toUsername": me["username"],
        "delivered": False,
    }).sort("timestamp", 1).to_list(500)
    # Mark as delivered
    ids = [m["_id"] for m in msgs]
    if ids:
        await database.messages.update_many(
            {"_id": {"$in": ids}},
            {"$set": {"delivered": True}},
        )
    return [serialize_message(m) for m in msgs]

@app.get("/messages/{username}")
async def get_messages(username: str, me=Depends(current_user), database=Depends(get_db)):
    msgs = await database.messages.find({
        "$or": [
            {"fromUsername": me["username"], "toUsername": username},
            {"fromUsername": username, "toUsername": me["username"]},
        ]
    }).sort("timestamp", 1).to_list(500)
    return [serialize_message(m) for m in msgs]

# ── WebSocket ─────────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str = "", database=Depends(get_db)):
    # Authenticate via query param token
    username = None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        username = payload.get("sub")
    except JWTError:
        await ws.close(code=4001)
        return

    if not username:
        await ws.close(code=4001)
        return

    await manager.connect(username, ws)

    # Deliver any stored offline messages
    offline_msgs = await database.messages.find({
        "toUsername": username,
        "delivered": False,
    }).sort("timestamp", 1).to_list(500)

    for msg in offline_msgs:
        await manager.send_to(username, {
            "type": "message",
            "payload": serialize_message(msg),
        })
    if offline_msgs:
        ids = [m["_id"] for m in offline_msgs]
        await database.messages.update_many(
            {"_id": {"$in": ids}},
            {"$set": {"delivered": True}},
        )

    # Broadcast online status
    for uname in list(manager.active.keys()):
        if uname != username:
            await manager.send_to(uname, {"type": "user_online", "username": username})

    # Update lastSeen
    await database.users.update_one({"username": username}, {"$set": {"lastSeen": None}})

    try:
        while True:
            raw = await ws.receive_text()
            data = json.loads(raw)

            if data.get("type") == "message":
                payload = data.get("payload", {})
                to_user = payload.get("toUsername")
                encrypted_content = payload.get("encryptedContent")
                encrypted_key = payload.get("encryptedKey")
                iv = payload.get("iv")

                if not to_user or not encrypted_content:
                    continue

                # Recipient must exist
                recipient = await database.users.find_one({"username": to_user})
                if not recipient:
                    continue

                msg_doc = {
                    "fromUsername": username,
                    "toUsername": to_user,
                    "encryptedContent": encrypted_content,
                    "encryptedKey": encrypted_key,
                    "iv": iv,
                    "timestamp": datetime.now(timezone.utc),
                    "delivered": False,
                }
                result = await database.messages.insert_one(msg_doc)
                msg_doc["_id"] = result.inserted_id

                serialized = serialize_message(msg_doc)

                # Try to forward in real time
                delivered = await manager.send_to(to_user, {
                    "type": "message",
                    "payload": serialized,
                })

                # Echo back to sender
                await manager.send_to(username, {
                    "type": "message_sent",
                    "payload": serialized,
                })

                if delivered:
                    await database.messages.update_one(
                        {"_id": msg_doc["_id"]},
                        {"$set": {"delivered": True}},
                    )

            elif data.get("type") == "ping":
                await manager.send_to(username, {"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WebSocket error for {username}: {e}")
    finally:
        manager.disconnect(username)
        now = datetime.now(timezone.utc).isoformat()
        await database.users.update_one(
            {"username": username},
            {"$set": {"lastSeen": now}},
        )
        # Broadcast offline status
        for uname in list(manager.active.keys()):
            await manager.send_to(uname, {"type": "user_offline", "username": username})
