from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import date, datetime


# ── Auth ─────────────────────────────────────────────────────────
class LoginInput(BaseModel):
    email: str
    senha: str


class UsuarioSessao(BaseModel):
    id: int
    nome: str
    email: str
    setor: Optional[str] = None
    tipo: str


# ── Usuários ─────────────────────────────────────────────────────
class UsuarioCreate(BaseModel):
    nome: str
    email: str
    senha: str
    setor: Optional[str] = None
    tipo: str = "Operador"


class UsuarioUpdate(BaseModel):
    nome: Optional[str] = None
    email: Optional[str] = None
    senha: Optional[str] = None
    setor: Optional[str] = None
    tipo: Optional[str] = None
    ativo: Optional[bool] = None


class UsuarioOut(BaseModel):
    id: int
    nome: str
    email: str
    setor: Optional[str] = None
    tipo: str
    ativo: bool
    criado_em: Optional[datetime] = None


# ── Pedidos ──────────────────────────────────────────────────────
class PedidoCreate(BaseModel):
    nf: str
    vendedor: Optional[str] = None
    valor_nf: Optional[float] = 0
    valor_frete: Optional[float] = 0
    pct_frete: Optional[float] = 0
    transportadora: Optional[str] = None
    emissao: date
    destinatario: str
    uf: Optional[str] = None
    municipio: Optional[str] = None
    previsao: Optional[date] = None
    entrega: Optional[date] = None
    dias: Optional[int] = 0
    contato: Optional[str] = None
    status: str = "EM TRÂNSITO"
    obs: Optional[str] = None


class PedidoUpdate(BaseModel):
    status: Optional[str] = None
    entrega: Optional[date] = None
    obs: Optional[str] = None
    contato: Optional[str] = None
    previsao: Optional[date] = None
    vendedor: Optional[str] = None
    transportadora: Optional[str] = None
    valor_nf: Optional[float] = None
    valor_frete: Optional[float] = None


class PedidoImportar(BaseModel):
    """Schema flexível para importação em lote via CSV/XLSX."""
    nf: Optional[str] = None
    id: Optional[str] = None          # fallback para nf
    vendedor: Optional[str] = None
    valor_nf: Optional[float] = 0
    valorNF: Optional[float] = None   # nome alternativo vindo do JS
    valor_frete: Optional[float] = 0
    valorC: Optional[float] = None    # nome alternativo vindo do JS
    pct_frete: Optional[float] = 0
    pct: Optional[float] = None
    transportadora: Optional[str] = None
    emissao: Optional[str] = None
    destinatario: Optional[str] = None
    uf: Optional[str] = None
    municipio: Optional[str] = None
    previsao: Optional[str] = None
    entrega: Optional[str] = None
    dias: Optional[int] = 0
    contato: Optional[str] = None
    status: str = "EM TRÂNSITO"
    obs: Optional[str] = None


class ImportarPayload(BaseModel):
    pedidos: list[PedidoImportar]