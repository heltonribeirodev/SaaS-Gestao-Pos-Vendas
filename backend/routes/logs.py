from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional

from backend.database import get_conn, release_conn, get_cursor
from backend.routes.auth import get_usuario_atual

# Removemos o prefix daqui, pois ele já é definido no main.py
router = APIRouter()


@router.get("")
@router.get("/")
async def listar_logs(
    acao: Optional[str]  = Query(None),
    busca: Optional[str] = Query(None),
    de: Optional[str]    = Query(None),
    ate: Optional[str]   = Query(None),
    limit: int           = Query(100, le=10000), # <-- Mude de le=500 para le=10000
    offset: int          = Query(0),
    usuario: dict        = Depends(get_usuario_atual),
):
    if usuario.get("tipo") != "Administrador":
        raise HTTPException(status_code=403, detail="Acesso restrito ao Administrador.")

    conn = get_conn()
    try:
        conditions = ["1=1"]
        params: list = []

        if acao:
            conditions.append("acao = %s")
            params.append(acao)
        if busca:
            conditions.append(
                "(usuario_nome ILIKE %s OR detalhe ILIKE %s OR entidade_id ILIKE %s)"
            )
            params.extend([f"%{busca}%", f"%{busca}%", f"%{busca}%"])
        if de:
            conditions.append("criado_em >= %s::timestamptz")
            params.append(de)
        if ate:
            conditions.append(
                "criado_em < (%s::date + interval '1 day')::timestamptz"
            )
            params.append(ate)

        where = " AND ".join(conditions)

        with get_cursor(conn) as cur:
            cur.execute(
                f"SELECT COUNT(*) AS total FROM logs_auditoria WHERE {where}",
                params,
            )
            total = cur.fetchone()["total"]

            cur.execute(
                f"""
                SELECT id, usuario_id, usuario_nome, acao,
                       entidade, entidade_id, detalhe, ip,
                       criado_em AT TIME ZONE 'America/Sao_Paulo' AS criado_em
                FROM   logs_auditoria
                WHERE  {where}
                ORDER  BY criado_em DESC
                LIMIT  %s OFFSET %s
                """,
                params + [limit, offset],
            )
            rows = cur.fetchall()

        return {"total": total, "logs": [dict(r) for r in rows]}

    finally:
        release_conn(conn)