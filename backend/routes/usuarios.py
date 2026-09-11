from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
from passlib.context import CryptContext
import json

from backend.database import get_conn, release_conn, get_cursor
from backend.models import UsuarioCreate, UsuarioUpdate
from backend.routes.auth import get_usuario_atual
from backend.permissoes import (
    check, PODE_LISTAR_USUARIOS, PODE_CRIAR_USUARIO, PODE_CRIAR_ADMIN,
    PODE_EDITAR_USUARIO, PODE_EXCLUIR_USUARIO
)
from backend.audit import registrar_log

router = APIRouter(prefix="/api/usuarios", tags=["usuarios"])
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ── GET /api/usuarios ────────────────────────────────────────────
@router.get("/")
async def listar(
    q: Optional[str] = Query(None),
    tipo_filtro: Optional[str] = Query(None, alias="tipo"),
    ativo: Optional[bool] = Query(None),
    usuario: dict = Depends(get_usuario_atual),
):
    if not check(usuario.get("tipo"), PODE_LISTAR_USUARIOS):
        raise HTTPException(status_code=403, detail="Sem permissão para listar usuários.")

    conn = get_conn()
    try:
        conditions = ["1=1"]
        params = []

        if q:
            conditions.append("(nome ILIKE %s OR email ILIKE %s OR setor ILIKE %s)")
            params.extend([f"%{q}%"] * 3)

        if tipo_filtro:
            conditions.append("tipo = %s")
            params.append(tipo_filtro)

        if ativo is not None:
            conditions.append("ativo = %s")
            params.append(ativo)

        sql = f"""
            SELECT id, nome, email, setor, tipo, ativo, criado_em
            FROM usuarios
            WHERE {" AND ".join(conditions)}
            ORDER BY nome ASC
        """

        with get_cursor(conn) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        return [dict(r) for r in rows]

    finally:
        release_conn(conn)


# ── POST /api/usuarios ───────────────────────────────────────────
@router.post("/", status_code=201)
async def criar(body: UsuarioCreate, usuario: dict = Depends(get_usuario_atual)):
    tipo_ator = usuario.get("tipo")

    if not check(tipo_ator, PODE_CRIAR_USUARIO):
        raise HTTPException(status_code=403, detail="Sem permissão para criar usuários.")

    # Só Administrador pode criar outro Administrador
    if body.tipo == "Administrador" and not check(tipo_ator, PODE_CRIAR_ADMIN):
        raise HTTPException(status_code=403, detail="Apenas Administradores podem criar outros Administradores.")

    if not body.nome or not body.email or not body.senha or not body.setor or not body.tipo:
        raise HTTPException(status_code=400, detail="Preencha todos os campos.")
    if len(body.senha) < 6:
        raise HTTPException(status_code=400, detail="Senha deve ter ao menos 6 caracteres.")

    conn = get_conn()
    try:
        hash_senha = pwd_ctx.hash(body.senha)
        with get_cursor(conn) as cur:
            cur.execute("""
                INSERT INTO usuarios (nome, email, senha_hash, setor, tipo)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, nome, email, setor, tipo, ativo, criado_em
            """, (body.nome, body.email.lower(), hash_senha, body.setor, body.tipo))
            row = cur.fetchone()
            conn.commit()
        registrar_log(usuario["id"], usuario["nome"], "USUARIO_CRIADO",
                      entidade="usuarios", entidade_id=row["id"],
                      detalhe=json.dumps({"nome": body.nome, "email": body.email.lower(), "tipo": body.tipo}, ensure_ascii=False))
        return dict(row)
    except Exception as e:
        conn.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail="Já existe um usuário com esse e-mail.")
        raise HTTPException(status_code=500, detail=f"Erro ao criar usuário: {str(e)}")
    finally:
        release_conn(conn)


