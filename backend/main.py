from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from backend.routes.auth import router as auth_router
from backend.routes.pedidos import router as pedidos_router
from backend.routes.usuarios import router as usuarios_router
from backend.routes.vendedores import router as vendedores_router
from backend.routes.logs import router as logs_router

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
app.include_router(logs_router, prefix="/api/logs", tags=["Logs"])

# ── Health check ─────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {"ok": True, "sistema": "ForteCare v1.0"}

# ── Serve arquivos estáticos do frontend ─────────────────────────
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
    # Bloqueia qualquer termo de API para não retornar HTML por engano
    if any(term in full_path for term in ["api", "de-para", "vendedores", "logs"]):
        raise HTTPException(status_code=404, detail="Endpoint da API não encontrado")
    
    file = (PUBLIC_DIR / full_path).resolve()
    public_resolved = PUBLIC_DIR.resolve()

    # Prevenção contra Path Traversal: garante que o arquivo solicitado está dentro do PUBLIC_DIR
    if file.exists() and file.is_file() and file.is_relative_to(public_resolved):
        return FileResponse(file)
        
    return FileResponse(PUBLIC_DIR / "login.html")