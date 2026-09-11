"""
migrate_add_logs.py
────────────────────────────────────────────────────────────────
Cria a tabela logs_auditoria no banco PostgreSQL.

Como executar (terminal do VS Code, dentro da pasta projeto-web):
    python migrate_add_logs.py
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv
import psycopg2

# Carrega variáveis do .env da pasta backend/
load_dotenv(Path(__file__).parent / "backend" / ".env")

DSN = os.getenv("DATABASE_URL") or (
    f"host={os.getenv('DB_HOST','localhost')} "
    f"port={os.getenv('DB_PORT','5432')} "
    f"dbname={os.getenv('DB_NAME')} "
    f"user={os.getenv('DB_USER')} "
    f"password={os.getenv('DB_PASS')}"
)

SQL = """
-- ── Tabela principal de auditoria ────────────────────────────
CREATE TABLE IF NOT EXISTS logs_auditoria (
    id           SERIAL       PRIMARY KEY,
    usuario_id   INTEGER      REFERENCES usuarios(id) ON DELETE SET NULL,
    usuario_nome TEXT         NOT NULL,
    acao         TEXT         NOT NULL,
    entidade     TEXT,        -- ex: 'pedidos', 'usuarios'
    entidade_id  TEXT,        -- id do registro afetado
    detalhe      TEXT,        -- JSON com contexto (campo, de, para, etc.)
    ip           TEXT,
    criado_em    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Índices para consultas rápidas ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_logs_criado_em   ON logs_auditoria(criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_logs_acao        ON logs_auditoria(acao);
CREATE INDEX IF NOT EXISTS idx_logs_usuario_id  ON logs_auditoria(usuario_id);
"""

def main():
    print("Conectando ao banco de dados...")
    try:
        conn = psycopg2.connect(DSN)
        conn.autocommit = False
        cur = conn.cursor()
        print("Executando migration...")
        cur.execute(SQL)
        conn.commit()
        cur.close()
        conn.close()
        print("✅  Tabela logs_auditoria criada com sucesso!")
    except Exception as e:
        print(f"❌  Erro: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
