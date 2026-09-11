"""
backend/audit.py
────────────────────────────────────────────────────────────────
Helper centralizado para registro de auditoria.
Usa conexão própria para nunca interromper a transação principal.
"""

from backend.database import get_conn, release_conn, get_cursor


def registrar_log(
    usuario_id,
    usuario_nome: str,
    acao: str,
    entidade: str = None,
    entidade_id=None,
    detalhe: str = None,
    ip: str = None,
):
    """
    Grava uma linha em logs_auditoria.
    Nunca levanta exceção — auditoria não pode quebrar o fluxo do sistema.
    """
    conn = None
    try:
        conn = get_conn()
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO logs_auditoria
                    (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhe, ip)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    usuario_id,
                    usuario_nome or "Sistema",
                    acao,
                    entidade,
                    str(entidade_id) if entidade_id is not None else None,
                    detalhe,
                    ip,
                ),
            )
            conn.commit()
    except Exception:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
    finally:
        if conn:
            release_conn(conn)
