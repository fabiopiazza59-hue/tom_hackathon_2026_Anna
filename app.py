from pathlib import Path
import os
import secrets

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).parent
app = FastAPI(title="Anna", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
security = HTTPBasic(realm="Anna admin")


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


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "anna"}
