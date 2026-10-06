// HeatSafe — resident log in, forgotten password, and reset-from-email.
//
// Three panels on one page:
//   default           email + password -> session -> My info
//   "Forgot?"         email -> reset link by email
//   ?reset=<token>    arrived from that link -> choose a new password

function showPanel(id) {
  ['login-panel', 'forgot-panel', 'reset-panel'].forEach((panel) => {
    document.getElementById(panel).hidden = panel !== id;
  });
}

function setMsg(id, text, kind) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `save-msg ${kind || ''}`.trim();
}

function goToMyInfo() {
  window.location.href = 'me.html';
}

// ── Log in ──────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('login-submit');
  btn.disabled = true;
  btn.textContent = 'Logging in…';
  setMsg('login-msg', '');

  try {
    const session = await loginResident(
      document.getElementById('login-email').value.trim(),
      document.getElementById('login-password').value
    );
    setResidentSession(session);
    goToMyInfo();
  } catch (err) {
    setMsg('login-msg', err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Log in';
  }
});

// ── Forgot password ─────────────────────────────────────
document.getElementById('show-forgot').addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('forgot-email').value = document.getElementById('login-email').value;
  showPanel('forgot-panel');
});

document.getElementById('back-to-login').addEventListener('click', (e) => {
  e.preventDefault();
  showPanel('login-panel');
});

document.getElementById('forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('forgot-submit');
  btn.disabled = true;
  try {
    const result = await requestPasswordReset(document.getElementById('forgot-email').value.trim());
    setMsg('forgot-msg', result.message, 'ok');
  } catch (err) {
    setMsg('forgot-msg', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ── Reset from emailed link ─────────────────────────────
const resetToken = new URLSearchParams(window.location.search).get('reset');

document.getElementById('reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('reset-password').value;
  if (password !== document.getElementById('reset-password-confirm').value) {
    setMsg('reset-msg', "Passwords don't match.", 'error');
    return;
  }

  const btn = document.getElementById('reset-submit');
  btn.disabled = true;
  try {
    const session = await resetPassword(resetToken, password);
    setResidentSession(session);
    // Drop the used token from the address bar before leaving.
    window.history.replaceState(null, '', 'login.html');
    goToMyInfo();
  } catch (err) {
    setMsg('reset-msg', err.message, 'error');
    btn.disabled = false;
  }
});

// ── Init ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (resetToken) {
    showPanel('reset-panel');
    return;
  }
  // Already logged in on this device? Skip straight to My info.
  if (getResidentSession()) {
    try {
      await fetchMyAccount();
      goToMyInfo();
      return;
    } catch {
      clearResidentSession(); // expired or revoked — show the form
    }
  }
  document.getElementById('login-email').focus();
});
