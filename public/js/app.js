/**
 * app.js
 * ---------------------------------------------------------------
 * Logic of the main page (app.html): dashboard, task list, create,
 * edit, complete, delete and file attachments.
 */

// Currently selected filter: 'all', 'pending' or 'completed'.
let currentStatus = 'all';

const taskList = document.getElementById('task-list');
const template = document.getElementById('task-template');

// ---------------------------------------------------------------
// Startup
// ---------------------------------------------------------------
async function init() {
  // Who is logged in? (redirects to the login page if nobody is)
  const { user } = await api('/api/auth/me');
  document.getElementById('user-name').textContent = user.name;
  await refresh();
}

/** Reloads the dashboard numbers and the task list. */
async function refresh() {
  await Promise.all([loadStats(), loadTasks()]);
}

// ---------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------
async function loadStats() {
  const stats = await api('/api/tasks/stats');
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-pending').textContent = stats.pending;
  document.getElementById('stat-completed').textContent = stats.completed;
  document.getElementById('stat-overdue').textContent = stats.overdue;
  document.getElementById('stat-percent').textContent = `${stats.percentCompleted}%`;
  // The ring is drawn with a CSS conic-gradient that reads --p.
  document.getElementById('progress-ring').style.setProperty('--p', stats.percentCompleted);
}

// ---------------------------------------------------------------
// Task list
// ---------------------------------------------------------------
async function loadTasks() {
  const { tasks } = await api(`/api/tasks?status=${currentStatus}`);
  taskList.replaceChildren(...tasks.map(renderTask));
  document.getElementById('empty').hidden = tasks.length > 0;
}

/** Formats '2026-11-24' as '24/11/2026'. */
function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

/** Today's date as 'YYYY-MM-DD' in the user's local time zone. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Formats a size in bytes as KB/MB. */
function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Builds the <li> element for one task from the HTML template.
 * We always use textContent (never innerHTML) for user data, so a
 * task title cannot inject HTML or scripts into the page (XSS).
 */
function renderTask(task) {
  const li = template.content.firstElementChild.cloneNode(true);
  li.classList.toggle('done', task.completed);

  li.querySelector('.task-title').textContent = task.title;
  li.querySelector('.task-description').textContent = task.description || '';

  // Due date, highlighted when the task is late.
  const meta = li.querySelector('.task-meta');
  if (task.dueDate) {
    const overdue = !task.completed && task.dueDate < today();
    meta.textContent = `Due ${formatDate(task.dueDate)}${overdue ? ' (overdue)' : ''}`;
    meta.classList.toggle('overdue', overdue);
  }

  // Attachments: name links to the download route, plus a remove button.
  const list = li.querySelector('.attachments');
  for (const file of task.attachments) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `/api/tasks/${task.id}/attachments/${file.id}`;
    link.textContent = `${file.name} (${formatSize(file.size)})`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'link-btn';
    remove.textContent = 'remove';
    remove.addEventListener('click', () => removeAttachment(task.id, file.id));
    item.append(link, ' ', remove);
    list.append(item);
  }

  // --- Complete / uncomplete ---
  const checkbox = li.querySelector('.task-done');
  checkbox.checked = task.completed;
  checkbox.addEventListener('change', () => updateTask(task.id, { completed: checkbox.checked }));

  // --- Edit ---
  const editForm = li.querySelector('.edit-form');
  li.querySelector('.edit').addEventListener('click', () => {
    editForm.elements.title.value = task.title;
    editForm.elements.dueDate.value = task.dueDate || '';
    editForm.elements.description.value = task.description || '';
    editForm.hidden = false;
  });
  li.querySelector('.cancel-edit').addEventListener('click', () => { editForm.hidden = true; });
  editForm.addEventListener('submit', (event) => {
    event.preventDefault();
    updateTask(task.id, Object.fromEntries(new FormData(editForm)));
  });

  // --- Delete ---
  li.querySelector('.delete').addEventListener('click', () => deleteTask(task));

  // --- Attach file (upload starts as soon as a file is chosen) ---
  const fileInput = li.querySelector('.file-input');
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) uploadAttachment(task.id, fileInput.files[0]);
  });

  return li;
}

// ---------------------------------------------------------------
// Actions
// ---------------------------------------------------------------

/** Wraps an action: runs it, refreshes the page data, shows errors. */
async function run(action, successMessage) {
  try {
    await action();
    await refresh();
    if (successMessage) showMessage(successMessage, 'success');
  } catch (err) {
    showMessage(err.message);
  }
}

function updateTask(id, changes) {
  return run(() => api(`/api/tasks/${id}`, { method: 'PUT', body: changes }));
}

function deleteTask(task) {
  if (!window.confirm(`Delete the task "${task.title}"?`)) return;
  return run(() => api(`/api/tasks/${task.id}`, { method: 'DELETE' }), 'Task deleted.');
}

function uploadAttachment(taskId, file) {
  if (file.size > 5 * 1024 * 1024) {
    showMessage('The file is larger than 5 MB.');
    return;
  }
  const form = new FormData();
  form.append('file', file);
  return run(() => api(`/api/tasks/${taskId}/attachments`, { method: 'POST', body: form }), 'File attached.');
}

function removeAttachment(taskId, attachmentId) {
  return run(() => api(`/api/tasks/${taskId}/attachments/${attachmentId}`, { method: 'DELETE' }));
}

// ---------------------------------------------------------------
// Page events
// ---------------------------------------------------------------

// Create a new task.
const taskForm = document.getElementById('task-form');
taskForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(taskForm));
  await run(async () => {
    await api('/api/tasks', { method: 'POST', body });
    taskForm.reset();
  }, 'Task added.');
});

// Filter buttons (All / Pending / Completed).
document.querySelectorAll('.filter').forEach((button) => {
  button.addEventListener('click', () => {
    currentStatus = button.dataset.status;
    document.querySelectorAll('.filter').forEach((b) => b.classList.toggle('active', b === button));
    loadTasks().catch((err) => showMessage(err.message));
  });
});

// Log out.
document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

init().catch((err) => showMessage(err.message));
