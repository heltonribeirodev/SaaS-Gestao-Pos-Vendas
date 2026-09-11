from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
import re
import json

from backend.database import get_conn, release_conn, get_cursor
from backend.models import PedidoCreate, PedidoUpdate, ImportarPayload
from backend.routes.auth import get_usuario_atual
from backend.permissoes import (
    check, PODE_VER_TODOS, PODE_CRIAR_PEDIDO,
    PODE_EDITAR_PEDIDO, PODE_EXCLUIR_PEDIDO
)
from backend.audit import registrar_log

router = APIRouter(prefix="/api/pedidos", tags=["pedidos"])


def iso_or_none(val):
    if not val or val in ("-", ""):
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}$", str(val)):
        return val
    if re.match(r"^\d{2}/\d{2}/\d{4}$", str(val)):
        d, m, y = val.split("/")
        return f"{y}-{m}-{d}"
    return None


def get_nome_planilha_vendedor(conn, usuario_id: int) -> Optional[str]:
    """Retorna o nome_planilha vinculado ao usuário no De-Para, ou None."""
    try:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT nome_planilha FROM vendedor_de_para WHERE usuario_id = %s LIMIT 1",
                (usuario_id,)
            )
            row = cur.fetchone()
            return row["nome_planilha"] if row else None
    except Exception:
        return None


# ── GET /api/pedidos ─────────────────────────────────────────────
@router.get("/")
async def listar(
    status: Optional[str]         = Query(None),
    vendedor: Optional[str]       = Query(None),
    transportadora: Optional[str] = Query(None),
    uf: Optional[str]             = Query(None),
    q: Optional[str]              = Query(None),
    de: Optional[str]             = Query(None),
    ate: Optional[str]            = Query(None),
    usuario: dict = Depends(get_usuario_atual),
):
    conn = get_conn()
    try:
        conditions = ["1=1"]
        params = []

        # Obtém o tipo de usuário autenticado
        tipo = usuario.get("tipo")

        # Vendedor só vê os próprios pedidos via De-Para
        if tipo == "Vendedor":
            nome_planilha = get_nome_planilha_vendedor(conn, usuario["id"])
            if not nome_planilha:
                return []
            conditions.append("UPPER(vendedor) = UPPER(%s)")
            params.append(nome_planilha)
        else:
            # Todos os outros (incluindo Gerente) veem tudo, podem filtrar por vendedor
            if vendedor:
                conditions.append("vendedor = %s")
                params.append(vendedor)

        if status:         conditions.append("status = %s");                                            params.append(status)
        if transportadora: conditions.append("transportadora = %s");                                    params.append(transportadora)
        if uf:             conditions.append("uf = %s");                                                params.append(uf)
        if de:             conditions.append("emissao >= %s");                                          params.append(de)
        if ate:            conditions.append("emissao <= %s");                                          params.append(ate)
        if q:
            conditions.append("(nf ILIKE %s OR destinatario ILIKE %s OR municipio ILIKE %s)")
            params.extend([f"%{q}%"] * 3)

        sql = f"""
            SELECT * FROM pedidos
            WHERE {" AND ".join(conditions)}
            ORDER BY emissao DESC, id DESC
        """

        with get_cursor(conn) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        return [dict(r) for r in rows]

    finally:
        release_conn(conn)


# ── POST /api/pedidos — inclusão manual ─────────────────────────
@router.post("/", status_code=201)
async def criar(body: PedidoCreate, usuario: dict = Depends(get_usuario_atual)):
    if not check(usuario.get("tipo"), PODE_CRIAR_PEDIDO):
        raise HTTPException(status_code=403, detail="Sem permissão para incluir pedidos.")

    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            cur.execute("""
                INSERT INTO pedidos
                  (nf, vendedor, valor_nf, valor_frete, pct_frete, transportadora,
                   emissao, destinatario, uf, municipio, previsao, entrega,
                   dias, contato, status, obs, obs_rastreio, criado_por)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                RETURNING *
            """, (
                body.nf, body.vendedor, body.valor_nf, body.valor_frete, body.pct_frete,
                body.transportadora, body.emissao, body.destinatario, body.uf, body.municipio,
                body.previsao, body.entrega, body.dias, body.contato,
                body.status, body.obs, body.obs_rastreio, usuario["id"]
            ))
            row = cur.fetchone()
            conn.commit()
        registrar_log(usuario["id"], usuario["nome"], "PEDIDO_CRIADO",
                      entidade="pedidos", entidade_id=row["id"],
                      detalhe=json.dumps({"nf": body.nf, "destinatario": body.destinatario}, ensure_ascii=False))
        return dict(row)
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao criar pedido: {str(e)}")
    finally:
        release_conn(conn)


