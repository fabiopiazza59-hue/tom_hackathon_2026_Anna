from pathlib import Path
import hashlib
import hmac
import os
import secrets
import time

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from typing import Annotated

from pydantic import BaseModel, Field
from shared_config import SharedConfig, ConfigConflict, ConfigUnavailable, get_config_store, storage_status
from activity import InteractionBatch, append_events, get_activity_store
from voices import KEY, MAX_PHRASE, VoiceUnavailable, get_voice_store, record, voice_settings

ROOT = Path(__file__).parent
app = FastAPI(title="Anna", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
# Many phone and in-app browsers never show the Basic login box, so /admin also offers a form and a session cookie.
security = HTTPBasic(realm="Anna admin", auto_error=False)
SESSION_COOKIE = "anna_admin"
SESSION_SECONDS = 12 * 3600


@app.middleware("http")
async def response_headers(request: Request, call_next):
    response = await call_next(request)
    # Scripts import each other without version numbers: always revalidate so a deploy never mixes old and new files.
    if request.url.path.startswith("/static/") and request.url.path.endswith((".js", ".css", ".html")):
        response.headers["Cache-Control"] = "no-cache"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=()"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def admin_credentials():
    # Values pasted into Vercel often keep a trailing newline; phones capitalise usernames or add a space.
    username = os.environ.get("ADMIN_USERNAME", "").strip()
    password = os.environ.get("ADMIN_PASSWORD", "").strip()
    if not username or not password:
        raise HTTPException(status_code=503, detail="Admin access is not configured")
    return username, password


def valid_login(given_username, given_password):
    username, password = admin_credentials()
    valid_username = secrets.compare_digest(given_username.strip().casefold().encode(), username.casefold().encode())
    valid_password = secrets.compare_digest(given_password.strip().encode(), password.encode())
    return valid_username and valid_password


# Signed with the admin credentials: changing the password signs everyone out.
def session_token(expires):
    username, password = admin_credentials()
    key = hashlib.sha256(f"anna-admin-session\0{username.casefold()}\0{password}".encode()).digest()
    return f"{expires}.{hmac.new(key, str(expires).encode(), hashlib.sha256).hexdigest()}"


def valid_session(token):
    expires = token.split(".", 1)[0]
    if not expires.isdigit() or int(expires) < time.time():
        return False
    return hmac.compare_digest(token.encode(), session_token(int(expires)).encode())


def require_admin(request: Request, credentials: HTTPBasicCredentials | None = Depends(security)):
    admin_credentials()
    if credentials and valid_login(credentials.username, credentials.password):
        return
    if valid_session(request.cookies.get(SESSION_COOKIE, "")):
        return
    raise HTTPException(status_code=401, detail="Identifiant ou mot de passe incorrect", headers={"Cache-Control": "no-store"})


class Login(BaseModel):
    username: str = Field(max_length=200)
    password: str = Field(max_length=200)


@app.get("/admin")
@app.get("/admin/", include_in_schema=False)
def admin(request: Request, credentials: HTTPBasicCredentials | None = Depends(security)):
    try:
        require_admin(request, credentials)
    except HTTPException as exc:
        if exc.status_code != 401:
            raise
        return FileResponse(
            ROOT / "private" / "login.html", status_code=401,
            headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"},
        )
    return FileResponse(
        ROOT / "private" / "admin.html",
        headers={"Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow"},
    )


@app.post("/api/admin-login")
def admin_login(login: Login, request: Request):
    origin = request.headers.get("origin")
    if origin and origin != f"{request.url.scheme}://{request.url.netloc}":
        raise HTTPException(status_code=403, detail="Origine non autorisée.")
    if not valid_login(login.username, login.password):
        time.sleep(0.5)  # Slow down password guessing.
        raise HTTPException(status_code=401, detail="Identifiant ou mot de passe incorrect", headers={"Cache-Control": "no-store"})
    response = JSONResponse({"isAdmin": True}, headers={"Cache-Control": "no-store"})
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(SESSION_COOKIE, session_token(int(time.time()) + SESSION_SECONDS), max_age=SESSION_SECONDS,
                        httponly=True, secure=secure, samesite="strict", path="/")
    return response


@app.post("/api/admin-logout")
def admin_logout():
    response = JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response


@app.get("/api/admin-session", dependencies=[Depends(require_admin)])
def admin_session():
    return JSONResponse({"isAdmin": True}, headers={"Cache-Control": "private, no-store"})


@app.exception_handler(ConfigUnavailable)
async def config_unavailable(request, exc):
    return JSONResponse(
        {"detail": "Stockage partagé indisponible. Réessayez, aucune modification n’a été enregistrée."},
        status_code=503, headers={"Cache-Control": "no-store"},
    )


@app.get("/api/config")
def read_config(if_none_match: str | None = Header(default=None), store=Depends(get_config_store)):
    snapshot = store.read(if_none_match)
    if snapshot is None:
        return Response(status_code=304, headers={"Cache-Control": "no-store", "ETag": if_none_match})
    return JSONResponse(
        {"config": snapshot.config, "revision": snapshot.revision, "initialized": snapshot.initialized},
        headers={"Cache-Control": "no-store", "ETag": snapshot.revision},
    )


@app.put("/api/config", dependencies=[Depends(require_admin)])
def write_config(config: SharedConfig, if_match: str | None = Header(default=None), store=Depends(get_config_store)):
    if not if_match or len(if_match) > 256 or not (if_match.startswith('"') and if_match.endswith('"')):
        raise HTTPException(status_code=428, detail="Rechargez la banque avant de l’enregistrer.")
    try:
        snapshot = store.write(config.export(), if_match)
    except ConfigConflict:
        raise HTTPException(status_code=409, detail="La banque a été modifiée ailleurs. Rechargez la page avant de réessayer.") from None
    return JSONResponse(
        {"revision": snapshot.revision}, headers={"Cache-Control": "no-store", "ETag": snapshot.revision},
    )


@app.post("/api/interactions")
def record_interactions(batch: InteractionBatch, request: Request, store=Depends(get_activity_store)):
    origin = request.headers.get("origin")
    if origin and origin != f"{request.url.scheme}://{request.url.netloc}":
        raise HTTPException(status_code=403, detail="Origine non autorisée.")
    append_events(store, batch.events)
    return JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})


