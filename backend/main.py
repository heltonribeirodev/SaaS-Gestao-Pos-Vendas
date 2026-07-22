from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
import os

from backend.routes.auth import router as auth_router
from backend.routes.pedidos import router as pedidos_router
from backend.routes.usuarios import router as usuarios_router
from backend.routes.vendedores import router as vendedores_router

app = FastAPI(
    title="ForteCare API",
    description="Sistema Pós Vendas ForteCare",
    version="1.0.0",
)

# ── Rotas da API ─────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(pedidos_router)
app.include_router(usuarios_router)
app.include_router(vendedores_router)

# ── Health check ─────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"ok": True, "sistema": "ForteCare v1.0"}

# ── Serve arquivos estáticos do frontend ─────────────────────────
# Como o main.py está em backend/, subimos um nível para achar a pasta public
PUBLIC_DIR = Path(__file__).parent.parent / "public"

app.mount("/assets", StaticFiles(directory=PUBLIC_DIR / "assets"), name="assets")

@app.get("/")
def root():
    return FileResponse(PUBLIC_DIR / "login.html")

@app.get("/login.html")
def login_page():
    return FileResponse(PUBLIC_DIR / "login.html")

@app.get("/index.html")
def index_page():
    return FileResponse(PUBLIC_DIR / "index.html")

# ── Fallback blindado ─────────────────────────────────────────────
@app.get("/{full_path:path}")
def fallback(full_path: str):
    # Bloqueia qualquer termo de API para nunca retornar o HTML de login por engano
    if "api" in full_path or "de-para" in full_path or "vendedores" in full_path:
        raise HTTPException(status_code=404, detail="Endpoint da API não encontrado")
    
    file = PUBLIC_DIR / full_path
    if file.exists() and file.is_file():
        return FileResponse(file)
    return FileResponse(PUBLIC_DIR / "login.html")