# ── POST /api/pedidos/importar ───────────────────────────────────
@router.post("/importar")
async def importar(payload: ImportarPayload, usuario: dict = Depends(get_usuario_atual)):
    if not check(usuario.get("tipo"), PODE_CRIAR_PEDIDO):
        raise HTTPException(status_code=403, detail="Sem permissão para importar planilhas.")

    if not payload.pedidos:
        raise HTTPException(status_code=400, detail="Nenhum pedido enviado.")

    conn = get_conn()
    inseridos = 0
    try:
        with get_cursor(conn) as cur:
            for p in payload.pedidos:
                nf          = p.nf or p.id or "S/N"
                valor_nf    = p.valor_nf or p.valorNF or 0
                valor_frete = p.valor_frete or p.valorC or 0
                pct_frete   = p.pct_frete or p.pct or 0
                emissao     = iso_or_none(p.emissao)
                previsao    = iso_or_none(p.previsao)
                entrega     = iso_or_none(p.entrega)
                if not emissao:
                    continue
                cur.execute("""
                    INSERT INTO pedidos
                      (nf, vendedor, valor_nf, valor_frete, pct_frete, transportadora,
                       emissao, destinatario, uf, municipio, previsao, entrega,
                       dias, contato, status, obs, obs_rastreio, criado_por)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """, (
                    nf, p.vendedor, valor_nf, valor_frete, pct_frete,
                    p.transportadora, emissao, p.destinatario, p.uf, p.municipio,
                    previsao, entrega, p.dias or 0, p.contato,
                    p.status or "EM TRÂNSITO", p.obs, p.obs_rastreio, usuario["id"]
                ))
                inseridos += 1
        conn.commit()
        registrar_log(usuario["id"], usuario["nome"], "PEDIDO_IMPORTADO",
                      entidade="pedidos",
                      detalhe=json.dumps({"inseridos": inseridos, "total_enviados": len(payload.pedidos)}, ensure_ascii=False))
        return {"ok": True, "inseridos": inseridos}
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Erro na importação: {str(e)}")
    finally:
        release_conn(conn)


# ── PUT /api/pedidos/:id ─────────────────────────────────────────
@router.put("/{pedido_id}")
async def atualizar(pedido_id: int, body: PedidoUpdate, usuario: dict = Depends(get_usuario_atual)):
    tipo = usuario.get("tipo")
    if not check(tipo, PODE_EDITAR_PEDIDO):
        raise HTTPException(status_code=403, detail="Sem permissão para editar pedidos.")

    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            # Captura estado anterior para diff
            cur.execute("SELECT * FROM pedidos WHERE id = %s", (pedido_id,))
            antes = dict(cur.fetchone() or {})

            cur.execute("""
                UPDATE pedidos SET
                    status         = COALESCE(%s, status),
                    entrega        = COALESCE(%s::date, entrega),
                    obs            = COALESCE(%s, obs),
                    obs_rastreio   = COALESCE(%s, obs_rastreio),
                    contato        = COALESCE(%s, contato),
                    previsao       = COALESCE(%s::date, previsao),
                    vendedor       = COALESCE(%s, vendedor),
                    transportadora = COALESCE(%s, transportadora),
                    valor_nf       = COALESCE(%s, valor_nf),
                    valor_frete    = COALESCE(%s, valor_frete),
                    atualizado_em  = NOW()
                WHERE id = %s
                RETURNING *
            """, (
                body.status,
                str(body.entrega) if body.entrega else None,
                body.obs,
                body.obs_rastreio,
                body.contato,
                str(body.previsao) if body.previsao else None,
                body.vendedor,
                body.transportadora,
                body.valor_nf,
                body.valor_frete,
                pedido_id
            ))
            row = cur.fetchone()
            conn.commit()

        if not row:
            raise HTTPException(status_code=404, detail="Pedido não encontrado.")

        # Monta diff dos campos alterados
        campo_map = {
            "status": body.status, "entrega": str(body.entrega) if body.entrega else None,
            "obs": body.obs, "obs_rastreio": body.obs_rastreio, "contato": body.contato,
            "previsao": str(body.previsao) if body.previsao else None,
            "vendedor": body.vendedor, "transportadora": body.transportadora,
            "valor_nf": body.valor_nf, "valor_frete": body.valor_frete,
        }
        alteracoes = {}
        for campo, novo in campo_map.items():
            if novo is not None:
                anterior = str(antes.get(campo, "")) if antes.get(campo) is not None else ""
                if str(novo) != anterior:
                    alteracoes[campo] = {"de": anterior, "para": str(novo)}
        detalhe = json.dumps({"nf": antes.get("nf", "?"), "campos": alteracoes}, ensure_ascii=False)
        registrar_log(usuario["id"], usuario["nome"], "PEDIDO_EDITADO",
                      entidade="pedidos", entidade_id=pedido_id, detalhe=detalhe)

        return dict(row)

    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar: {str(e)}")
    finally:
        release_conn(conn)


# ── DELETE /api/pedidos/:id ──────────────────────────────────────
@router.delete("/{pedido_id}")
async def deletar(pedido_id: int, usuario: dict = Depends(get_usuario_atual)):
    if not check(usuario.get("tipo"), PODE_EXCLUIR_PEDIDO):
        raise HTTPException(status_code=403, detail="Sem permissão para excluir pedidos.")

    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            # Captura NF antes de deletar
            cur.execute("SELECT nf, destinatario FROM pedidos WHERE id = %s", (pedido_id,))
            info = dict(cur.fetchone() or {})
            cur.execute("DELETE FROM pedidos WHERE id = %s RETURNING id", (pedido_id,))
            row = cur.fetchone()
            conn.commit()
        if not row:
            raise HTTPException(status_code=404, detail="Pedido não encontrado.")
        registrar_log(usuario["id"], usuario["nome"], "PEDIDO_EXCLUIDO",
                      entidade="pedidos", entidade_id=pedido_id,
                      detalhe=json.dumps({"nf": info.get("nf","?"), "destinatario": info.get("destinatario","?")}, ensure_ascii=False))
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao excluir: {str(e)}")
    finally:
        release_conn(conn)