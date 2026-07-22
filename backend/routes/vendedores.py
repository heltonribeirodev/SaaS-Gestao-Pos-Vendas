from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from backend.database import get_conn, release_conn, get_cursor
from backend.routes.auth import get_usuario_atual

router = APIRouter(prefix="/api/vendedores", tags=["Vendedores"])

class DeParaCreate(BaseModel):
    nome_planilha: str
    usuario_id: int

def ensure_table():
    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS vendedor_de_para (
                    id            SERIAL PRIMARY KEY,
                    nome_planilha TEXT NOT NULL UNIQUE,
                    usuario_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
                    criado_em     TIMESTAMP DEFAULT NOW()
                )
            """)
        conn.commit()
    finally:
        release_conn(conn)

ensure_table()

# ── GET /api/vendedores/meu-nome ─────────────────────────────────
# Retorna o nome_planilha vinculado ao usuário logado (se for Vendedor)
@router.get("/meu-nome")
def meu_nome_planilha(usuario: dict = Depends(get_usuario_atual)):
    if usuario.get("tipo") != "Vendedor":
        return {"nome_planilha": None}

    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT nome_planilha FROM vendedor_de_para WHERE usuario_id = %s LIMIT 1",
                (usuario["id"],)
            )
            row = cur.fetchone()
        return {"nome_planilha": row["nome_planilha"] if row else None}
    finally:
        release_conn(conn)

# ── GET /api/vendedores/de-para ──────────────────────────────────
@router.get("/de-para")
def listar_de_para(usuario: dict = Depends(get_usuario_atual)):
    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            cur.execute("""
                SELECT v.id, v.nome_planilha, v.usuario_id,
                       u.nome as usuario_nome, u.email as usuario_email
                FROM vendedor_de_para v
                JOIN usuarios u ON u.id = v.usuario_id
                ORDER BY v.nome_planilha
            """)
            return [dict(r) for r in cur.fetchall()]
    finally:
        release_conn(conn)

# ── POST /api/vendedores/de-para ─────────────────────────────────
@router.post("/de-para", status_code=201)
def salvar_de_para(dados: DeParaCreate, usuario: dict = Depends(get_usuario_atual)):
    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            cur.execute("""
                INSERT INTO vendedor_de_para (nome_planilha, usuario_id)
                VALUES (%s, %s)
                ON CONFLICT (nome_planilha) DO UPDATE SET usuario_id = EXCLUDED.usuario_id
                RETURNING id, nome_planilha, usuario_id
            """, (dados.nome_planilha.strip().upper(), dados.usuario_id))
            row = cur.fetchone()
            conn.commit()
        return dict(row)
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao salvar vínculo: {str(e)}")
    finally:
        release_conn(conn)

# ── DELETE /api/vendedores/de-para/:id ───────────────────────────
@router.delete("/de-para/{id}")
def deletar_de_para(id: int, usuario: dict = Depends(get_usuario_atual)):
    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            cur.execute("DELETE FROM vendedor_de_para WHERE id = %s RETURNING id", (id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Vínculo não encontrado.")
            conn.commit()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao remover: {str(e)}")
    finally:
        release_conn(conn)