@app.get("/api/usage")
def read_usage(if_none_match: str | None = Header(default=None), store=Depends(get_activity_store)):
    snapshot = store.read(if_none_match)
    if snapshot is None:
        return Response(status_code=304, headers={"Cache-Control": "no-store", "ETag": if_none_match})
    # No conversation text or individual answers are exposed on the public page.
    return JSONResponse({"stats": snapshot.config["stats"]}, headers={"Cache-Control": "no-store", "ETag": snapshot.revision})


@app.get("/api/history", dependencies=[Depends(require_admin)])
def read_history(store=Depends(get_activity_store)):
    doc = store.read().config
    return JSONResponse(
        {"history": list(reversed(doc["history"])), "answers": doc["answers"]},
        headers={"Cache-Control": "private, no-store"},
    )


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "home.html", headers={"Cache-Control": "no-store"})


@app.get("/parler")
@app.get("/parler/", include_in_schema=False)
def conversation():
    return FileResponse(ROOT / "static" / "index.html", headers={"Cache-Control": "no-store"})


class Phrases(BaseModel):
    phrases: list[Annotated[str, Field(min_length=1, max_length=MAX_PHRASE)]] = Field(min_length=1, max_length=12)


# Recorded phrases for the public page; it falls back to the browser voice for any other text.
@app.get("/api/voices")
def voice_index(store=Depends(get_voice_store)):
    api_key, voice_id, _ = voice_settings()
    return JSONResponse({"configured": bool(api_key and voice_id), "phrases": store.index(voice_id) if voice_id else {}},
                        headers={"Cache-Control": "no-store"})


@app.get("/api/voices/{key}.mp3")
def voice_audio(key: str, store=Depends(get_voice_store)):
    _, voice_id, _ = voice_settings()
    audio = store.audio(voice_id, key) if voice_id and KEY.match(key) else None
    if audio is None:
        raise HTTPException(status_code=404, detail="Enregistrement introuvable")
    # A key never changes content: browsers and the CDN can keep it.
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable"})


@app.post("/api/voices/record", dependencies=[Depends(require_admin)])
def voice_record(body: Phrases, store=Depends(get_voice_store)):
    try:
        return JSONResponse(record(store, body.phrases), headers={"Cache-Control": "no-store"})
    except VoiceUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None


@app.get("/api/health")
def health():
    return JSONResponse({"status": "ok", "app": "anna", "storage": storage_status()}, headers={"Cache-Control": "no-store"})
