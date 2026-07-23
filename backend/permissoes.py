# ═══════════════════════════════════════════════════════════════
# FORTECARE — Permissões Centralizadas
# Todas as regras de acesso ficam aqui — nunca espalhadas nas rotas
# ═══════════════════════════════════════════════════════════════

TIPOS_VALIDOS = [
    "Administrador",
    "Gerente de Logística",
    "Gerente",
    "Operador",
    "Vendedor",
]

# ── Pedidos ──────────────────────────────────────────────────────
PODE_CRIAR_PEDIDO   = {"Administrador", "Gerente de Logística", "Operador"}
PODE_EDITAR_PEDIDO  = {"Administrador", "Gerente de Logística", "Operador"}
PODE_EXCLUIR_PEDIDO = {"Administrador", "Gerente de Logística", "Operador"}
# Gerente vê tudo mas não pode criar/editar/excluir
PODE_VER_TODOS      = {"Administrador", "Gerente de Logística", "Gerente", "Operador"}

# ── Usuários ─────────────────────────────────────────────────────
PODE_LISTAR_USUARIOS  = {"Administrador", "Gerente de Logística", "Operador"}
PODE_CRIAR_USUARIO    = {"Administrador", "Gerente de Logística"}
PODE_EDITAR_USUARIO   = {"Administrador", "Gerente de Logística"}
PODE_EXCLUIR_USUARIO  = {"Administrador", "Gerente de Logística"}
PODE_CRIAR_ADMIN      = {"Administrador"}  # único que pode criar outro Admin

# ── De-Para ───────────────────────────────────────────────────────
PODE_GERENCIAR_DEPARA = {"Administrador", "Gerente de Logística", "Operador"}

# ── Painel de Administração ───────────────────────────────────────
PODE_VER_PAINEL_ADMIN = {"Administrador", "Gerente de Logística", "Operador"}

def check(tipo: str, permitidos: set) -> bool:
    return tipo in permitidos