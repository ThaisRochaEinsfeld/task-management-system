/**
 * api.js
 * ---------------------------------------------------------------
 * Small helpers shared by the pages to talk to the backend API.
 */

/**
 * Calls the API and returns the JSON response.
 * Throws an Error with the server's message when the request fails.
 *
 * @param {string} url     e.g. '/api/tasks'
 * @param {object} options fetch options; `body` may be an object
 *                         (sent as JSON) or a FormData (file upload)
 */
async function api(url, options = {}) {
  const init = { method: options.method || 'GET', headers: {} };

  if (options.body instanceof FormData) {
    init.body = options.body; // the browser sets the multipart header
  } else if (options.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, init);

  // Not logged in (or session expired): go back to the login page.
  if (response.status === 401 && !url.startsWith('/api/auth/')) {
    window.location.href = '/';
    throw new Error('Not logged in');
  }

  // 204 No Content has no body.
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}

/** Shows a message in the #message element (error by default). */
function showMessage(text, type = 'error') {
  const el = document.getElementById('message');
  el.textContent = text;
  el.className = `message ${type}`;
  el.hidden = false;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => { el.hidden = true; }, 5000);
}
