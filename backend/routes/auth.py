from fastapi import APIRouter, HTTPException, Response, Request, Depends
from passlib.context import CryptContext
from datetime import datetime, timedelta
from jose import jwt, JWTError
from dotenv import load_dotenv
from pydantic import BaseModel
from pathlib import Path
import os
import secrets
import smtplib
from email.mime.text import MIMEText

from backend.database import get_conn, release_conn, get_cursor
from backend.models import LoginInput
from backend.audit import registrar_log

# Carrega o .env com caminho absoluto — funciona independente do diretório de trabalho
load_dotenv(Path(__file__).parent.parent / ".env")

router = APIRouter(prefix="/api/auth", tags=["auth"])

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
SECRET  = os.getenv("JWT_SECRET", "fortecare_secret")
EXPIRES = int(os.getenv("JWT_EXPIRES_HOURS", 8))

# =========================================================
# MODELOS PYDANTIC PARA RECUPERAÇÃO DE SENHA
# =========================================================
class EsqueciSenhaInput(BaseModel):
    email: str

class RedefinirSenhaInput(BaseModel):
    token: str
    nova_senha: str

class MeuPerfilInput(BaseModel):
    nome: str | None = None
    nova_senha: str | None = None


# =========================================================
# FUNÇÕES AUXILIARES DE AUTENTICAÇÃO
# =========================================================
def criar_token(usuario: dict) -> str:
    payload = {
        "id":    usuario["id"],
        "nome":  usuario["nome"],
        "email": usuario["email"],
        "setor": usuario.get("setor"),
        "tipo":  usuario["tipo"],
        "exp":   datetime.utcnow() + timedelta(hours=EXPIRES),
    }
    return jwt.encode(payload, SECRET, algorithm="HS256")


def verificar_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(status_code=401, detail="Sessão expirada. Faça login novamente.")


def get_usuario_atual(request: Request) -> dict:
    token = request.cookies.get("fc_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Não autorizado.")
    return verificar_token(token)


def exige_cargos(cargos_permitidos: list):
    """
    Retorna uma dependência que verifica se o usuário logado
    possui um dos cargos permitidos na lista.
    """
    def verificador(usuario: dict = Depends(get_usuario_atual)):
        if usuario.get("tipo") not in cargos_permitidos:
            raise HTTPException(
                status_code=403, 
                detail="Você não tem permissão para realizar esta ação."
            )
        return usuario
    return verificador


# =========================================================
# FUNÇÃO DE ENVIO DE E-MAIL
# =========================================================
def enviar_email_recuperacao(destino: str, token: str):
    # O os.getenv busca o valor do .env. Se não encontrar, usa o valor padrão (2º parâmetro).
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", 587))
    smtp_user = os.getenv("SMTP_USER", "fortecareservice@gmail.com")
    smtp_pass = os.getenv("SMTP_PASS")  # Pega a senha de app do .env

    # Pega a URL do sistema do .env (padrão: http://localhost:8000)
    app_url = os.getenv("APP_URL", "http://localhost:8000")
    link_recuperacao = f"{app_url}/nova-senha.html?token={token}"

    corpo_email = f"""
    Olá,
    
    Você solicitou a recuperação da sua senha no sistema de Pós Vendas da ForteCare.
    Por favor, clique no link abaixo para criar uma nova senha:
    
    {link_recuperacao}
    
    Este link é válido por 10 minutos. Se você não solicitou essa alteração, ignore este e-mail.
    
    Atenciosamente,
    Equipe de TI ForteCare
    """

    msg = MIMEText(corpo_email)
    msg['Subject'] = 'ForteCare - Recuperação de Senha'
    msg['From'] = smtp_user
    msg['To'] = destino

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.send_message(msg)


