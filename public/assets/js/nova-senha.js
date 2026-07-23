// Captura o token da URL assim que a página carrega
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');

// Se acessar a página sem token, bloqueia a ação
if (!token) {
  const errorEl = document.getElementById('error');
  errorEl.innerText = 'Token de recuperação inválido ou ausente.';
  errorEl.style.display = 'block';
  document.getElementById('btn-salvar').disabled = true;
}

// Permite salvar ao apertar Enter no campo de confirmação
document.getElementById('confirma-senha')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') redefinirSenha();
});

async function redefinirSenha() {
  const novaSenha     = document.getElementById('nova-senha').value;
  const confirmaSenha = document.getElementById('confirma-senha').value;
  const errorEl       = document.getElementById('error');
  const btn           = document.getElementById('btn-salvar');

  errorEl.style.display = 'none';

  if (!token) {
    errorEl.innerText = 'Token de recuperação ausente. Solicite um novo link.';
    errorEl.style.display = 'block';
    return;
  }

  if (!novaSenha || !confirmaSenha) {
    errorEl.innerText = 'Preencha ambos os campos de senha.';
    errorEl.style.display = 'block';
    return;
  }

  if (novaSenha.length < 6) {
    errorEl.innerText = 'A senha deve ter no mínimo 6 caracteres.';
    errorEl.style.display = 'block';
    return;
  }

  if (novaSenha !== confirmaSenha) {
    errorEl.innerText = 'As senhas não coincidem.';
    errorEl.style.display = 'block';
    return;
  }

  btn.innerText = 'Atualizando…';
  btn.disabled  = true;

  try {
    const res = await fetch('/api/auth/redefinir-senha', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, nova_senha: novaSenha })
    });

    const data = await res.json();

    if (!res.ok) {
      errorEl.style.color = '#842029';
      errorEl.style.backgroundColor = '#f8d7da';
      errorEl.style.border = '1px solid #f5c2c7';
      errorEl.innerText = data.detail || 'Erro ao redefinir senha.';
      errorEl.style.display = 'block';
      btn.innerText = 'Salvar Nova Senha';
      btn.disabled = false;
      return;
    }

    // Sucesso!
    errorEl.style.color = '#0f5132';
    errorEl.style.backgroundColor = '#d1e7dd';
    errorEl.style.border = '1px solid #badbcc';
    errorEl.innerText = 'Senha redefinida com sucesso! Redirecionando para o login…';
    errorEl.style.display = 'block';

    setTimeout(() => {
      window.location.href = 'login.html';
    }, 2500);

  } catch (err) {
    errorEl.style.color = '#842029';
    errorEl.style.backgroundColor = '#f8d7da';
    errorEl.style.border = '1px solid #f5c2c7';
    errorEl.innerText = 'Não foi possível conectar ao servidor.';
    errorEl.style.display = 'block';
    btn.innerText = 'Salvar Nova Senha';
    btn.disabled = false;
  }
}