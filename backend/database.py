import psycopg2
import psycopg2.extras
from psycopg2 import pool as pg_pool
from dotenv import load_dotenv
import os

load_dotenv()

# Pool de conexões — reutiliza conexões ao banco sem abrir uma nova a cada request
_pool = pg_pool.SimpleConnectionPool(
    minconn=1,
    maxconn=10,
    host=os.getenv("DB_HOST", "10.0.0.247"),
    port=int(os.getenv("DB_PORT", 5432)),
    user=os.getenv("DB_USER", "postgres"),
    password=os.getenv("DB_PASS", ""),
    database=os.getenv("DB_NAME", "postgres"),
)

def get_conn():
    """Pega uma conexão do pool."""
    return _pool.getconn()

def release_conn(conn):
    """Devolve a conexão para o pool."""
    _pool.putconn(conn)

def get_cursor(conn):
    """Retorna um cursor que devolve linhas como dicionários."""
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)