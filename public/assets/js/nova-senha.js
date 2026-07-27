// ── ForteCare — Nova Senha ───────────────────────────────────────

const urlParams    = new URLSearchParams(window.location.search);
const token        = urlParams.get('token');
const primeiroAcesso = urlParams.get('first') === 'true';

// ── Adapta a UI conforme o fluxo ────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (primeiroAcesso) {
    // Fluxo: primeiro login — sessão JWT já está ativa via cookie
    document.getElementById('page-title').innerText = 'Bem-vindo ao ForteCare!';
    document.getElementById('page-sub').innerText   =
      'Por segurança, defina uma senha pessoal antes de continuar.';
    document.getElementById('back-link').style.display = 'none'; // Sem saída fácil
    document.getElementById('btn-salvar').disabled = false;

  } else {
    // Fluxo: recuperação por e-mail — requer token na URL
    document.getElementById('page-title').innerText = 'Redefinir Senha';
    document.getElementById('page-sub').innerText   = 'Digite sua nova senha abaixo';

    if (!token) {
      const errorEl = document.getElementById('error');
      errorEl.innerText     = 'Token de recuperação inválido ou ausente.';
      errorEl.style.display = 'block';
      document.getElementById('btn-salvar').disabled = true;
    }
  }
});

// Permite salvar ao apertar Enter no campo de confirmação
document.getElementById('confirma-senha')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') redefinirSenha();
});

async function redefinirSenha() {
  const novaSenha     = document.getElementById('nova-senha').value;
  const confirmaSenha = document.getElementById('confirma-senha').value;
  const errorEl       = document.getElementById('error');
  const btn           = document.getElementById('btn-salvar');

  // Reseta estilos do errorEl (pode ter sido usado para sucesso antes)
  errorEl.style.color           = '#991B1B';
  errorEl.style.backgroundColor = '#FEF2F2';
  errorEl.style.border          = '1px solid #fecaca';
  errorEl.style.display         = 'none';

  // ── Validações comuns ──────────────────────────────────────────
  if (!novaSenha || !confirmaSenha) {
    errorEl.innerText     = 'Preencha ambos os campos de senha.';
    errorEl.style.display = 'block';
    return;
  }

  if (novaSenha.length < 6) {
    errorEl.innerText     = 'A senha deve ter no mínimo 6 caracteres.';
    errorEl.style.display = 'block';
    return;
  }

  if (novaSenha !== confirmaSenha) {
    errorEl.innerText     = 'As senhas não coincidem.';
    errorEl.style.display = 'block';
    return;
  }

  btn.innerText = 'Salvando…';
  btn.disabled  = true;

  // ── Fluxo 1: Primeiro acesso (usa sessão JWT ativa via cookie) ─
  if (primeiroAcesso) {
    try {
      const res = await fetch('/api/auth/meu-perfil', {
        method:      'PUT',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ nova_senha: novaSenha })
      });

      const data = await res.json();

      if (!res.ok) {
        errorEl.innerText     = data.detail || 'Erro ao definir senha.';
        errorEl.style.display = 'block';
        btn.innerText         = 'Salvar Nova Senha';
        btn.disabled          = false;
        return;
      }

      // Atualiza sessão local: primeiro_acesso agora é false
      try {
        const session = JSON.parse(sessionStorage.getItem('fortecare_session') || '{}');
        session.primeiro_acesso = false;
        sessionStorage.setItem('fortecare_session', JSON.stringify(session));
      } catch (_) {}

      // Sucesso — redireciona para o sistema
      errorEl.style.color           = '#0f5132';
      errorEl.style.backgroundColor = '#d1e7dd';
      errorEl.style.border          = '1px solid #badbcc';
      errorEl.innerText     = 'Senha definida com sucesso! Entrando no sistema…';
      errorEl.style.display = 'block';

      setTimeout(() => {
        window.location.href = 'index.html';
      }, 1800);

    } catch (err) {
      errorEl.innerText     = 'Não foi possível conectar ao servidor.';
      errorEl.style.display = 'block';
      btn.innerText         = 'Salvar Nova Senha';
      btn.disabled          = false;
    }

  // ── Fluxo 2: Recuperação por e-mail (requer token) ────────────
  } else {
    if (!token) {
      errorEl.innerText     = 'Token de recuperação ausente. Solicite um novo link.';
      errorEl.style.display = 'block';
      btn.innerText         = 'Salvar Nova Senha';
      btn.disabled          = false;
      return;
    }

    try {
      const res = await fetch('/api/auth/redefinir-senha', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, nova_senha: novaSenha })
      });

      const data = await res.json();

      if (!res.ok) {
        errorEl.innerText     = data.detail || 'Erro ao redefinir senha.';
        errorEl.style.display = 'block';
        btn.innerText         = 'Salvar Nova Senha';
        btn.disabled          = false;
        return;
      }

      // Sucesso — volta para o login
      errorEl.style.color           = '#0f5132';
      errorEl.style.backgroundColor = '#d1e7dd';
      errorEl.style.border          = '1px solid #badbcc';
      errorEl.innerText     = 'Senha redefinida com sucesso! Redirecionando para o login…';
      errorEl.style.display = 'block';

      setTimeout(() => {
        window.location.href = 'login.html';
      }, 2500);

    } catch (err) {
      errorEl.innerText     = 'Não foi possível conectar ao servidor.';
      errorEl.style.display = 'block';
      btn.innerText         = 'Salvar Nova Senha';
      btn.disabled          = false;
    }
  }
}