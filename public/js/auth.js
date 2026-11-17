/**
 * auth.js
 * ---------------------------------------------------------------
 * Logic of the login / registration page (index.html).
 */

// If the user is already logged in, skip the login page.
api('/api/auth/me')
  .then(() => { window.location.href = '/app.html'; })
  .catch(() => { /* not logged in: stay on this page */ });

// --- Switch between the "Log in" and "Create account" tabs ---
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.form').forEach((form) => {
      form.hidden = form.id !== tab.dataset.form;
    });
    document.getElementById('message').hidden = true;
  });
});

/**
 * Sends a form to the API and, if it works, opens the tasks page.
 * @param {HTMLFormElement} form
 * @param {string} url
 */
function handleAuthForm(form, url) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); // do not reload the page
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;

    try {
      // Turn the form fields into an object: { email: '...', password: '...' }
      const body = Object.fromEntries(new FormData(form));
      await api(url, { method: 'POST', body });
      window.location.href = '/app.html';
    } catch (err) {
      showMessage(err.message);
    } finally {
      button.disabled = false;
    }
  });
}

handleAuthForm(document.getElementById('login-form'), '/api/auth/login');
handleAuthForm(document.getElementById('register-form'), '/api/auth/register');