# =========================================================
# ROTAS DA API
# =========================================================
@router.post("/login")
async def login(body: LoginInput, response: Response, request: Request):
    ip = request.client.host if request.client else None
    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT * FROM usuarios WHERE email = %s AND ativo = TRUE LIMIT 1",
                (body.email.strip().lower(),)
            )
            user = cur.fetchone()

        if not user or not pwd_ctx.verify(body.senha, user["senha_hash"]):
            registrar_log(
                usuario_id=user["id"] if user else None,
                usuario_nome=user["nome"] if user else body.email.strip().lower(),
                acao="LOGIN_FALHA",
                ip=ip,
                detalhe=f"E-mail tentado: {body.email.strip().lower()}",
            )
            raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")

        token = criar_token(dict(user))

        response.set_cookie(
            key="fc_token",
            value=token,
            httponly=True,
            samesite="lax",
            max_age=EXPIRES * 3600,
        )

        registrar_log(
            usuario_id=user["id"],
            usuario_nome=user["nome"],
            acao="LOGIN_OK",
            ip=ip,
        )

        usuario = {
            "id":             user["id"],
            "nome":           user["nome"],
            "email":          user["email"],
            "setor":          user["setor"],
            "tipo":           user["tipo"],
            "primeiro_acesso": user.get("primeiro_acesso", True),
        }

        return {"ok": True, "token": token, "usuario": usuario}

    finally:
        release_conn(conn)


@router.post("/logout")
async def logout(response: Response, request: Request):
    ip = request.client.host if request.client else None
    # Tenta extrair o usuário do token atual para logar
    try:
        token = request.cookies.get("fc_token")
        if token:
            from backend.routes.auth import verificar_token
            u = verificar_token(token)
            registrar_log(u["id"], u["nome"], "LOGOUT", ip=ip)
    except Exception:
        pass
    response.delete_cookie("fc_token")
    return {"ok": True}


@router.get("/me")
async def me(usuario: dict = Depends(get_usuario_atual)):
    return {"usuario": usuario}


@router.post("/renovar")
async def renovar_token(response: Response, usuario: dict = Depends(get_usuario_atual)):
    """Renova o token JWT antes de expirar — chamado automaticamente pelo frontend."""
    conn = get_conn()
    try:
        # Busca dados frescos do banco para garantir que o usuário ainda existe e está ativo
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT id, nome, email, setor, tipo, ativo FROM usuarios WHERE id = %s AND ativo = TRUE LIMIT 1",
                (usuario["id"],)
            )
            user = cur.fetchone()

        if not user:
            raise HTTPException(status_code=401, detail="Usuário inativo ou não encontrado.")

        token = criar_token(dict(user))
        response.set_cookie(
            key="fc_token", value=token,
            httponly=True, samesite="lax",
            max_age=EXPIRES * 3600,
        )
        return {"ok": True, "token": token}
    finally:
        release_conn(conn)


@router.post("/esqueci-senha")
async def esqueci_senha(body: EsqueciSenhaInput):
    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            cur.execute("SELECT id FROM usuarios WHERE email = %s AND ativo = TRUE", (body.email.strip().lower(),))
            usuario = cur.fetchone()

            if not usuario:
                # Retorna ok mesmo sem existir por segurança (evita enumeração de usuários)
                return {"ok": True, "detail": "Se o e-mail existir, um link será enviado."}

            usuario_id = usuario["id"]
            token = secrets.token_urlsafe(32)
            expira_em = datetime.now() + timedelta(minutes=10)  # Token válido por 10 minutos

            cur.execute("""
                INSERT INTO password_resets (usuario_id, token, expira_em, usado, criado_em)
                VALUES (%s, %s, %s, FALSE, NOW())
            """, (usuario_id, token, expira_em))
            conn.commit()

            enviar_email_recuperacao(body.email, token)

        return {"ok": True, "detail": "Se o e-mail existir, um link será enviado em instantes."}

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail="Erro interno ao processar a solicitação.")
    finally:
        release_conn(conn)


