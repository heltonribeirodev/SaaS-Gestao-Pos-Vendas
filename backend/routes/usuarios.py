from fastapi import APIRouter, HTTPException, Depends
from passlib.context import CryptContext

from backend.database import get_conn, release_conn, get_cursor
from backend.models import UsuarioCreate, UsuarioUpdate
from backend.routes.auth import get_usuario_atual, exige_cargos

router = APIRouter(prefix="/api/usuarios", tags=["usuarios"])
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ── GET /api/usuarios ────────────────────────────────────────────
@router.get("/")
async def listar(usuario: dict = Depends(get_usuario_atual)):
    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            # Administrador, Gerente de Logística e Operador têm acesso ao painel de administração (podem listar todos)
            if usuario["tipo"] in ["Administrador", "Gerente-logistica", "Operador"]:
                cur.execute(
                    "SELECT id, nome, email, setor, tipo, ativo, criado_em FROM usuarios ORDER BY nome"
                )
            else:
                # Gerente e Vendedor só têm acesso a verem a si mesmos
                cur.execute(
                    "SELECT id, nome, email, setor, tipo, ativo, criado_em FROM usuarios WHERE id = %s",
                    (usuario["id"],)
                )
            return [dict(r) for r in cur.fetchall()]
    finally:
        release_conn(conn)


# ── POST /api/usuarios ───────────────────────────────────────────
@router.post("/", status_code=201)
async def criar(
    body: UsuarioCreate, 
    # Apenas Administrador e Gerente de Logística podem criar usuários:
    usuario_logado: dict = Depends(exige_cargos(["Administrador", "Gerente-logistica"]))
):
    if not body.nome or not body.email or not body.senha or not body.setor or not body.tipo:
        raise HTTPException(status_code=400, detail="Preencha todos os campos.")
    if len(body.senha) < 6:
        raise HTTPException(status_code=400, detail="Senha deve ter ao menos 6 caracteres.")

    # REGRA: Apenas um Administrador pode criar outro Administrador
    if body.tipo == "Administrador" and usuario_logado["tipo"] != "Administrador":
        raise HTTPException(status_code=403, detail="Apenas um Administrador pode criar outro usuário Administrador.")

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
async def atualizar(
    usuario_id: int, 
    body: UsuarioUpdate, 
    usuario_logado: dict = Depends(get_usuario_atual)
):
    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            # 1. Busca quem é o usuário que está sendo editado
            cur.execute("SELECT id, tipo FROM usuarios WHERE id = %s", (usuario_id,))
            alvo = cur.fetchone()
            if not alvo:
                raise HTTPException(status_code=404, detail="Usuário não encontrado.")

            # REGRA 1: Quem pode editar este usuário?
            is_self = (usuario_logado["id"] == usuario_id)
            can_edit_others = (usuario_logado["tipo"] in ["Administrador", "Gerente-logistica"])

            if not is_self and not can_edit_others:
                raise HTTPException(status_code=403, detail="Você não tem permissão para editar outros usuários.")

            # REGRA 2: Ninguém pode editar um Administrador, a não ser um Administrador
            if alvo["tipo"] == "Administrador" and usuario_logado["tipo"] != "Administrador":
                raise HTTPException(status_code=403, detail="Apenas um Administrador pode editar a conta de outro Administrador.")

            hash_senha = None
            if body.senha:
                if len(body.senha) < 6:
                    raise HTTPException(status_code=400, detail="Senha deve ter ao menos 6 caracteres.")
                hash_senha = pwd_ctx.hash(body.senha)

            # REGRA 3: Usuários comuns não podem alterar o próprio Cargo e Status de Atividade
            tipo_final  = body.tipo  if can_edit_others else None
            ativo_final = body.ativo if can_edit_others else None

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
                hash_senha,
                body.setor,
                tipo_final,
                ativo_final,
                usuario_id
            ))
            row = cur.fetchone()
            conn.commit()

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
async def deletar(
    usuario_id: int, 
    # Apenas Administrador e Gerente de Logística podem deletar usuários:
    usuario_logado: dict = Depends(exige_cargos(["Administrador", "Gerente-logistica"]))
):
    if usuario_logado["id"] == usuario_id:
        raise HTTPException(status_code=400, detail="Você não pode excluir o próprio usuário.")

    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            cur.execute("SELECT tipo FROM usuarios WHERE id = %s", (usuario_id,))
            target = cur.fetchone()
            if not target:
                raise HTTPException(status_code=404, detail="Usuário não encontrado.")

            # REGRA: Ninguém pode excluir um Administrador, a não ser outro Administrador
            if target["tipo"] == "Administrador":
                if usuario_logado["tipo"] != "Administrador":
                    raise HTTPException(status_code=403, detail="Apenas um Administrador pode excluir um usuário Administrador.")
                
                # Verifica se não é o último admin
                cur.execute("SELECT COUNT(*) as total FROM usuarios WHERE tipo = 'Administrador' AND ativo = TRUE")
                if cur.fetchone()["total"] <= 1:
                    raise HTTPException(status_code=400, detail="Não é possível excluir o único administrador ativo no sistema.")

            cur.execute("DELETE FROM usuarios WHERE id = %s", (usuario_id,))
            conn.commit()

        return {"ok": True}

    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao excluir: {str(e)}")
    finally:
        release_conn(conn)