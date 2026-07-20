// Only login Screen

const USERS_KEY = 'fortecare_users';

// Usuário padrão criado na primeira vez que o sistema é aberto
(function seedDefaultUsers() {
    try {
        const users = JSON.parse(localStorage.getItem(USERS_KEY)) || [];
        if (users.length === 0) {
            localStorage.setItem(USERS_KEY, JSON.stringify([{
                id: 1,
                nome: 'Helton Ribeiro',
                email: 'admin@fortecare.com',
                senha: 'fortecare123',
                setor: 'Administrador',
                tipo: 'Administrador'
            }]));
        }
    } catch { }
})();

// Enter no campo de senha aciona o login
document.getElementById('senha').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tentarLogin();
});

function tentarLogin() {
    const email = document.getElementById('email').value.trim().toLowerCase();
    const senha = document.getElementById('senha').value;
    const errorEl = document.getElementById('error');
    const btn = document.getElementById('btn-entrar');

    errorEl.style.display = 'none';

    if (!email || !senha) {
        errorEl.innerText = 'Informe e-mail e senha.';
        errorEl.style.display = 'block';
        return;
    }

    let users = [];
    try { users = JSON.parse(localStorage.getItem(USERS_KEY)) || []; } catch { }

    const user = users.find(u => u.email.toLowerCase() === email && u.senha === senha);

    if (!user) {
        errorEl.innerText = 'E-mail ou senha incorretos.';
        errorEl.style.display = 'block';
        document.getElementById('senha').value = '';
        document.getElementById('senha').focus();
        return;
    }

    // Salva sessão e redireciona para o app
    try {
        sessionStorage.setItem('fortecare_session', JSON.stringify({
            id: user.id,
            nome: user.nome,
            email: user.email,
            setor: user.setor,
            tipo: user.tipo
        }));
    } catch { }

    btn.innerText = 'Carregando…';
    btn.disabled = true;
    window.location.href = 'index.html';
}