@router.put("/meu-perfil")
async def meu_perfil(body: MeuPerfilInput, usuario: dict = Depends(get_usuario_atual)):
    """Permite ao usuário logado alterar o próprio nome e/ou senha.
    Ao alterar a senha, marca primeiro_acesso = FALSE automaticamente."""

    if not body.nome and not body.nova_senha:
        raise HTTPException(status_code=400, detail="Informe ao menos um campo para atualizar.")

    if body.nova_senha and len(body.nova_senha) < 6:
        raise HTTPException(status_code=400, detail="A senha deve ter no mínimo 6 caracteres.")

    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            if body.nome and body.nova_senha:
                hash_senha = pwd_ctx.hash(body.nova_senha)
                cur.execute(
                    """UPDATE usuarios
                       SET nome = %s, senha_hash = %s, primeiro_acesso = FALSE, atualizado_em = NOW()
                       WHERE id = %s""",
                    (body.nome.strip(), hash_senha, usuario["id"])
                )
            elif body.nova_senha:
                hash_senha = pwd_ctx.hash(body.nova_senha)
                cur.execute(
                    """UPDATE usuarios
                       SET senha_hash = %s, primeiro_acesso = FALSE, atualizado_em = NOW()
                       WHERE id = %s""",
                    (hash_senha, usuario["id"])
                )
            else:
                cur.execute(
                    """UPDATE usuarios
                       SET nome = %s, atualizado_em = NOW()
                       WHERE id = %s""",
                    (body.nome.strip(), usuario["id"])
                )
            conn.commit()

        if body.nova_senha:
            registrar_log(usuario["id"], usuario["nome"], "SENHA_ALTERADA",
                          detalhe="Senha alterada pelo próprio usuário via perfil.")

        return {"ok": True, "detail": "Perfil atualizado com sucesso."}

    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar perfil: {str(e)}")
    finally:
        release_conn(conn)


@router.post("/redefinir-senha")
async def redefinir_senha(body: RedefinirSenhaInput):
    if len(body.nova_senha) < 6:
        raise HTTPException(status_code=400, detail="A nova senha deve ter no mínimo 6 caracteres.")

    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            # 1. Verifica se o token existe e é válido
            cur.execute("""
                SELECT usuario_id, expira_em, usado 
                FROM password_resets 
                WHERE token = %s
            """, (body.token,))
            reset_req = cur.fetchone()

            if not reset_req:
                raise HTTPException(status_code=400, detail="Link de recuperação inválido.")
            if reset_req["usado"]:
                raise HTTPException(status_code=400, detail="Este link já foi utilizado.")
            if datetime.now() > reset_req["expira_em"]:
                raise HTTPException(status_code=400, detail="Este link de recuperação expirou. Solicite um novo.")

            # 2. Gera o novo hash da senha e atualiza o usuário
            hash_senha = pwd_ctx.hash(body.nova_senha)
            cur.execute("""
                UPDATE usuarios 
                SET senha_hash = %s, atualizado_em = NOW() 
                WHERE id = %s
            """, (hash_senha, reset_req["usuario_id"]))

            # 3. Invalida o token para não ser usado novamente
            cur.execute("""
                UPDATE password_resets 
                SET usado = TRUE 
                WHERE token = %s
            """, (body.token,))

            conn.commit()

        # Busca nome do usuário para o log
        try:
            conn2 = get_conn()
            with get_cursor(conn2) as cur2:
                cur2.execute("SELECT id, nome FROM usuarios WHERE id = %s", (reset_req["usuario_id"],))
                u = cur2.fetchone()
            release_conn(conn2)
            if u:
                registrar_log(u["id"], u["nome"], "SENHA_REDEFINIDA",
                              detalhe="Senha redefinida via link de recuperação por e-mail.")
        except Exception:
            pass

        return {"ok": True, "detail": "Senha atualizada com sucesso!"}

    except HTTPException:
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Erro ao redefinir a senha: {str(e)}")
    finally:
        release_conn(conn)