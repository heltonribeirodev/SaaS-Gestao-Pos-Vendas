// ── ForteCare — Login via API ────────────────────────────────────

document.getElementById('senha').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tentarLogin();
});

async function tentarLogin() {
  const email   = document.getElementById('email').value.trim().toLowerCase();
  const senha   = document.getElementById('senha').value;
  const errorEl = document.getElementById('error');
  const btn     = document.getElementById('btn-entrar');

  errorEl.style.display = 'none';

  if (!email || !senha) {
    errorEl.innerText     = 'Informe e-mail e senha.';
    errorEl.style.display = 'block';
    return;
  }

  btn.innerText = 'Entrando…';
  btn.disabled  = true;

  try {
    const res = await fetch('/api/auth/login', {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ email, senha })
    });

    const data = await res.json();

    if (!res.ok) {
      errorEl.innerText     = data.detail || 'E-mail ou senha incorretos.';
      errorEl.style.display = 'block';
      btn.innerText         = 'Entrar';
      btn.disabled          = false;
      document.getElementById('senha').value = '';
      document.getElementById('senha').focus();
      return;
    }

    // Salva sessão para o app usar
    sessionStorage.setItem('fortecare_session', JSON.stringify(data.usuario));
    sessionStorage.setItem('fortecare_token',   data.token);

    btn.innerText = 'Carregando…';
    window.location.href = 'index.html';

  } catch (err) {
    errorEl.innerText     = 'Não foi possível conectar ao servidor.';
    errorEl.style.display = 'block';
    btn.innerText         = 'Entrar';
    btn.disabled          = false;
  }
}


// REDEFINIR SENHA
async function solicitarRecuperacao(event) {
  event.preventDefault(); // Evita que a página recarregue ao clicar no link
  
  const email = document.getElementById('email').value.trim().toLowerCase();
  const errorEl = document.getElementById('error');
  const btn = document.getElementById('btn-entrar');

  errorEl.style.display = 'none';

  if (!email) {
    errorEl.innerText = 'Por favor, preencha o campo de e-mail para recuperar sua senha.';
    errorEl.style.display = 'block';
    document.getElementById('email').focus();
    return;
  }

  btn.innerText = 'Enviando e-mail...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/auth/esqueci-senha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });

    const data = await res.json();

    if (!res.ok) {
      errorEl.innerText = data.detail || 'Erro ao solicitar recuperação de senha.';
      errorEl.style.display = 'block';
    } else {
      // Usando a div de erro para mostrar sucesso (você pode criar uma div de sucesso se preferir)
      errorEl.style.color = '#0f5132';
      errorEl.style.backgroundColor = '#d1e7dd';
      errorEl.style.border = '1px solid #badbcc';
      errorEl.innerText = 'Se o e-mail existir, um link de recuperação será enviado em instantes.';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.innerText = 'Não foi possível conectar ao servidor.';
    errorEl.style.display = 'block';
  } finally {
    btn.innerText = 'Entrar';
    btn.disabled = false;
  }
}