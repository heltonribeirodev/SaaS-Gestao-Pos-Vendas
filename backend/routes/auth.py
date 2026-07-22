from fastapi import APIRouter, HTTPException, Response, Request, Depends
from passlib.context import CryptContext
from datetime import datetime, timedelta
from jose import jwt, JWTError
from dotenv import load_dotenv
import os

from backend.database import get_conn, release_conn, get_cursor
from backend.models import LoginInput

load_dotenv()

router = APIRouter(prefix="/api/auth", tags=["auth"])

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
SECRET  = os.getenv("JWT_SECRET", "fortecare_secret")
EXPIRES = int(os.getenv("JWT_EXPIRES_HOURS", 8))


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

# ---------------------------------------------------------
# NOVA FUNÇÃO DE TRAVA POR CARGO ADICIONADA AQUI
# ---------------------------------------------------------
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
# ---------------------------------------------------------


@router.post("/login")
async def login(body: LoginInput, response: Response):
    conn = get_conn()
    try:
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT * FROM usuarios WHERE email = %s AND ativo = TRUE LIMIT 1",
                (body.email.strip().lower(),)
            )
            user = cur.fetchone()

        # Validação segura utilizando o hash do bcrypt
        if not user or not pwd_ctx.verify(body.senha, user["senha_hash"]):
            raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")

        token = criar_token(dict(user))

        response.set_cookie(
            key="fc_token",
            value=token,
            httponly=True,
            samesite="lax",
            max_age=EXPIRES * 3600,
        )

        usuario = {
            "id":    user["id"],
            "nome":  user["nome"],
            "email": user["email"],
            "setor": user["setor"],
            "tipo":  user["tipo"],
        }

        return {"ok": True, "token": token, "usuario": usuario}

    finally:
        release_conn(conn)


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("fc_token")
    return {"ok": True}


@router.get("/me")
async def me(usuario: dict = Depends(get_usuario_atual)):
    return {"usuario": usuario}