from pathlib import Path
import os
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from shared_config import SharedConfig, ConfigConflict, ConfigUnavailable, get_config_store
from activity import InteractionBatch, append_events, get_activity_store

ROOT = Path(__file__).parent
app = FastAPI(title="Anna", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
security = HTTPBasic(realm="Anna admin")


@app.middleware("http")
async def response_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Permissions-Policy"] = "camera=(self), microphone=()"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def require_admin(credentials: HTTPBasicCredentials = Depends(security)):
    username = os.environ.get("ADMIN_USERNAME", "")
    password = os.environ.get("ADMIN_PASSWORD", "")
    if not username or not password:
        raise HTTPException(status_code=503, detail="Admin access is not configured")
    valid_username = secrets.compare_digest(credentials.username.encode(), username.encode())
    valid_password = secrets.compare_digest(credentials.password.encode(), password.encode())
    if not (valid_username and valid_password):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": 'Basic realm="Anna admin"', "Cache-Control": "no-store"},
        )


@app.get("/admin", dependencies=[Depends(require_admin)])
@app.get("/admin/", dependencies=[Depends(require_admin)], include_in_schema=False)
def admin():
    return FileResponse(
        ROOT / "private" / "admin.html",
        headers={"Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow"},
    )


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


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "anna"}
