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