# ── PUT /api/usuarios/:id ────────────────────────────────────────
@router.put("/{usuario_id}")
async def atualizar(usuario_id: int, body: UsuarioUpdate, usuario: dict = Depends(get_usuario_atual)):
    tipo_ator     = usuario.get("tipo")
    editando_si   = usuario["id"] == usuario_id
    pode_editar   = check(tipo_ator, PODE_EDITAR_USUARIO)

    if not editando_si and not pode_editar:
        raise HTTPException(status_code=403, detail="Sem permissão para editar outros usuários.")

    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            cur.execute("SELECT tipo FROM usuarios WHERE id = %s", (usuario_id,))
            alvo = cur.fetchone()
        if not alvo:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")

        tipo_alvo = alvo["tipo"]

        # Ninguém exceto outro Admin pode editar um Administrador
        if tipo_alvo == "Administrador" and tipo_ator != "Administrador":
            raise HTTPException(
                status_code=403,
                detail="Contas de Administrador só podem ser editadas por outro Administrador."
            )

        # Só Admin pode mudar tipo de usuário
        tipo_novo = None
        if body.tipo is not None:
            if tipo_ator != "Administrador":
                raise HTTPException(status_code=403, detail="Apenas Administradores podem alterar o tipo de usuário.")
            # Não rebaixa o último Admin
            if tipo_alvo == "Administrador" and body.tipo != "Administrador":
                with get_cursor(conn) as cur:
                    cur.execute("SELECT COUNT(*) as total FROM usuarios WHERE tipo = 'Administrador' AND ativo = TRUE")
                    if cur.fetchone()["total"] <= 1:
                        raise HTTPException(status_code=400, detail="Não é possível rebaixar o único Administrador.")
            tipo_novo = body.tipo

        # Só Admin e GL podem ativar/desativar
        ativo_novo = None
        if body.ativo is not None:
            if not check(tipo_ator, PODE_EDITAR_USUARIO):
                raise HTTPException(status_code=403, detail="Sem permissão para ativar/desativar usuários.")
            if editando_si:
                raise HTTPException(status_code=400, detail="Você não pode desativar a própria conta.")
            ativo_novo = body.ativo

        hash_senha = None
        if body.senha:
            if len(body.senha) < 6:
                raise HTTPException(status_code=400, detail="Senha deve ter ao menos 6 caracteres.")
            hash_senha = pwd_ctx.hash(body.senha)

        with get_cursor(conn) as cur:
            cur.execute("""
                UPDATE usuarios SET
                    nome          = COALESCE(%s, nome),
                    email         = COALESCE(%s, email),
                    senha_hash    = COALESCE(%s, senha_hash),
                    setor         = COALESCE(%s, setor),
                    tipo          = COALESCE(%s, tipo),
                    ativo         = COALESCE(%s, ativo),
                    atualizado_em = NOW()
                WHERE id = %s
                RETURNING id, nome, email, setor, tipo, ativo, criado_em
            """, (
                body.nome,
                body.email.lower() if body.email else None,
                hash_senha, body.setor, tipo_novo, ativo_novo,
                usuario_id
            ))
            row = cur.fetchone()
            conn.commit()

        if not row:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")

        campos = {}
        if body.nome:   campos["nome"]  = body.nome
        if body.email:  campos["email"] = body.email.lower()
        if body.tipo:   campos["tipo"]  = body.tipo
        if body.setor:  campos["setor"] = body.setor
        if body.ativo is not None: campos["ativo"] = body.ativo
        if body.senha:  campos["senha"] = "*** (alterada)"
        registrar_log(usuario["id"], usuario["nome"], "USUARIO_EDITADO",
                      entidade="usuarios", entidade_id=usuario_id,
                      detalhe=json.dumps({"alvo": row["nome"], "campos": campos}, ensure_ascii=False))

        return dict(row)

    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail="Já existe um usuário com esse e-mail.")
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar: {str(e)}")
    finally:
        release_conn(conn)


# ── DELETE /api/usuarios/:id ─────────────────────────────────────
@router.delete("/{usuario_id}")
async def deletar(usuario_id: int, usuario: dict = Depends(get_usuario_atual)):
    tipo_ator = usuario.get("tipo")

    if not check(tipo_ator, PODE_EXCLUIR_USUARIO):
        raise HTTPException(status_code=403, detail="Sem permissão para excluir usuários.")

    if usuario["id"] == usuario_id:
        raise HTTPException(status_code=400, detail="Você não pode excluir a própria conta.")

    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            cur.execute("SELECT tipo FROM usuarios WHERE id = %s", (usuario_id,))
            alvo = cur.fetchone()
        if not alvo:
            raise HTTPException(status_code=404, detail="Usuário não encontrado.")

        # Ninguém exceto outro Admin pode excluir um Administrador
        if alvo["tipo"] == "Administrador" and tipo_ator != "Administrador":
            raise HTTPException(
                status_code=403,
                detail="Contas de Administrador não podem ser excluídas por outros perfis."
            )

        # Não excluir o último Admin
        if alvo["tipo"] == "Administrador":
            with get_cursor(conn) as cur:
                cur.execute("SELECT COUNT(*) as total FROM usuarios WHERE tipo = 'Administrador' AND ativo = TRUE")
                if cur.fetchone()["total"] <= 1:
                    raise HTTPException(status_code=400, detail="Não é possível excluir o único Administrador do sistema.")

        with get_cursor(conn) as cur:
            cur.execute("SELECT nome, email, tipo FROM usuarios WHERE id = %s", (usuario_id,))
            info = dict(cur.fetchone() or {})
            cur.execute("DELETE FROM usuarios WHERE id = %s", (usuario_id,))
            conn.commit()

        registrar_log(usuario["id"], usuario["nome"], "USUARIO_EXCLUIDO",
                      entidade="usuarios", entidade_id=usuario_id,
                      detalhe=json.dumps({"nome": info.get("nome","?"), "email": info.get("email","?"), "tipo": info.get("tipo","?")}, ensure_ascii=False))
        return {"ok": True}

    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao excluir: {str(e)}")
    finally:
        release_conn(conn)