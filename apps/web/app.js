const WEBSITE_URL = document.querySelector('meta[name="website-url"]')?.content || 'http://localhost:3001';
// app.js — Kabonix Foundation Staff Portal (Sprint 01–03)
// Admin & Governance control room + M&E data collection UI.

const API = (document.querySelector('meta[name="api-url"]')?.content || 'http://localhost:4000') + '/api';

const state = {
  token: lsGet('kabonix_token'),
  user: null, roles: [], permissions: [],
  route: 'dashboard', routeParam: null,
};

// Top-level `const` in a classic script does NOT become a window property, so
// ai.js could never see the session. Mirror it explicitly.
window.state = state;

function lsGet(k)    { try { return localStorage.getItem(k); } catch { return (window.__m||{})[k]||null; } }
function lsSet(k,v)  { try { localStorage.setItem(k,v); } catch { window.__m=window.__m||{}; window.__m[k]=v; } }
function lsDel(k)    { try { localStorage.removeItem(k); } catch { if(window.__m) delete window.__m[k]; } }

const root = document.getElementById('root');

async function api(path, opts={}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type':'application/json', ...(state.token?{Authorization:`Bearer ${state.token}`}:{}), ...(opts.headers||{}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ai.js calls window.api(...) — expose it so the AI workspace can reach the
// same authenticated fetch wrapper.
window.api = api;

function can(module, level) { return state.permissions.some(p=>p.module===module&&p.level===level); }

// Toasts stack instead of overlapping at the same fixed position.
function toast(msg, isErr) {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = Object.assign(document.createElement('div'), { id: 'toast-stack' });
    document.body.appendChild(stack);
  }
  const el = Object.assign(document.createElement('div'), { className:'toast'+(isErr?' error':''), textContent:msg });
  stack.appendChild(el);
  setTimeout(()=>el.remove(), 3400);
}

function esc(s) {
  if (s==null) return '';
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function ago(ts) {
  if (!ts) return '—';
  const s = Math.round((Date.now()-new Date(ts))/1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return new Date(ts).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}

// Normalise list-shaped API payloads ({ users:[…] } vs […]) so the UI never
// crashes on a shape change.
function asArray(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  return [];
}

// ── Session ──────────────────────────────────────────────────────────────────
async function tryRestoreSession() {
  if (!state.token) return render();
  try {
    const d = await api('/auth/me');
    state.user = d.user; state.roles = d.roles; state.permissions = d.permissions;
  } catch { state.token=null; lsDel('kabonix_token'); }
  render();
}

async function login(email, password) {
  const d = await api('/auth/login',{method:'POST',body:{email,password}});
  if (d.mfaRequired) return d; // caller handles MFA step
  state.token=d.accessToken; state.user=d.user; state.roles=d.roles; state.permissions=d.permissions;
  lsSet('kabonix_token', d.accessToken);
  state.route='dashboard'; render();
}

async function submitMfa(challengeToken, code) {
  const d = await api('/auth/mfa/challenge',{method:'POST',body:{challengeToken,code}});
  state.token=d.accessToken; state.user=d.user; state.roles=d.roles; state.permissions=d.permissions;
  lsSet('kabonix_token', d.accessToken);
  state.route='dashboard'; render();
}

function logout() {
  state.token=null; state.user=null; state.roles=[]; state.permissions=[];
  lsDel('kabonix_token'); render();
}

// ── Router ───────────────────────────────────────────────────────────────────
function nav(route, param) { state.route=route; state.routeParam=param||null; render(); }

function render() {
  if (!state.token||!state.user) return renderLogin();
  const views = {
    dashboard: renderDashboard,
    users:     renderUsers,
    roles:     renderRoles,
    config:    renderConfig,
    audit:     renderAudit,
    forms:     renderForms,
    messages:  renderMessages,
    profile:   renderProfile,
  };
  (views[state.route]||renderDashboard)();
}

// ── Login ────────────────────────────────────────────────────────────────────
function renderLogin(mfaChallenge) {
  root.innerHTML = `
<div class="login-screen">
  <div class="login-visual">
    <div class="mark">KABONIX FOUNDATION</div>
    <h1>Digital Ecosystem Platform</h1>
    <p>Staff & field officer portal. Collect, manage and act on programme data.</p>
    <div class="login-pills">
      <span>🌊 Blue Economy</span><span>🌱 Carbon</span><span>⚡ Renewable Energy</span><span>👩‍💼 Youth & Women</span>
    </div>
  </div>
  <div class="login-form-side">
    <div class="login-card">
      ${mfaChallenge ? `
        <h2>Two-factor authentication</h2>
        <p class="sub">Enter the 6-digit code from your authenticator app.</p>
        <div class="field"><label>Authentication code</label><input id="l-code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"></div>
        <button class="btn-primary" id="mfa-btn">Verify</button>
        <p class="hint"><a href="#" id="back-link">← Back to sign in</a></p>
      ` : `
        <h2>Sign in</h2>
        <p class="sub">Foundation staff and field officers only.</p>
        <div class="field"><label>Email</label><input id="l-email" type="email" value="admin@kabonix.org"></div>
        <div class="field"><label>Password</label><input id="l-pw" type="password" value="ChangeMe123!"></div>
        <button class="btn-primary" id="login-btn">Sign in</button>
        <p class="hint">Seeded accounts: <strong>admin@kabonix.org</strong> (Super Admin) · <strong>amina@kabonix.org</strong> (Field Officer) — password: <strong>ChangeMe123!</strong></p>
      `}
      <div id="l-err" class="err-msg"></div>
    </div>
  </div>
</div>`;
  if (mfaChallenge) {
    const code = document.getElementById('l-code');
    code.focus();
    document.getElementById('mfa-btn').onclick = async () => {
      try { await submitMfa(mfaChallenge, code.value.trim()); }
      catch(e) { document.getElementById('l-err').textContent = e.message; }
    };
    document.getElementById('back-link').onclick = e => { e.preventDefault(); render(); };
  } else {
    document.getElementById('login-btn').onclick = doLogin;
    document.getElementById('l-pw').onkeydown = e => { if(e.key==='Enter') doLogin(); };
  }
}

async function doLogin() {
  const email = document.getElementById('l-email').value.trim();
  const pw    = document.getElementById('l-pw').value;
  const err   = document.getElementById('l-err');
  err.textContent = '';
  try {
    const d = await login(email, pw);
    if (d?.mfaRequired) renderLogin(d.challengeToken);
  } catch(e) { err.textContent = e.message; }
}

// ── Shell ─────────────────────────────────────────────────────────────────────
function shell(contentHtml, activeRoute) {
  const items = [
    { key:'dashboard', icon:'◉', label:'Dashboard' },
    can('data_collection','view') && { key:'forms', icon:'📋', label:'M&E Collection' },
    can('admin','view') && { key:'users', icon:'👥', label:'Staff & Users' },
    can('admin','view') && { key:'roles', icon:'🔐', label:'Roles & Permissions' },
    can('admin','view') && { key:'config', icon:'⚙️', label:'System Config' },
    can('admin','view') && { key:'messages', icon:'✉️', label:'Contact Messages' },
    (can('admin','view')||can('data_collection','approve')) && { key:'audit', icon:'📜', label:'Audit Log' },
  ].filter(Boolean);

  root.innerHTML = `
<div class="app-shell">
  <aside class="sidebar">
    <div class="sb-brand">
      <button id="sb-toggle" aria-label="Toggle menu">☰</button>
      <a class="sb-brand-link" href="${WEBSITE_URL}" target="_blank" rel="noopener">
        <div class="sb-logo"><img src="/assets/logo.png" class="sb-logo-img" onerror="this.style.display='none'" alt="Kabonix logo"></div>
      </a>
      <div><div class="sb-name">KABONIX</div><div class="sb-sub">FOUNDATION</div></div>
    </div>
    <nav class="sb-nav">
        ${items.map(i=>`<a class="nav-item${state.route===i.key?' active':''}" data-route="${i.key}">
          <span class="nav-icon">${i.icon}</span><span class="nav-label">${esc(i.label)}</span></a>`).join('')}
    </nav>
    <div class="sb-foot">
      <a class="nav-item" data-route="profile"><span class="nav-icon">👤</span>${esc(state.user.name.split(' ')[0])}</a>
      <button class="sb-logout" id="logout-btn">Sign out</button>
    </div>
  </aside>
  <main class="main-area" id="main">${contentHtml}</main>
</div>`;
  root.querySelectorAll('.nav-item[data-route]').forEach(el => el.onclick = e => { e.preventDefault(); nav(el.dataset.route); });
  document.getElementById('logout-btn').onclick = logout;

  // Mobile drawer only — the desktop sidebar is always visible.
  const sbToggle = document.getElementById('sb-toggle');
  const appShell = document.querySelector('.app-shell');
  if (sbToggle && appShell) {
    sbToggle.onclick = () => appShell.classList.toggle('sidebar-open');
  }
  // Close on overlay tap, Escape, or resizing past the breakpoint.
  if (appShell) {
    appShell.addEventListener('click', e => {
      if (!appShell.classList.contains('sidebar-open')) return;
      if (e.target.closest('.sidebar') || e.target.closest('#sb-toggle')) return;
      appShell.classList.remove('sidebar-open');
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') appShell.classList.remove('sidebar-open');
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 800) appShell.classList.remove('sidebar-open');
    });
  }
}

function pageHead(title, sub='') {
  return `<div class="page-head"><h1>${esc(title)}</h1>${sub?`<p>${esc(sub)}</p>`:''}</div>`;
}

function card(content, cls='') { return `<div class="card ${cls}">${content}</div>`; }

// ── Dashboard ────────────────────────────────────────────────────────────────
async function renderDashboard() {
  shell(`${pageHead('Dashboard','Loading…')}`, 'dashboard');
  let stats = {};
  try { stats = await api('/admin/stats'); } catch {}

  const me = state.user;
  const roleNames = state.roles.map(r=>r.name).join(', ')||'No roles assigned';

  shell(`
    ${pageHead('Dashboard', `Welcome back, ${me.name.split(' ')[0]}. ${new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}.`)}
    <div class="stat-row">
      ${statCard('Active staff',     stats.activeUsers       ?? '—', '👥')}
      ${statCard('Submissions',      stats.submissions        ?? '—', '📋')}
      ${statCard('Audit events (24h)',stats.auditEventsToday ?? '—', '📜')}
      ${statCard('New enquiries',    stats.newContactMessages ?? '—', '✉️')}
    </div>
    <div class="two-col">
      ${card(`<h3>Your access</h3>
        <p class="meta">${esc(roleNames)}</p>
        <table class="mini-table"><tbody>
          ${Object.entries(groupPerms(state.permissions)).map(([m,ls])=>`<tr><td>${esc(m)}</td><td>${ls.map(l=>`<span class="badge">${l}</span>`).join('')}</td></tr>`).join('')}
        </tbody></table>`, 'card-inner')}
      ${card(`<h3>Quick actions</h3>
        <div class="quick-actions">
          ${can('data_collection','create') ? `<button class="qa-btn" onclick="nav('forms')">📋 Submit M&E form</button>` : ''}
          ${can('admin','create')           ? `<button class="qa-btn" onclick="nav('users')">➕ Invite staff member</button>` : ''}
          ${can('admin','view')             ? `<button class="qa-btn" onclick="nav('messages')">✉️ View contact messages</button>` : ''}
          ${can('admin','view')||can('data_collection','approve') ? `<button class="qa-btn" onclick="nav('audit')">📜 View audit log</button>` : ''}
        </div>`, 'card-inner')}
    </div>
    <div style="margin-top:8px" class="meta">Platform: Postgres + PostGIS · Migrations applied: ${stats.migrationsApplied ?? '—'} · <a href="${WEBSITE_URL}" target="_blank">Public website ↗</a></div>
  `, 'dashboard');
}

function statCard(label, value, icon) {
  return `<div class="stat-card"><div class="stat-icon">${icon}</div><div class="stat-value">${esc(String(value))}</div><div class="stat-label">${esc(label)}</div></div>`;
}

function groupPerms(perms) {
  const out={};
  for(const p of perms) (out[p.module]??=[]).push(p.level);
  return out;
}

// ── Staff & Users ─────────────────────────────────────────────────────────────
async function renderUsers() {
  shell(pageHead('Staff & Users','Manage team members, roles and account status.'), 'users');
  if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

  let users=[], roles=[];
  try {
    const [usersRes, rolesRes] = await Promise.all([api('/admin/users'), api('/admin/roles')]);
    users = asArray(usersRes, 'users');
    roles = asArray(rolesRes, 'roles');
  }
  catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

  document.getElementById('main').innerHTML = `
    ${pageHead('Staff & Users', `${users.length} accounts · ${users.filter(u=>u.is_active).length} active`)}
    ${can('admin','create') ? `
    <div class="card card-inner" style="margin-bottom:18px">
      <h3>Invite new staff member</h3>
      <div class="form-row">
        <div class="field"><label>Full name</label><input id="inv-name" placeholder="Jane Doe"></div>
        <div class="field"><label>Email</label><input id="inv-email" type="email" placeholder="jane@kabonix.org"></div>
        <div class="field"><label>Initial role</label>
          <select id="inv-role">
            <option value="">No role yet</option>
            ${roles.map(r=>`<option value="${esc(r.key)}">${esc(r.name)}</option>`).join('')}
          </select></div>
        <div class="field" style="align-self:flex-end">
          <button class="btn-primary" id="invite-btn">Send invite</button>
        </div>
      </div>
    </div>` : ''}
    <div class="card card-table">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th>MFA</th><th>Last active</th><th>Actions</th></tr></thead>
        <tbody id="users-tbody">
          ${users.map(u => {
            const userRoles = u.roles || [];
            return `<tr data-uid="${u.id}">
            <td><strong>${esc(u.name)}</strong></td>
            <td class="meta">${esc(u.email)}</td>
            <td>${userRoles.map(r=>`<span class="badge badge-role">${esc(r.name)}</span>`).join(' ')||'<span class="meta">none</span>'}</td>
            <td><span class="status-dot ${u.is_active?'active':'inactive'}"></span>${u.is_active?'Active':'Inactive'}</td>
            <td>${u.mfa_enabled?'✅ On':'⬜ Off'}</td>
            <td class="meta">${ago(u.last_active)}</td>
            <td class="action-cell">
              ${can('admin','edit') ? `
              <select class="inline-select" data-uid="${u.id}" id="role-sel-${u.id}">
                ${roles.map(r=>`<option value="${esc(r.key)}" ${userRoles.some(ur=>ur.key===r.key)?'selected':''}>${esc(r.name)}</option>`).join('')}
              </select>
              <button class="btn-sm" data-assign="${u.id}">Assign</button>
              ${u.is_active && u.id!==state.user.id ? `<button class="btn-sm btn-danger" data-deactivate="${u.id}">Deactivate</button>` : ''}
              ${!u.is_active ? `<button class="btn-sm btn-ok" data-reactivate="${u.id}">Reactivate</button>` : ''}
              ` : ''}
            </td>
          </tr>`; }).join('')}
        </tbody>
      </table>
    </div>`;

  if (can('admin','create')) {
    document.getElementById('invite-btn').onclick = async () => {
      const name  = document.getElementById('inv-name').value.trim();
      const email = document.getElementById('inv-email').value.trim();
      const role  = document.getElementById('inv-role').value;
      try {
        await api('/admin/users/invite',{method:'POST',body:{name,email,roleKey:role||undefined}});
        toast('Invitation sent — check the API console for the dev email link.');
        renderUsers();
      } catch(e) { toast(e.message, true); }
    };
  }

  document.querySelectorAll('[data-assign]').forEach(btn => btn.onclick = async () => {
    const uid = Number(btn.dataset.assign);
    const roleKey = document.getElementById(`role-sel-${uid}`).value;
    try { await api(`/admin/users/${uid}/roles`,{method:'PUT',body:{roleKeys:[roleKey]}}); toast('Role updated.'); renderUsers(); }
    catch(e) { toast(e.message, true); }
  });
  document.querySelectorAll('[data-deactivate]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Deactivate this user? Their active sessions will be revoked.')) return;
    try { await api(`/admin/users/${btn.dataset.deactivate}/deactivate`,{method:'POST',body:{}}); toast('User deactivated.'); renderUsers(); }
    catch(e) { toast(e.message, true); }
  });
  document.querySelectorAll('[data-reactivate]').forEach(btn => btn.onclick = async () => {
    try { await api(`/admin/users/${btn.dataset.reactivate}/reactivate`,{method:'POST',body:{}}); toast('User reactivated.'); renderUsers(); }
    catch(e) { toast(e.message, true); }
  });
}

// ── Roles & Permissions ───────────────────────────────────────────────────────
async function renderRoles() {
  shell(pageHead('Roles & Permissions', 'Loading…'), 'roles');
  if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

  let data = { roles:[], modules:[], levels:[] };
  try { data = await api('/admin/roles'); }
  catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

  const roles   = asArray(data, 'roles');
  const modules = Array.isArray(data?.modules) ? data.modules : [];
  const levels  = Array.isArray(data?.levels)  ? data.levels  : [];

  document.getElementById('main').innerHTML = `
    ${pageHead('Roles & Permissions', `${roles.length} roles · tick cells to grant a permission · click Save to apply`)}
    ${can('admin','create') ? `
    <div class="card card-inner" style="margin-bottom:18px">
      <h3>Create new role</h3>
      <div class="form-row">
        <div class="field"><label>Key (lowercase, underscores)</label><input id="r-key" placeholder="e.g. data_analyst"></div>
        <div class="field"><label>Display name</label><input id="r-name" placeholder="Data Analyst"></div>
        <div class="field"><label>Description</label><input id="r-desc" placeholder="Optional"></div>
        <div class="field" style="align-self:flex-end"><button class="btn-primary" id="create-role-btn">Create role</button></div>
      </div>
    </div>` : ''}
    ${roles.map(role => {
      const permSet = new Set((role.permissions||[]).map(p=>`${p.module}:${p.level}`));
      return `<div class="card card-table" style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:22px 24px 0">
          <div><strong>${esc(role.name)}</strong> <span class="meta">${esc(role.key)}</span></div>
          ${can('admin','approve') ? `<button class="btn-primary btn-sm" data-save-role="${role.id}">Save permissions</button>` : ''}
        </div>
        <table class="perm-table">
          <thead><tr><th>Module</th>${levels.map(l=>`<th>${esc(l)}</th>`).join('')}</tr></thead>
          <tbody>
            ${modules.map(mod=>`<tr>
              <td class="mod-name">${esc(mod)}</td>
              ${levels.map(lev=>`<td class="perm-cell">
                <input type="checkbox" data-role="${role.id}" data-mod="${mod}" data-lev="${lev}"
                  ${permSet.has(`${mod}:${lev}`) ? 'checked' : ''}
                  ${can('admin','approve') ? '' : 'disabled'}>
              </td>`).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    }).join('')}`;

  if (can('admin','create')) {
    document.getElementById('create-role-btn').onclick = async () => {
      try {
        await api('/admin/roles',{method:'POST',body:{
          key: document.getElementById('r-key').value.trim(),
          name: document.getElementById('r-name').value.trim(),
          description: document.getElementById('r-desc').value.trim()||undefined,
        }});
        toast('Role created.'); renderRoles();
      } catch(e) { toast(e.message, true); }
    };
  }

  document.querySelectorAll('[data-save-role]').forEach(btn => btn.onclick = async () => {
    const roleId = Number(btn.dataset.saveRole);
    const perms = [...document.querySelectorAll(`input[data-role="${roleId}"]:checked`)]
      .map(cb=>({ module: cb.dataset.mod, level: cb.dataset.lev }));
    try {
      await api(`/admin/roles/${roleId}/permissions`,{method:'PUT',body:{permissions:perms}});
      toast(`Permissions saved (${perms.length} granted).`);
    } catch(e) { toast(e.message, true); }
  });
}

// ── System Config ─────────────────────────────────────────────────────────────
async function renderConfig() {
  shell(pageHead('System Configuration', 'Loading…'), 'config');
  if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

  let cfg=[], prefs={};
  try {
    cfg = asArray(await api('/admin/config'), 'config');
    prefs = await api('/admin/notifications/preferences').catch(()=>({}));
  } catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

  document.getElementById('main').innerHTML = `
    ${pageHead('System Configuration', 'Platform-wide settings managed by Foundation admin — no developer required.')}
    <div class="two-col">
      <div>
        <div class="card card-inner">
          <h3>Platform settings</h3>
          ${cfg.map(c => `<div class="cfg-row" data-key="${esc(c.key)}">
            <div class="cfg-label">
              <strong>${esc(c.label)}</strong>
              ${c.description ? `<span class="meta">${esc(c.description)}</span>` : ''}
            </div>
            <div class="cfg-control">
              ${cfgControl(c)}
              ${can('admin','edit') ? `<button class="btn-sm" data-cfg="${esc(c.key)}">Save</button>` : ''}
            </div>
          </div>`).join('')}
        </div>
      </div>
      <div>
        <div class="card card-inner">
          <h3>My notification preferences</h3>
          <p class="meta" style="margin-bottom:14px">These apply to your account only.</p>
          ${[
            ['email',    '✉️', 'Email notifications'],
            ['sms',      '📱', 'SMS notifications'],
            ['whatsapp', '💬', 'WhatsApp notifications'],
            ['in_app',   '🔔', 'In-app notifications'],
          ].map(([k,icon,label])=>`
            <div class="cfg-row">
              <div class="cfg-label"><strong>${icon} ${label}</strong></div>
              <div class="cfg-control">
                <label class="toggle-wrap">
                  <input type="checkbox" class="pref-toggle" data-pref="${k}" ${prefs[k]?'checked':''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>`).join('')}
          <div style="margin-top:16px">
            <button class="btn-primary" id="save-prefs-btn">Save preferences</button>
          </div>
        </div>
        <div class="card card-inner" style="margin-top:16px">
          <h3>Migration status</h3>
          <p class="meta">Applied SQL migrations tracked in <code>schema_migrations</code>.</p>
          <div id="migration-list" style="margin-top:10px">Loading…</div>
        </div>
      </div>
    </div>`;

  // Load migrations list
  pool_migrations_display();

  if (can('admin','edit')) {
    document.querySelectorAll('[data-cfg]').forEach(btn => btn.onclick = async () => {
      const key = btn.dataset.cfg;
      const row = document.querySelector(`.cfg-row[data-key="${key}"]`);
      const ctrl = row.querySelector('.cfg-value');
      const value = ctrl.type === 'checkbox' ? String(ctrl.checked) : ctrl.value;
      try {
        await api(`/admin/config/${key}`,{method:'PATCH',body:{value}});
        toast(`${key} saved.`);
      } catch(e) { toast(e.message, true); }
    });
  }

  document.getElementById('save-prefs-btn').onclick = async () => {
    const nextPrefs = {
      email:    document.querySelector('[data-pref="email"]').checked,
      sms:      document.querySelector('[data-pref="sms"]').checked,
      whatsapp: document.querySelector('[data-pref="whatsapp"]').checked,
      in_app:   document.querySelector('[data-pref="in_app"]').checked,
      subscriptions: ['approval_required','submission_flagged','project_milestone_due','system_alert'],
    };
    try { await api('/admin/notifications/preferences',{method:'PUT',body:nextPrefs}); toast('Notification preferences saved.'); }
    catch(e) { toast(e.message, true); }
  };
}

async function pool_migrations_display() {
  const el = document.getElementById('migration-list');
  if (!el) return;
  try {
    const stats = await api('/admin/stats');
    el.innerHTML = `<span class="badge badge-ok">✓ ${stats.migrationsApplied} migrations applied</span>`;
  } catch { el.textContent = 'Could not load.'; }
}

function cfgControl(c) {
  if (c.type === 'boolean') return `<label class="toggle-wrap"><input type="checkbox" class="cfg-value" ${c.value==='true'?'checked':''}><span class="toggle-slider"></span></label>`;
  if (c.type === 'select')  return `<select class="cfg-value">${(c.options||'').split(',').map(o=>`<option value="${esc(o.trim())}" ${c.value===o.trim()?'selected':''}>${esc(o.trim())}</option>`).join('')}</select>`;
  return `<input type="${c.type==='number'?'number':'text'}" class="cfg-value" value="${esc(c.value)}">`;
}

// ── Audit Log ─────────────────────────────────────────────────────────────────
async function renderAudit() {
  shell(pageHead('Audit Log','Full record of who changed what, and when.'), 'audit');
  if (!can('admin','view') && !can('data_collection','approve'))
    return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

  let data = { rows:[], total:0 };
  const filters = { action:'', entity:'', userId:'', from:'', to:'' };
  async function load() {
    const qs = new URLSearchParams({ limit:200, ...Object.fromEntries(Object.entries(filters).filter(([,v])=>v)) });
    data = await api(`/admin/audit?${qs}`).catch(()=>({ rows:[], total:0 }));
    renderTable();
  }

  function renderTable() {
    const tbody = document.getElementById('audit-tbody');
    if (!tbody) return;
    if (!data.rows.length) { tbody.innerHTML = `<tr><td colspan="6" class="meta" style="text-align:center;padding:24px">No records match the current filters.</td></tr>`; return; }
    tbody.innerHTML = data.rows.map(r=>`<tr>
      <td class="meta">${new Date(r.created_at).toLocaleString('en-GB')}</td>
      <td>${esc(r.user_email||'—')}</td>
      <td><span class="badge badge-action">${esc(r.action)}</span></td>
      <td>${esc(r.entity)}${r.entity_id?` <span class="meta">#${r.entity_id}</span>`:''}</td>
      <td class="meta">${esc(r.detail||'—')}</td>
    </tr>`).join('');
    document.getElementById('audit-count').textContent = `${data.rows.length} of ${data.total} events`;
  }

  document.getElementById('main').innerHTML = `
    ${pageHead('Audit Log', 'Every create, edit, delete, login and permission-denied event is recorded here.')}
    <div class="card card-inner" style="margin-bottom:16px">
      <div class="form-row">
        <div class="field"><label>Action</label>
          <select id="f-action">
            <option value="">All actions</option>
            ${['login','login_failed','logout','create','edit','delete','approve','export','permission_denied','mfa_enabled','mfa_disabled','token_reuse_detected','password_reset_requested','email_verified']
              .map(a=>`<option value="${a}">${a}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Entity type</label>
          <input id="f-entity" placeholder="e.g. user, me_submission">
        </div>
        <div class="field"><label>From</label><input type="date" id="f-from"></div>
        <div class="field"><label>To</label><input type="date" id="f-to"></div>
        <div class="field" style="align-self:flex-end">
          <button class="btn-primary" id="filter-btn">Apply filters</button>
        </div>
      </div>
    </div>
    <div class="card card-table">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;padding:22px 24px 0">
        <span class="meta" id="audit-count">Loading…</span>
        <button class="btn-sm" id="refresh-btn">↻ Refresh</button>
      </div>
      <table>
        <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
        <tbody id="audit-tbody"><tr><td colspan="6" class="meta" style="text-align:center;padding:24px">Loading…</td></tr></tbody>
      </table>
    </div>`;

  document.getElementById('filter-btn').onclick = () => {
    filters.action = document.getElementById('f-action').value;
    filters.entity = document.getElementById('f-entity').value.trim();
    filters.from   = document.getElementById('f-from').value;
    filters.to     = document.getElementById('f-to').value;
    load();
  };
  document.getElementById('refresh-btn').onclick = load;
  load();
}

// ── M&E Forms ─────────────────────────────────────────────────────────────────
async function renderForms() {
  shell(pageHead('M&E Data Collection','Household Baseline Survey and field data submission.'), 'forms');
  let forms=[], submissions=[];
  try {
    forms       = asArray(await api('/forms'), 'forms');
    submissions = asArray(await api('/submissions'), 'submissions');
  }
  catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

  const form = forms[0];
  const canCreate = can('data_collection','create');

  document.getElementById('main').innerHTML = `
    ${pageHead('M&E Data Collection', form ? form.description : 'No forms available.')}
    ${form && canCreate ? `
    <div class="card card-inner" style="margin-bottom:18px">
      <h3>${esc(form.title)}</h3>
      <form id="me-form">
        <div class="form-grid">${(form.schema||[]).map(fieldHtml).join('')}</div>
        <button class="btn-primary" type="submit">Submit survey</button>
      </form>
    </div>` : form ? `<div class="card card-inner" style="margin-bottom:18px"><p class="meta">Your role can view submissions but not create new ones.</p></div>` : ''}
    <div class="card card-table">
      <h3 style="padding:22px 24px 0">Recent submissions (${submissions.length})</h3>
      ${!submissions.length ? `<p class="meta" style="padding:12px 24px 22px">No submissions yet.</p>` : `
      <table>
        <thead><tr><th>Beneficiary</th><th>Village</th><th>Programme</th><th>Submitted by</th><th>When</th></tr></thead>
        <tbody>${submissions.map(s=>`<tr>
          <td>${esc(s.answers?.beneficiary_name||'—')}</td>
          <td>${esc(s.answers?.village||'—')}</td>
          <td>${esc(s.answers?.programme_area||'—')}</td>
          <td class="meta">${esc(s.submitted_by_email)}</td>
          <td class="meta">${ago(s.submitted_at)}</td>
        </tr>`).join('')}</tbody>
      </table>`}
    </div>`;

  if (form && canCreate) {
    document.getElementById('me-form').onsubmit = async e => {
      e.preventDefault();
      const answers = {};
      for (const f of form.schema||[]) {
        const el = document.getElementById('f_'+f.id);
        if (el) answers[f.id] = f.type==='number' ? (el.value?Number(el.value):undefined) : el.value;
      }
      try {
        await api('/submissions',{method:'POST',body:{formKey:form.key,answers}});
        toast('Submission recorded.'); renderForms();
      } catch(e) { toast(e.message, true); }
    };
  }
}

function fieldHtml(f) {
  const req = f.required ? 'required' : '';
  if (f.type==='select') return `<div class="field"><label>${esc(f.label)}${f.required?' *':''}</label>
    <select id="f_${f.id}" ${req}><option value="">Select…</option>
    ${(f.options||[]).map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select></div>`;
  if (f.type==='textarea') return `<div class="field"><label>${esc(f.label)}${f.required?' *':''}</label>
    <textarea id="f_${f.id}" ${req}></textarea></div>`;
  return `<div class="field"><label>${esc(f.label)}${f.required?' *':''}</label>
    <input id="f_${f.id}" type="${f.type==='number'?'number':'text'}" ${req}></div>`;
}

// ── Contact Messages ──────────────────────────────────────────────────────────
async function renderMessages() {
  shell(pageHead('Contact Messages','Website enquiry inbox.'), 'messages');
  if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

  let msgs=[];
  try { msgs = asArray(await api('/admin/contact-messages'), 'messages'); }
  catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

  const statusColor = { new:'badge-new', read:'badge-role', replied:'badge-ok', archived:'meta' };

  document.getElementById('main').innerHTML = `
    ${pageHead('Contact Messages', `${msgs.filter(m=>m.status==='new').length} new · ${msgs.length} total`)}
    <div class="card card-table">
      <table>
        <thead><tr><th>From</th><th>Organisation</th><th>Subject</th><th>Status</th><th>Received</th><th>Actions</th></tr></thead>
        <tbody>
          ${msgs.map(m=>`<tr>
            <td><strong>${esc(m.full_name)}</strong><br><span class="meta">${esc(m.email)}</span></td>
            <td class="meta">${esc(m.organisation||'—')}</td>
            <td>${esc(m.subject)}<br><span class="meta">${esc((m.message||'').slice(0,80))}${(m.message||'').length>80?'…':''}</span></td>
            <td><span class="badge ${statusColor[m.status]||''}">${m.status}</span></td>
            <td class="meta">${ago(m.created_at)}</td>
            <td class="action-cell">
              ${['read','replied','archived'].map(s=>
                s!==m.status ? `<button class="btn-sm" data-msg="${m.id}" data-status="${s}">${s}</button>` : ''
              ).join('')}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('[data-msg]').forEach(btn => btn.onclick = async () => {
    try {
      await api(`/admin/contact-messages/${btn.dataset.msg}/status`,{method:'PATCH',body:{status:btn.dataset.status}});
      toast(`Marked as ${btn.dataset.status}.`); renderMessages();
    } catch(e) { toast(e.message, true); }
  });
}

// ── Profile / MFA setup ───────────────────────────────────────────────────────
async function renderProfile() {
  shell(pageHead('My Profile','Account settings and two-factor authentication.'), 'profile');
  const u = state.user;

  document.getElementById('main').innerHTML = `
    ${pageHead('My Profile')}
    <div class="two-col">
      <div class="card card-inner">
        <h3>Account details</h3>
        <dl class="detail-list">
          <dt>Name</dt><dd>${esc(u.name)}</dd>
          <dt>Email</dt><dd>${esc(u.email)}</dd>
          <dt>Email verified</dt><dd>${u.emailVerified?'✅ Yes':'⚠️ Not verified'}</dd>
          <dt>MFA</dt><dd>${u.mfaEnabled?'✅ Enabled':'⬜ Disabled'}</dd>
          <dt>Roles</dt><dd>${state.roles.map(r=>`<span class="badge badge-role">${esc(r.name)}</span>`).join(' ')||'None'}</dd>
        </dl>
      </div>
      <div class="card card-inner">
        <h3>Two-factor authentication</h3>
        ${u.mfaEnabled ? `
          <p class="meta" style="margin-bottom:14px">MFA is active. Enter your current code to disable it.</p>
          <div class="field"><label>Current authentication code</label><input id="mfa-dis-code" type="text" maxlength="6" inputmode="numeric" placeholder="000000"></div>
          <button class="btn-primary btn-danger" id="dis-mfa-btn">Disable MFA</button>
        ` : `
          <p class="meta" style="margin-bottom:14px">Scan the QR code (or copy the key) into your authenticator app, then enter the 6-digit code to confirm.</p>
          <button class="btn-primary" id="setup-mfa-btn">Set up MFA</button>
          <div id="mfa-setup-area"></div>
        `}
        <div id="mfa-msg" style="margin-top:10px"></div>
      </div>
    </div>`;

  if (u.mfaEnabled) {
    document.getElementById('dis-mfa-btn').onclick = async () => {
      const code = document.getElementById('mfa-dis-code').value.trim();
      try {
        await api('/auth/mfa/disable',{method:'POST',body:{code}});
        toast('MFA disabled.'); const d = await api('/auth/me'); state.user=d.user; renderProfile();
      } catch(e) { document.getElementById('mfa-msg').textContent = e.message; }
    };
  } else {
    document.getElementById('setup-mfa-btn').onclick = async () => {
      try {
        const d = await api('/auth/mfa/setup',{method:'POST',body:{}});
        document.getElementById('mfa-setup-area').innerHTML = `
          <div style="margin-top:16px">
            <p class="meta">Scan with your authenticator app, or enter the key manually:</p>
            <code style="font-size:13px;background:#f3f5f1;padding:6px 10px;border-radius:4px;display:block;margin:10px 0;word-break:break-all">${esc(d.secret)}</code>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(d.otpauthUri)}" alt="QR code" style="border:1px solid var(--line);border-radius:6px;display:block;margin:10px 0">
            <div class="field"><label>Enter the 6-digit code to confirm</label><input id="mfa-confirm-code" type="text" maxlength="6" inputmode="numeric" placeholder="000000"></div>
            <button class="btn-primary" id="confirm-mfa-btn">Enable MFA</button>
          </div>`;
        document.getElementById('confirm-mfa-btn').onclick = async () => {
          const code = document.getElementById('mfa-confirm-code').value.trim();
          try {
            await api('/auth/mfa/enable',{method:'POST',body:{code}});
            toast('MFA enabled!'); const d2 = await api('/auth/me'); state.user=d2.user; renderProfile();
          } catch(e) { document.getElementById('mfa-msg').textContent = e.message; }
        };
      } catch(e) { document.getElementById('mfa-msg').textContent = e.message; }
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function forbidden() { return `<div class="card card-inner meta">You don't have permission to view this section. Contact your Foundation Admin to request access.</div>`; }
function errBox(msg) { return `<div class="card card-inner" style="color:var(--danger)">${esc(msg)}</div>`; }

// ── Boot ──────────────────────────────────────────────────────────────────────
tryRestoreSession();const WEBSITE_URL = document.querySelector('meta[name="website-url"]')?.content || 'http://localhost:3001';
// app.js — Kabonix Foundation Staff Portal (Sprint 01–03)
// Admin & Governance control room + M&E data collection UI.

const API = (document.querySelector('meta[name="api-url"]')?.content || 'http://localhost:4000') + '/api';

const state = {
  token: lsGet('kabonix_token'),
  user: null, roles: [], permissions: [],
  route: 'dashboard', routeParam: null,
};

// Top-level `const` in a classic script does NOT become a window property, so
// ai.js could never see the session. Mirror it explicitly.
window.state = state;

function lsGet(k)    { try { return localStorage.getItem(k); } catch { return (window.__m||{})[k]||null; } }
function lsSet(k,v)  { try { localStorage.setItem(k,v); } catch { window.__m=window.__m||{}; window.__m[k]=v; } }
function lsDel(k)    { try { localStorage.removeItem(k); } catch { if(window.__m) delete window.__m[k]; } }

const root = document.getElementById('root');

async function api(path, opts={}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type':'application/json', ...(state.token?{Authorization:`Bearer ${state.token}`}:{}), ...(opts.headers||{}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ai.js calls window.api(...) — expose it so the AI workspace can reach the
// same authenticated fetch wrapper.
window.api = api;

function can(module, level) { return state.permissions.some(p=>p.module===module&&p.level===level); }

// Toasts stack instead of overlapping at the same fixed position.
function toast(msg, isErr) {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = Object.assign(document.createElement('div'), { id: 'toast-stack' });
    document.body.appendChild(stack);
  }
  const el = Object.assign(document.createElement('div'), { className:'toast'+(isErr?' error':''), textContent:msg });
  stack.appendChild(el);
  setTimeout(()=>el.remove(), 3400);
}

function esc(s) {
  if (s==null) return '';
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function ago(ts) {
  if (!ts) return '—';
  const s = Math.round((Date.now()-new Date(ts))/1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return new Date(ts).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}

// Normalise list-shaped API payloads ({ users:[…] } vs […]) so the UI never
// crashes on a shape change.
function asArray(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  return [];
}

// ── Session ──────────────────────────────────────────────────────────────────
async function tryRestoreSession() {
  if (!state.token) return render();
  try {
    const d = await api('/auth/me');
    state.user = d.user; state.roles = d.roles; state.permissions = d.permissions;
  } catch { state.token=null; lsDel('kabonix_token'); }
  render();
}

async function login(email, password) {
  const d = await api('/auth/login',{method:'POST',body:{email,password}});
  if (d.mfaRequired) return d; // caller handles MFA step
  state.token=d.accessToken; state.user=d.user; state.roles=d.roles; state.permissions=d.permissions;
  lsSet('kabonix_token', d.accessToken);
  state.route='dashboard'; render();
}

async function submitMfa(challengeToken, code) {
  const d = await api('/auth/mfa/challenge',{method:'POST',body:{challengeToken,code}});
  state.token=d.accessToken; state.user=d.user; state.roles=d.roles; state.permissions=d.permissions;
  lsSet('kabonix_token', d.accessToken);
  state.route='dashboard'; render();
}

function logout() {
  state.token=null; state.user=null; state.roles=[]; state.permissions=[];
  lsDel('kabonix_token'); render();
}

// ── Router ───────────────────────────────────────────────────────────────────
function nav(route, param) { state.route=route; state.routeParam=param||null; render(); }

function render() {
  if (!state.token||!state.user) return renderLogin();
  const views = {
    dashboard: renderDashboard,
    users:     renderUsers,
    roles:     renderRoles,
    config:    renderConfig,
    audit:     renderAudit,
    forms:     renderForms,
    messages:  renderMessages,
    profile:   renderProfile,
  };
  (views[state.route]||renderDashboard)();
}

// ── Login ────────────────────────────────────────────────────────────────────
function renderLogin(mfaChallenge) {
  root.innerHTML = `
<div class="login-screen">
  <div class="login-visual">
    <div class="mark">KABONIX FOUNDATION</div>
    <h1>Digital Ecosystem Platform</h1>
    <p>Staff & field officer portal. Collect, manage and act on programme data.</p>
    <div class="login-pills">
      <span>🌊 Blue Economy</span><span>🌱 Carbon</span><span>⚡ Renewable Energy</span><span>👩‍💼 Youth & Women</span>
    </div>
  </div>
  <div class="login-form-side">
    <div class="login-card">
      ${mfaChallenge ? `
        <h2>Two-factor authentication</h2>
        <p class="sub">Enter the 6-digit code from your authenticator app.</p>
        <div class="field"><label>Authentication code</label><input id="l-code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"></div>
        <button class="btn-primary" id="mfa-btn">Verify</button>
        <p class="hint"><a href="#" id="back-link">← Back to sign in</a></p>
      ` : `
        <h2>Sign in</h2>
        <p class="sub">Foundation staff and field officers only.</p>
        <div class="field"><label>Email</label><input id="l-email" type="email" value="admin@kabonix.org"></div>
        <div class="field"><label>Password</label><input id="l-pw" type="password" value="ChangeMe123!"></div>
        <button class="btn-primary" id="login-btn">Sign in</button>
        <p class="hint">Seeded accounts: <strong>admin@kabonix.org</strong> (Super Admin) · <strong>amina@kabonix.org</strong> (Field Officer) — password: <strong>ChangeMe123!</strong></p>
      `}
      <div id="l-err" class="err-msg"></div>
    </div>
  </div>
</div>`;
  if (mfaChallenge) {
    const code = document.getElementById('l-code');
    code.focus();
    document.getElementById('mfa-btn').onclick = async () => {
      try { await submitMfa(mfaChallenge, code.value.trim()); }
      catch(e) { document.getElementById('l-err').textContent = e.message; }
    };
    document.getElementById('back-link').onclick = e => { e.preventDefault(); render(); };
  } else {
    document.getElementById('login-btn').onclick = doLogin;
    document.getElementById('l-pw').onkeydown = e => { if(e.key==='Enter') doLogin(); };
  }
}

async function doLogin() {
  const email = document.getElementById('l-email').value.trim();
  const pw    = document.getElementById('l-pw').value;
  const err   = document.getElementById('l-err');
  err.textContent = '';
  try {
    const d = await login(email, pw);
    if (d?.mfaRequired) renderLogin(d.challengeToken);
  } catch(e) { err.textContent = e.message; }
}

// ── Shell ─────────────────────────────────────────────────────────────────────
function shell(contentHtml, activeRoute) {
  const items = [
    { key:'dashboard', icon:'◉', label:'Dashboard' },
    can('data_collection','view') && { key:'forms', icon:'📋', label:'M&E Collection' },
    can('admin','view') && { key:'users', icon:'👥', label:'Staff & Users' },
    can('admin','view') && { key:'roles', icon:'🔐', label:'Roles & Permissions' },
    can('admin','view') && { key:'config', icon:'⚙️', label:'System Config' },
    can('admin','view') && { key:'messages', icon:'✉️', label:'Contact Messages' },
    (can('admin','view')||can('data_collection','approve')) && { key:'audit', icon:'📜', label:'Audit Log' },
  ].filter(Boolean);

  root.innerHTML = `
<div class="app-shell">
  <aside class="sidebar">
    <div class="sb-brand">
      <button id="sb-toggle" aria-label="Toggle menu">☰</button>
      <a class="sb-brand-link" href="${WEBSITE_URL}" target="_blank" rel="noopener">
        <div class="sb-logo"><img src="/assets/logo.png" class="sb-logo-img" onerror="this.style.display='none'" alt="Kabonix logo"></div>
      </a>
      <div><div class="sb-name">KABONIX</div><div class="sb-sub">FOUNDATION</div></div>
    </div>
    <nav class="sb-nav">
        ${items.map(i=>`<a class="nav-item${state.route===i.key?' active':''}" data-route="${i.key}">
          <span class="nav-icon">${i.icon}</span><span class="nav-label">${esc(i.label)}</span></a>`).join('')}
    </nav>
    <div class="sb-foot">
      <a class="nav-item" data-route="profile"><span class="nav-icon">👤</span>${esc(state.user.name.split(' ')[0])}</a>
      <button class="sb-logout" id="logout-btn">Sign out</button>
    </div>
  </aside>
  <main class="main-area" id="main">${contentHtml}</main>
</div>`;
  root.querySelectorAll('.nav-item[data-route]').forEach(el => el.onclick = e => { e.preventDefault(); nav(el.dataset.route); });
  document.getElementById('logout-btn').onclick = logout;
  const sbToggle = document.getElementById('sb-toggle');
  const appShell = document.querySelector('.app-shell');
  const sidebarEl = document.querySelector('.sidebar');
  if (sbToggle) {
    sbToggle.onclick = () => {
      if (window.innerWidth <= 800) {
        appShell.classList.toggle('sidebar-open');
      } else {
        sidebarEl.classList.toggle('collapsed');
      }
    };
  }
  // Close the mobile drawer on overlay tap, Escape, or resizing past the breakpoint.
  if (appShell) {
    appShell.addEventListener('click', e => {
      if (!appShell.classList.contains('sidebar-open')) return;
      if (e.target.closest('.sidebar') || e.target.closest('#sb-toggle')) return;
      appShell.classList.remove('sidebar-open');
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') appShell.classList.remove('sidebar-open');
    });
    window.addEventListener('resize', () => {
      if (window.innerWidth > 800) appShell.classList.remove('sidebar-open');
    });
  }
}

function pageHead(title, sub='') {
  return `<div class="page-head"><h1>${esc(title)}</h1>${sub?`<p>${esc(sub)}</p>`:''}</div>`;
}

function card(content, cls='') { return `<div class="card ${cls}">${content}</div>`; }

// ── Dashboard ────────────────────────────────────────────────────────────────
async function renderDashboard() {
  shell(`${pageHead('Dashboard','Loading…')}`, 'dashboard');
  let stats = {};
  try { stats = await api('/admin/stats'); } catch {}

  const me = state.user;
  const roleNames = state.roles.map(r=>r.name).join(', ')||'No roles assigned';

  shell(`
    ${pageHead('Dashboard', `Welcome back, ${me.name.split(' ')[0]}. ${new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}.`)}
    <div class="stat-row">
      ${statCard('Active staff',     stats.activeUsers       ?? '—', '👥')}
      ${statCard('Submissions',      stats.submissions        ?? '—', '📋')}
      ${statCard('Audit events (24h)',stats.auditEventsToday ?? '—', '📜')}
      ${statCard('New enquiries',    stats.newContactMessages ?? '—', '✉️')}
    </div>
    <div class="two-col">
      ${card(`<h3>Your access</h3>
        <p class="meta">${esc(roleNames)}</p>
        <table class="mini-table"><tbody>
          ${Object.entries(groupPerms(state.permissions)).map(([m,ls])=>`<tr><td>${esc(m)}</td><td>${ls.map(l=>`<span class="badge">${l}</span>`).join('')}</td></tr>`).join('')}
        </tbody></table>`, 'card-inner')}
      ${card(`<h3>Quick actions</h3>
        <div class="quick-actions">
          ${can('data_collection','create') ? `<button class="qa-btn" onclick="nav('forms')">📋 Submit M&E form</button>` : ''}
          ${can('admin','create')           ? `<button class="qa-btn" onclick="nav('users')">➕ Invite staff member</button>` : ''}
          ${can('admin','view')             ? `<button class="qa-btn" onclick="nav('messages')">✉️ View contact messages</button>` : ''}
          ${can('admin','view')||can('data_collection','approve') ? `<button class="qa-btn" onclick="nav('audit')">📜 View audit log</button>` : ''}
        </div>`, 'card-inner')}
    </div>
    <div style="margin-top:8px" class="meta">Platform: Postgres + PostGIS · Migrations applied: ${stats.migrationsApplied ?? '—'} · <a href="${WEBSITE_URL}" target="_blank">Public website ↗</a></div>
  `, 'dashboard');
}

function statCard(label, value, icon) {
  return `<div class="stat-card"><div class="stat-icon">${icon}</div><div class="stat-value">${esc(String(value))}</div><div class="stat-label">${esc(label)}</div></div>`;
}

function groupPerms(perms) {
  const out={};
  for(const p of perms) (out[p.module]??=[]).push(p.level);
  return out;
}

// ── Staff & Users ─────────────────────────────────────────────────────────────
async function renderUsers() {
  shell(pageHead('Staff & Users','Manage team members, roles and account status.'), 'users');
  if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

  let users=[], roles=[];
  try {
    const [usersRes, rolesRes] = await Promise.all([api('/admin/users'), api('/admin/roles')]);
    users = asArray(usersRes, 'users');
    roles = asArray(rolesRes, 'roles');
  }
  catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

  document.getElementById('main').innerHTML = `
    ${pageHead('Staff & Users', `${users.length} accounts · ${users.filter(u=>u.is_active).length} active`)}
    ${can('admin','create') ? `
    <div class="card card-inner" style="margin-bottom:18px">
      <h3>Invite new staff member</h3>
      <div class="form-row">
        <div class="field"><label>Full name</label><input id="inv-name" placeholder="Jane Doe"></div>
        <div class="field"><label>Email</label><input id="inv-email" type="email" placeholder="jane@kabonix.org"></div>
        <div class="field"><label>Initial role</label>
          <select id="inv-role">
            <option value="">No role yet</option>
            ${roles.map(r=>`<option value="${esc(r.key)}">${esc(r.name)}</option>`).join('')}
          </select></div>
        <div class="field" style="align-self:flex-end">
          <button class="btn-primary" id="invite-btn">Send invite</button>
        </div>
      </div>
    </div>` : ''}
    <div class="card card-table">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th>MFA</th><th>Last active</th><th>Actions</th></tr></thead>
        <tbody id="users-tbody">
          ${users.map(u => {
            const userRoles = u.roles || [];
            return `<tr data-uid="${u.id}">
            <td><strong>${esc(u.name)}</strong></td>
            <td class="meta">${esc(u.email)}</td>
            <td>${userRoles.map(r=>`<span class="badge badge-role">${esc(r.name)}</span>`).join(' ')||'<span class="meta">none</span>'}</td>
            <td><span class="status-dot ${u.is_active?'active':'inactive'}"></span>${u.is_active?'Active':'Inactive'}</td>
            <td>${u.mfa_enabled?'✅ On':'⬜ Off'}</td>
            <td class="meta">${ago(u.last_active)}</td>
            <td class="action-cell">
              ${can('admin','edit') ? `
              <select class="inline-select" data-uid="${u.id}" id="role-sel-${u.id}">
                ${roles.map(r=>`<option value="${esc(r.key)}" ${userRoles.some(ur=>ur.key===r.key)?'selected':''}>${esc(r.name)}</option>`).join('')}
              </select>
              <button class="btn-sm" data-assign="${u.id}">Assign</button>
              ${u.is_active && u.id!==state.user.id ? `<button class="btn-sm btn-danger" data-deactivate="${u.id}">Deactivate</button>` : ''}
              ${!u.is_active ? `<button class="btn-sm btn-ok" data-reactivate="${u.id}">Reactivate</button>` : ''}
              ` : ''}
            </td>
          </tr>`; }).join('')}
        </tbody>
      </table>
    </div>`;

  if (can('admin','create')) {
    document.getElementById('invite-btn').onclick = async () => {
      const name  = document.getElementById('inv-name').value.trim();
      const email = document.getElementById('inv-email').value.trim();
      const role  = document.getElementById('inv-role').value;
      try {
        await api('/admin/users/invite',{method:'POST',body:{name,email,roleKey:role||undefined}});
        toast('Invitation sent — check the API console for the dev email link.');
        renderUsers();
      } catch(e) { toast(e.message, true); }
    };
  }

  document.querySelectorAll('[data-assign]').forEach(btn => btn.onclick = async () => {
    const uid = Number(btn.dataset.assign);
    const roleKey = document.getElementById(`role-sel-${uid}`).value;
    try { await api(`/admin/users/${uid}/roles`,{method:'PUT',body:{roleKeys:[roleKey]}}); toast('Role updated.'); renderUsers(); }
    catch(e) { toast(e.message, true); }
  });
  document.querySelectorAll('[data-deactivate]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Deactivate this user? Their active sessions will be revoked.')) return;
    try { await api(`/admin/users/${btn.dataset.deactivate}/deactivate`,{method:'POST',body:{}}); toast('User deactivated.'); renderUsers(); }
    catch(e) { toast(e.message, true); }
  });
  document.querySelectorAll('[data-reactivate]').forEach(btn => btn.onclick = async () => {
    try { await api(`/admin/users/${btn.dataset.reactivate}/reactivate`,{method:'POST',body:{}}); toast('User reactivated.'); renderUsers(); }
    catch(e) { toast(e.message, true); }
  });
}

// ── Roles & Permissions ───────────────────────────────────────────────────────
async function renderRoles() {
  shell(pageHead('Roles & Permissions', 'Loading…'), 'roles');
  if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

  let data = { roles:[], modules:[], levels:[] };
  try { data = await api('/admin/roles'); }
  catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

  const roles   = asArray(data, 'roles');
  const modules = Array.isArray(data?.modules) ? data.modules : [];
  const levels  = Array.isArray(data?.levels)  ? data.levels  : [];

  document.getElementById('main').innerHTML = `
    ${pageHead('Roles & Permissions', `${roles.length} roles · tick cells to grant a permission · click Save to apply`)}
    ${can('admin','create') ? `
    <div class="card card-inner" style="margin-bottom:18px">
      <h3>Create new role</h3>
      <div class="form-row">
        <div class="field"><label>Key (lowercase, underscores)</label><input id="r-key" placeholder="e.g. data_analyst"></div>
        <div class="field"><label>Display name</label><input id="r-name" placeholder="Data Analyst"></div>
        <div class="field"><label>Description</label><input id="r-desc" placeholder="Optional"></div>
        <div class="field" style="align-self:flex-end"><button class="btn-primary" id="create-role-btn">Create role</button></div>
      </div>
    </div>` : ''}
    ${roles.map(role => {
      const permSet = new Set((role.permissions||[]).map(p=>`${p.module}:${p.level}`));
      return `<div class="card card-table" style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:22px 24px 0">
          <div><strong>${esc(role.name)}</strong> <span class="meta">${esc(role.key)}</span></div>
          ${can('admin','approve') ? `<button class="btn-primary btn-sm" data-save-role="${role.id}">Save permissions</button>` : ''}
        </div>
        <table class="perm-table">
          <thead><tr><th>Module</th>${levels.map(l=>`<th>${esc(l)}</th>`).join('')}</tr></thead>
          <tbody>
            ${modules.map(mod=>`<tr>
              <td class="mod-name">${esc(mod)}</td>
              ${levels.map(lev=>`<td class="perm-cell">
                <input type="checkbox" data-role="${role.id}" data-mod="${mod}" data-lev="${lev}"
                  ${permSet.has(`${mod}:${lev}`) ? 'checked' : ''}
                  ${can('admin','approve') ? '' : 'disabled'}>
              </td>`).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    }).join('')}`;

  if (can('admin','create')) {
    document.getElementById('create-role-btn').onclick = async () => {
      try {
        await api('/admin/roles',{method:'POST',body:{
          key: document.getElementById('r-key').value.trim(),
          name: document.getElementById('r-name').value.trim(),
          description: document.getElementById('r-desc').value.trim()||undefined,
        }});
        toast('Role created.'); renderRoles();
      } catch(e) { toast(e.message, true); }
    };
  }

  document.querySelectorAll('[data-save-role]').forEach(btn => btn.onclick = async () => {
    const roleId = Number(btn.dataset.saveRole);
    const perms = [...document.querySelectorAll(`input[data-role="${roleId}"]:checked`)]
      .map(cb=>({ module: cb.dataset.mod, level: cb.dataset.lev }));
    try {
      await api(`/admin/roles/${roleId}/permissions`,{method:'PUT',body:{permissions:perms}});
      toast(`Permissions saved (${perms.length} granted).`);
    } catch(e) { toast(e.message, true); }
  });
}

// ── System Config ─────────────────────────────────────────────────────────────
async function renderConfig() {
  shell(pageHead('System Configuration', 'Loading…'), 'config');
  if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

  let cfg=[], prefs={};
  try {
    cfg = asArray(await api('/admin/config'), 'config');
    prefs = await api('/admin/notifications/preferences').catch(()=>({}));
  } catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

  document.getElementById('main').innerHTML = `
    ${pageHead('System Configuration', 'Platform-wide settings managed by Foundation admin — no developer required.')}
    <div class="two-col">
      <div>
        <div class="card card-inner">
          <h3>Platform settings</h3>
          ${cfg.map(c => `<div class="cfg-row" data-key="${esc(c.key)}">
            <div class="cfg-label">
              <strong>${esc(c.label)}</strong>
              ${c.description ? `<span class="meta">${esc(c.description)}</span>` : ''}
            </div>
            <div class="cfg-control">
              ${cfgControl(c)}
              ${can('admin','edit') ? `<button class="btn-sm" data-cfg="${esc(c.key)}">Save</button>` : ''}
            </div>
          </div>`).join('')}
        </div>
      </div>
      <div>
        <div class="card card-inner">
          <h3>My notification preferences</h3>
          <p class="meta" style="margin-bottom:14px">These apply to your account only.</p>
          ${[
            ['email',    '✉️', 'Email notifications'],
            ['sms',      '📱', 'SMS notifications'],
            ['whatsapp', '💬', 'WhatsApp notifications'],
            ['in_app',   '🔔', 'In-app notifications'],
          ].map(([k,icon,label])=>`
            <div class="cfg-row">
              <div class="cfg-label"><strong>${icon} ${label}</strong></div>
              <div class="cfg-control">
                <label class="toggle-wrap">
                  <input type="checkbox" class="pref-toggle" data-pref="${k}" ${prefs[k]?'checked':''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>`).join('')}
          <div style="margin-top:16px">
            <button class="btn-primary" id="save-prefs-btn">Save preferences</button>
          </div>
        </div>
        <div class="card card-inner" style="margin-top:16px">
          <h3>Migration status</h3>
          <p class="meta">Applied SQL migrations tracked in <code>schema_migrations</code>.</p>
          <div id="migration-list" style="margin-top:10px">Loading…</div>
        </div>
      </div>
    </div>`;

  // Load migrations list
  pool_migrations_display();

  if (can('admin','edit')) {
    document.querySelectorAll('[data-cfg]').forEach(btn => btn.onclick = async () => {
      const key = btn.dataset.cfg;
      const row = document.querySelector(`.cfg-row[data-key="${key}"]`);
      const ctrl = row.querySelector('.cfg-value');
      const value = ctrl.type === 'checkbox' ? String(ctrl.checked) : ctrl.value;
      try {
        await api(`/admin/config/${key}`,{method:'PATCH',body:{value}});
        toast(`${key} saved.`);
      } catch(e) { toast(e.message, true); }
    });
  }

  document.getElementById('save-prefs-btn').onclick = async () => {
    const nextPrefs = {
      email:    document.querySelector('[data-pref="email"]').checked,
      sms:      document.querySelector('[data-pref="sms"]').checked,
      whatsapp: document.querySelector('[data-pref="whatsapp"]').checked,
      in_app:   document.querySelector('[data-pref="in_app"]').checked,
      subscriptions: ['approval_required','submission_flagged','project_milestone_due','system_alert'],
    };
    try { await api('/admin/notifications/preferences',{method:'PUT',body:nextPrefs}); toast('Notification preferences saved.'); }
    catch(e) { toast(e.message, true); }
  };
}

async function pool_migrations_display() {
  const el = document.getElementById('migration-list');
  if (!el) return;
  try {
    const stats = await api('/admin/stats');
    el.innerHTML = `<span class="badge badge-ok">✓ ${stats.migrationsApplied} migrations applied</span>`;
  } catch { el.textContent = 'Could not load.'; }
}

function cfgControl(c) {
  if (c.type === 'boolean') return `<label class="toggle-wrap"><input type="checkbox" class="cfg-value" ${c.value==='true'?'checked':''}><span class="toggle-slider"></span></label>`;
  if (c.type === 'select')  return `<select class="cfg-value">${(c.options||'').split(',').map(o=>`<option value="${esc(o.trim())}" ${c.value===o.trim()?'selected':''}>${esc(o.trim())}</option>`).join('')}</select>`;
  return `<input type="${c.type==='number'?'number':'text'}" class="cfg-value" value="${esc(c.value)}">`;
}

// ── Audit Log ─────────────────────────────────────────────────────────────────
async function renderAudit() {
  shell(pageHead('Audit Log','Full record of who changed what, and when.'), 'audit');
  if (!can('admin','view') && !can('data_collection','approve'))
    return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

  let data = { rows:[], total:0 };
  const filters = { action:'', entity:'', userId:'', from:'', to:'' };
  async function load() {
    const qs = new URLSearchParams({ limit:200, ...Object.fromEntries(Object.entries(filters).filter(([,v])=>v)) });
    data = await api(`/admin/audit?${qs}`).catch(()=>({ rows:[], total:0 }));
    renderTable();
  }

  function renderTable() {
    const tbody = document.getElementById('audit-tbody');
    if (!tbody) return;
    if (!data.rows.length) { tbody.innerHTML = `<tr><td colspan="6" class="meta" style="text-align:center;padding:24px">No records match the current filters.</td></tr>`; return; }
    tbody.innerHTML = data.rows.map(r=>`<tr>
      <td class="meta">${new Date(r.created_at).toLocaleString('en-GB')}</td>
      <td>${esc(r.user_email||'—')}</td>
      <td><span class="badge badge-action">${esc(r.action)}</span></td>
      <td>${esc(r.entity)}${r.entity_id?` <span class="meta">#${r.entity_id}</span>`:''}</td>
      <td class="meta">${esc(r.detail||'—')}</td>
    </tr>`).join('');
    document.getElementById('audit-count').textContent = `${data.rows.length} of ${data.total} events`;
  }

  document.getElementById('main').innerHTML = `
    ${pageHead('Audit Log', 'Every create, edit, delete, login and permission-denied event is recorded here.')}
    <div class="card card-inner" style="margin-bottom:16px">
      <div class="form-row">
        <div class="field"><label>Action</label>
          <select id="f-action">
            <option value="">All actions</option>
            ${['login','login_failed','logout','create','edit','delete','approve','export','permission_denied','mfa_enabled','mfa_disabled','token_reuse_detected','password_reset_requested','email_verified']
              .map(a=>`<option value="${a}">${a}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Entity type</label>
          <input id="f-entity" placeholder="e.g. user, me_submission">
        </div>
        <div class="field"><label>From</label><input type="date" id="f-from"></div>
        <div class="field"><label>To</label><input type="date" id="f-to"></div>
        <div class="field" style="align-self:flex-end">
          <button class="btn-primary" id="filter-btn">Apply filters</button>
        </div>
      </div>
    </div>
    <div class="card card-table">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;padding:22px 24px 0">
        <span class="meta" id="audit-count">Loading…</span>
        <button class="btn-sm" id="refresh-btn">↻ Refresh</button>
      </div>
      <table>
        <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
        <tbody id="audit-tbody"><tr><td colspan="6" class="meta" style="text-align:center;padding:24px">Loading…</td></tr></tbody>
      </table>
    </div>`;

  document.getElementById('filter-btn').onclick = () => {
    filters.action = document.getElementById('f-action').value;
    filters.entity = document.getElementById('f-entity').value.trim();
    filters.from   = document.getElementById('f-from').value;
    filters.to     = document.getElementById('f-to').value;
    load();
  };
  document.getElementById('refresh-btn').onclick = load;
  load();
}

// ── M&E Forms ─────────────────────────────────────────────────────────────────
async function renderForms() {
  shell(pageHead('M&E Data Collection','Household Baseline Survey and field data submission.'), 'forms');
  let forms=[], submissions=[];
  try {
    forms       = asArray(await api('/forms'), 'forms');
    submissions = asArray(await api('/submissions'), 'submissions');
  }
  catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

  const form = forms[0];
  const canCreate = can('data_collection','create');

  document.getElementById('main').innerHTML = `
    ${pageHead('M&E Data Collection', form ? form.description : 'No forms available.')}
    ${form && canCreate ? `
    <div class="card card-inner" style="margin-bottom:18px">
      <h3>${esc(form.title)}</h3>
      <form id="me-form">
        <div class="form-grid">${(form.schema||[]).map(fieldHtml).join('')}</div>
        <button class="btn-primary" type="submit">Submit survey</button>
      </form>
    </div>` : form ? `<div class="card card-inner" style="margin-bottom:18px"><p class="meta">Your role can view submissions but not create new ones.</p></div>` : ''}
    <div class="card card-table">
      <h3 style="padding:22px 24px 0">Recent submissions (${submissions.length})</h3>
      ${!submissions.length ? `<p class="meta" style="padding:12px 24px 22px">No submissions yet.</p>` : `
      <table>
        <thead><tr><th>Beneficiary</th><th>Village</th><th>Programme</th><th>Submitted by</th><th>When</th></tr></thead>
        <tbody>${submissions.map(s=>`<tr>
          <td>${esc(s.answers?.beneficiary_name||'—')}</td>
          <td>${esc(s.answers?.village||'—')}</td>
          <td>${esc(s.answers?.programme_area||'—')}</td>
          <td class="meta">${esc(s.submitted_by_email)}</td>
          <td class="meta">${ago(s.submitted_at)}</td>
        </tr>`).join('')}</tbody>
      </table>`}
    </div>`;

  if (form && canCreate) {
    document.getElementById('me-form').onsubmit = async e => {
      e.preventDefault();
      const answers = {};
      for (const f of form.schema||[]) {
        const el = document.getElementById('f_'+f.id);
        if (el) answers[f.id] = f.type==='number' ? (el.value?Number(el.value):undefined) : el.value;
      }
      try {
        await api('/submissions',{method:'POST',body:{formKey:form.key,answers}});
        toast('Submission recorded.'); renderForms();
      } catch(e) { toast(e.message, true); }
    };
  }
}

function fieldHtml(f) {
  const req = f.required ? 'required' : '';
  if (f.type==='select') return `<div class="field"><label>${esc(f.label)}${f.required?' *':''}</label>
    <select id="f_${f.id}" ${req}><option value="">Select…</option>
    ${(f.options||[]).map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select></div>`;
  if (f.type==='textarea') return `<div class="field"><label>${esc(f.label)}${f.required?' *':''}</label>
    <textarea id="f_${f.id}" ${req}></textarea></div>`;
  return `<div class="field"><label>${esc(f.label)}${f.required?' *':''}</label>
    <input id="f_${f.id}" type="${f.type==='number'?'number':'text'}" ${req}></div>`;
}

// ── Contact Messages ──────────────────────────────────────────────────────────
async function renderMessages() {
  shell(pageHead('Contact Messages','Website enquiry inbox.'), 'messages');
  if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

  let msgs=[];
  try { msgs = asArray(await api('/admin/contact-messages'), 'messages'); }
  catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

  const statusColor = { new:'badge-new', read:'badge-role', replied:'badge-ok', archived:'meta' };

  document.getElementById('main').innerHTML = `
    ${pageHead('Contact Messages', `${msgs.filter(m=>m.status==='new').length} new · ${msgs.length} total`)}
    <div class="card card-table">
      <table>
        <thead><tr><th>From</th><th>Organisation</th><th>Subject</th><th>Status</th><th>Received</th><th>Actions</th></tr></thead>
        <tbody>
          ${msgs.map(m=>`<tr>
            <td><strong>${esc(m.full_name)}</strong><br><span class="meta">${esc(m.email)}</span></td>
            <td class="meta">${esc(m.organisation||'—')}</td>
            <td>${esc(m.subject)}<br><span class="meta">${esc((m.message||'').slice(0,80))}${(m.message||'').length>80?'…':''}</span></td>
            <td><span class="badge ${statusColor[m.status]||''}">${m.status}</span></td>
            <td class="meta">${ago(m.created_at)}</td>
            <td class="action-cell">
              ${['read','replied','archived'].map(s=>
                s!==m.status ? `<button class="btn-sm" data-msg="${m.id}" data-status="${s}">${s}</button>` : ''
              ).join('')}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  document.querySelectorAll('[data-msg]').forEach(btn => btn.onclick = async () => {
    try {
      await api(`/admin/contact-messages/${btn.dataset.msg}/status`,{method:'PATCH',body:{status:btn.dataset.status}});
      toast(`Marked as ${btn.dataset.status}.`); renderMessages();
    } catch(e) { toast(e.message, true); }
  });
}

// ── Profile / MFA setup ───────────────────────────────────────────────────────
async function renderProfile() {
  shell(pageHead('My Profile','Account settings and two-factor authentication.'), 'profile');
  const u = state.user;

  document.getElementById('main').innerHTML = `
    ${pageHead('My Profile')}
    <div class="two-col">
      <div class="card card-inner">
        <h3>Account details</h3>
        <dl class="detail-list">
          <dt>Name</dt><dd>${esc(u.name)}</dd>
          <dt>Email</dt><dd>${esc(u.email)}</dd>
          <dt>Email verified</dt><dd>${u.emailVerified?'✅ Yes':'⚠️ Not verified'}</dd>
          <dt>MFA</dt><dd>${u.mfaEnabled?'✅ Enabled':'⬜ Disabled'}</dd>
          <dt>Roles</dt><dd>${state.roles.map(r=>`<span class="badge badge-role">${esc(r.name)}</span>`).join(' ')||'None'}</dd>
        </dl>
      </div>
      <div class="card card-inner">
        <h3>Two-factor authentication</h3>
        ${u.mfaEnabled ? `
          <p class="meta" style="margin-bottom:14px">MFA is active. Enter your current code to disable it.</p>
          <div class="field"><label>Current authentication code</label><input id="mfa-dis-code" type="text" maxlength="6" inputmode="numeric" placeholder="000000"></div>
          <button class="btn-primary btn-danger" id="dis-mfa-btn">Disable MFA</button>
        ` : `
          <p class="meta" style="margin-bottom:14px">Scan the QR code (or copy the key) into your authenticator app, then enter the 6-digit code to confirm.</p>
          <button class="btn-primary" id="setup-mfa-btn">Set up MFA</button>
          <div id="mfa-setup-area"></div>
        `}
        <div id="mfa-msg" style="margin-top:10px"></div>
      </div>
    </div>`;

  if (u.mfaEnabled) {
    document.getElementById('dis-mfa-btn').onclick = async () => {
      const code = document.getElementById('mfa-dis-code').value.trim();
      try {
        await api('/auth/mfa/disable',{method:'POST',body:{code}});
        toast('MFA disabled.'); const d = await api('/auth/me'); state.user=d.user; renderProfile();
      } catch(e) { document.getElementById('mfa-msg').textContent = e.message; }
    };
  } else {
    document.getElementById('setup-mfa-btn').onclick = async () => {
      try {
        const d = await api('/auth/mfa/setup',{method:'POST',body:{}});
        document.getElementById('mfa-setup-area').innerHTML = `
          <div style="margin-top:16px">
            <p class="meta">Scan with your authenticator app, or enter the key manually:</p>
            <code style="font-size:13px;background:#f3f5f1;padding:6px 10px;border-radius:4px;display:block;margin:10px 0;word-break:break-all">${esc(d.secret)}</code>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(d.otpauthUri)}" alt="QR code" style="border:1px solid var(--line);border-radius:6px;display:block;margin:10px 0">
            <div class="field"><label>Enter the 6-digit code to confirm</label><input id="mfa-confirm-code" type="text" maxlength="6" inputmode="numeric" placeholder="000000"></div>
            <button class="btn-primary" id="confirm-mfa-btn">Enable MFA</button>
          </div>`;
        document.getElementById('confirm-mfa-btn').onclick = async () => {
          const code = document.getElementById('mfa-confirm-code').value.trim();
          try {
            await api('/auth/mfa/enable',{method:'POST',body:{code}});
            toast('MFA enabled!'); const d2 = await api('/auth/me'); state.user=d2.user; renderProfile();
          } catch(e) { document.getElementById('mfa-msg').textContent = e.message; }
        };
      } catch(e) { document.getElementById('mfa-msg').textContent = e.message; }
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function forbidden() { return `<div class="card card-inner meta">You don't have permission to view this section. Contact your Foundation Admin to request access.</div>`; }
function errBox(msg) { return `<div class="card card-inner" style="color:var(--danger)">${esc(msg)}</div>`; }

// ── Boot ──────────────────────────────────────────────────────────────────────
tryRestoreSession();const WEBSITE_URL = document.querySelector('meta[name="website-url"]')?.content || 'http://localhost:3001';
// app.js — Kabonix Foundation Staff Portal (Sprint 01–03)
// Admin & Governance control room + M&E data collection UI.

const API = (document.querySelector('meta[name="api-url"]')?.content || 'http://localhost:4000') + '/api';

const state = {
  token: lsGet('kabonix_token'),
  user: null, roles: [], permissions: [],
  route: 'dashboard', routeParam: null,
};

// Top-level `const` in a classic script does NOT become a window property, so
// ai.js could never see the session. Mirror it explicitly.
window.state = state;

function lsGet(k)    { try { return localStorage.getItem(k); } catch { return (window.__m||{})[k]||null; } }
function lsSet(k,v)  { try { localStorage.setItem(k,v); } catch { window.__m=window.__m||{}; window.__m[k]=v; } }
function lsDel(k)    { try { localStorage.removeItem(k); } catch { if(window.__m) delete window.__m[k]; } }

const root = document.getElementById('root');

async function api(path, opts={}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type':'application/json', ...(state.token?{Authorization:`Bearer ${state.token}`}:{}), ...(opts.headers||{}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function can(module, level) { return state.permissions.some(p=>p.module===module&&p.level===level); }

function toast(msg, isErr) {
  const el = Object.assign(document.createElement('div'), { className:'toast'+(isErr?' error':''), textContent:msg });
  document.body.appendChild(el); setTimeout(()=>el.remove(), 3400);
}

function esc(s) {
  if (s==null) return '';
  return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function ago(ts) {
  if (!ts) return '—';
  const s = Math.round((Date.now()-new Date(ts))/1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return new Date(ts).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}

// ── Session ──────────────────────────────────────────────────────────────────
async function tryRestoreSession() {
  if (!state.token) return render();
  try {
    const d = await api('/auth/me');
    state.user = d.user; state.roles = d.roles; state.permissions = d.permissions;
  } catch { state.token=null; lsDel('kabonix_token'); }
  render();
}

async function login(email, password) {
  const d = await api('/auth/login',{method:'POST',body:{email,password}});
  if (d.mfaRequired) return d; // caller handles MFA step
  state.token=d.accessToken; state.user=d.user; state.roles=d.roles; state.permissions=d.permissions;
  lsSet('kabonix_token', d.accessToken);
  state.route='dashboard'; render();
}

async function submitMfa(challengeToken, code) {
  const d = await api('/auth/mfa/challenge',{method:'POST',body:{challengeToken,code}});
  state.token=d.accessToken; state.user=d.user; state.roles=d.roles; state.permissions=d.permissions;
  lsSet('kabonix_token', d.accessToken);
  state.route='dashboard'; render();
}

function logout() {
  state.token=null; state.user=null; state.roles=[]; state.permissions=[];
  lsDel('kabonix_token'); render();
}

// ── Router ───────────────────────────────────────────────────────────────────
function nav(route, param) { state.route=route; state.routeParam=param||null; render(); }

function render() {
  if (!state.token||!state.user) return renderLogin();
  const views = {
    dashboard: renderDashboard,
    users:     renderUsers,
    roles:     renderRoles,
    config:    renderConfig,
    audit:     renderAudit,
    forms:     renderForms,
    messages:  renderMessages,
    profile:   renderProfile,
  };
  (views[state.route]||renderDashboard)();
}

// ── Login ────────────────────────────────────────────────────────────────────
function renderLogin(mfaChallenge) {
  root.innerHTML = `
<div class="login-screen">
  <div class="login-visual">
    <div class="mark">KABONIX FOUNDATION</div>
    <h1>Digital Ecosystem Platform</h1>
    <p>Staff & field officer portal. Collect, manage and act on programme data.</p>
    <div class="login-pills">
      <span>🌊 Blue Economy</span><span>🌱 Carbon</span><span>⚡ Renewable Energy</span><span>👩‍💼 Youth & Women</span>
    </div>
  </div>
  <div class="login-form-side">
    <div class="login-card">
      ${mfaChallenge ? `
        <h2>Two-factor authentication</h2>
        <p class="sub">Enter the 6-digit code from your authenticator app.</p>
        <div class="field"><label>Authentication code</label><input id="l-code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000"></div>
        <button class="btn-primary" id="mfa-btn">Verify</button>
        <p class="hint"><a href="#" id="back-link">← Back to sign in</a></p>
      ` : `
        <h2>Sign in</h2>
        <p class="sub">Foundation staff and field officers only.</p>
        <div class="field"><label>Email</label><input id="l-email" type="email" value="admin@kabonix.org"></div>
        <div class="field"><label>Password</label><input id="l-pw" type="password" value="ChangeMe123!"></div>
        <button class="btn-primary" id="login-btn">Sign in</button>
        <p class="hint">Seeded accounts: <strong>admin@kabonix.org</strong> (Super Admin) · <strong>amina@kabonix.org</strong> (Field Officer) — password: <strong>ChangeMe123!</strong></p>
      `}
      <div id="l-err" class="err-msg"></div>
    </div>
  </div>
</div>`;
  if (mfaChallenge) {
    const code = document.getElementById('l-code');
    code.focus();
    document.getElementById('mfa-btn').onclick = async () => {
      try { await submitMfa(mfaChallenge, code.value.trim()); }
      catch(e) { document.getElementById('l-err').textContent = e.message; }
    };
    document.getElementById('back-link').onclick = e => { e.preventDefault(); render(); };
  } else {
    document.getElementById('login-btn').onclick = doLogin;
    document.getElementById('l-pw').onkeydown = e => { if(e.key==='Enter') doLogin(); };
  }
}

async function doLogin() {
  const email = document.getElementById('l-email').value.trim();
  const pw    = document.getElementById('l-pw').value;
  const err   = document.getElementById('l-err');
  err.textContent = '';
  try {
    const d = await login(email, pw);
    if (d?.mfaRequired) renderLogin(d.challengeToken);
  } catch(e) { err.textContent = e.message; }
}

// ── Shell ─────────────────────────────────────────────────────────────────────
function shell(contentHtml, activeRoute) {
  const items = [
    { key:'dashboard', icon:'◉', label:'Dashboard' },
    can('data_collection','view') && { key:'forms', icon:'📋', label:'M&E Collection' },
    can('admin','view') && { key:'users', icon:'👥', label:'Staff & Users' },
    can('admin','view') && { key:'roles', icon:'🔐', label:'Roles & Permissions' },
    can('admin','view') && { key:'config', icon:'⚙️', label:'System Config' },
    can('admin','view') && { key:'messages', icon:'✉️', label:'Contact Messages' },
    (can('admin','view')||can('data_collection','approve')) && { key:'audit', icon:'📜', label:'Audit Log' },
  ].filter(Boolean);

  root.innerHTML = `
<div class="app-shell">
  <aside class="sidebar">
    <div class="sb-brand">
      <button id="sb-toggle" aria-label="Toggle menu">☰</button>
      <a class="sb-brand-link" href="${WEBSITE_URL}" target="_blank" rel="noopener">
        <div class="sb-logo"><img src="/assets/logo.png" class="sb-logo-img" onerror="this.style.display='none'" alt="Kabonix logo"></div>
      </a>
      <div><div class="sb-name">KABONIX</div><div class="sb-sub">FOUNDATION</div></div>
    </div>
    <nav class="sb-nav">
        ${items.map(i=>`<a class="nav-item${state.route===i.key?' active':''}" data-route="${i.key}">
          <span class="nav-icon">${i.icon}</span><span class="nav-label">${esc(i.label)}</span></a>`).join('')}
    </nav>
    <div class="sb-foot">
      <a class="nav-item" data-route="profile"><span class="nav-icon">👤</span>${esc(state.user.name.split(' ')[0])}</a>
      <button class="sb-logout" id="logout-btn">Sign out</button>
    </div>
  </aside>
  <main class="main-area" id="main">${contentHtml}</main>
</div>`;
  root.querySelectorAll('.nav-item[data-route]').forEach(el => el.onclick = e => { e.preventDefault(); nav(el.dataset.route); });
  document.getElementById('logout-btn').onclick = logout;
  const sbToggle = document.getElementById('sb-toggle');
  const appShell = document.querySelector('.app-shell');
  const sidebarEl = document.querySelector('.sidebar');
  if (sbToggle) {
    sbToggle.onclick = () => {
      if (window.innerWidth <= 800) {
        appShell.classList.toggle('sidebar-open');
      } else {
        sidebarEl.classList.toggle('collapsed');
      }
    };
  }
  const mainArea = document.querySelector('.main-area');
  if (mainArea) mainArea.onclick = () => { if (appShell.classList.contains('sidebar-open')) appShell.classList.remove('sidebar-open'); };
}

function pageHead(title, sub='') {
  return `<div class="page-head"><h1>${esc(title)}</h1>${sub?`<p>${esc(sub)}</p>`:''}</div>`;
}

function card(content, cls='') { return `<div class="card ${cls}">${content}</div>`; }

// ── Dashboard ────────────────────────────────────────────────────────────────
async function renderDashboard() {
  shell(`${pageHead('Dashboard','Loading…')}`, 'dashboard');
  let stats = {};
  try { stats = await api('/admin/stats'); } catch {}

  const me = state.user;
  const roleNames = state.roles.map(r=>r.name).join(', ')||'No roles assigned';

  shell(`
    ${pageHead('Dashboard', `Welcome back, ${me.name.split(' ')[0]}. ${new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}.`)}
    <div class="stat-row">
      ${statCard('Active staff',     stats.activeUsers       ?? '—', '👥')}
      ${statCard('Submissions',      stats.submissions        ?? '—', '📋')}
      ${statCard('Audit events (24h)',stats.auditEventsToday ?? '—', '📜')}
      ${statCard('New enquiries',    stats.newContactMessages ?? '—', '✉️')}
    </div>
    <div class="two-col">
      ${card(`<h3>Your access</h3>
        <p class="meta">${esc(roleNames)}</p>
        <table class="mini-table"><tbody>
          ${Object.entries(groupPerms(state.permissions)).map(([m,ls])=>`<tr><td>${esc(m)}</td><td>${ls.map(l=>`<span class="badge">${l}</span>`).join('')}</td></tr>`).join('')}
        </tbody></table>`, 'card-inner')}
      ${card(`<h3>Quick actions</h3>
        <div class="quick-actions">
          ${can('data_collection','create') ? `<button class="qa-btn" onclick="nav('forms')">📋 Submit M&E form</button>` : ''}
          ${can('admin','create')           ? `<button class="qa-btn" onclick="nav('users')">➕ Invite staff member</button>` : ''}
          ${can('admin','view')             ? `<button class="qa-btn" onclick="nav('messages')">✉️ View contact messages</button>` : ''}
          ${can('admin','view')||can('data_collection','approve') ? `<button class="qa-btn" onclick="nav('audit')">📜 View audit log</button>` : ''}
        </div>`, 'card-inner')}
    </div>
    <div style="margin-top:8px" class="meta">Platform: Postgres + PostGIS · Migrations applied: ${stats.migrationsApplied ?? '—'} · <a href="${WEBSITE_URL}" target="_blank">Public website ↗</a></div>
  `, 'dashboard');
}

function statCard(label, value, icon) {
  return `<div class="stat-card"><div class="stat-icon">${icon}</div><div class="stat-value">${esc(String(value))}</div><div class="stat-label">${esc(label)}</div></div>`;
}

function groupPerms(perms) {
  const out={};
  for(const p of perms) (out[p.module]??=[]).push(p.level);
  return out;
}

// Normalise list-shaped API payloads ({ users:[…] } vs […]) so the UI never
// crashes on a shape change.
function asArray(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  return [];
}

// ── Staff & Users ─────────────────────────────────────────────────────────────
async function renderUsers() {
  shell(pageHead('Staff & Users','Manage team members, roles and account status.'), 'users');
  if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

  let users=[], roles=[];
  try {
    const [usersRes, rolesRes] = await Promise.all([api('/admin/users'), api('/admin/roles')]);
    users = asArray(usersRes, 'users');
    roles = asArray(rolesRes, 'roles');
  }
  catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

  document.getElementById('main').innerHTML = `
    ${pageHead('Staff & Users', `${users.length} accounts · ${users.filter(u=>u.is_active).length} active`)}
    ${can('admin','create') ? `
    <div class="card card-inner" style="margin-bottom:18px">
      <h3>Invite new staff member</h3>
      <div class="form-row">
        <div class="field"><label>Full name</label><input id="inv-name" placeholder="Jane Doe"></div>
        <div class="field"><label>Email</label><input id="inv-email" type="email" placeholder="jane@kabonix.org"></div>
        <div class="field"><label>Initial role</label>
          <select id="inv-role">
            <option value="">No role yet</option>
            ${roles.map(r=>`<option value="${esc(r.key)}">${esc(r.name)}</option>`).join('')}
          </select></div>
        <div class="field" style="align-self:flex-end">
          <button class="btn-primary" id="invite-btn">Send invite</button>
        </div>
      </div>
    </div>` : ''}
    <div class="card">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th>MFA</th><th>Last active</th><th>Actions</th></tr></thead>
        <tbody id="users-tbody">
          ${users.map(u => {
            const userRoles = u.roles || [];
            return `<tr data-uid="${u.id}">
            <td><strong>${esc(u.name)}</strong></td>
            <td class="meta">${esc(u.email)}</td>
            <td>${userRoles.map(r=>`<span class="badge badge-role">${esc(r.name)}</span>`).join(' ')||'<span class="meta">none</span>'}</td>
            <td><span class="status-dot ${u.is_active?'active':'inactive'}"></span>${u.is_active?'Active':'Inactive'}</td>
            <td>${u.mfa_enabled?'✅ On':'⬜ Off'}</td>
            <td class="meta">${ago(u.last_active)}</td>
            <td class="action-cell">
              ${can('admin','edit') ? `
              <select class="inline-select" data-uid="${u.id}" id="role-sel-${u.id}">
                ${roles.map(r=>`<option value="${esc(r.key)}" ${userRoles.some(ur=>ur.key===r.key)?'selected':''}>${esc(r.name)}</option>`).join('')}
              </select>
              <button class="btn-sm" data-assign="${u.id}">Assign</button>
              ${u.is_active && u.id!==state.user.id ? `<button class="btn-sm btn-danger" data-deactivate="${u.id}">Deactivate</button>` : ''}
              ${!u.is_active ? `<button class="btn-sm btn-ok" data-reactivate="${u.id}">Reactivate</button>` : ''}
              ` : ''}
            </td>
          </tr>`; }).join('')}
        </tbody>
      </table>
    </div>`;

  if (can('admin','create')) {
    document.getElementById('invite-btn').onclick = async () => {
      const name  = document.getElementById('inv-name').value.trim();
      const email = document.getElementById('inv-email').value.trim();
      const role  = document.getElementById('inv-role').value;
      try {
        await api('/admin/users/invite',{method:'POST',body:{name,email,roleKey:role||undefined}});
        toast('Invitation sent — check the API console for the dev email link.');
        renderUsers();
      } catch(e) { toast(e.message, true); }
    };
  }

  document.querySelectorAll('[data-assign]').forEach(btn => btn.onclick = async () => {
    const uid = Number(btn.dataset.assign);
    const roleKey = document.getElementById(`role-sel-${uid}`).value;
    try { await api(`/admin/users/${uid}/roles`,{method:'PUT',body:{roleKeys:[roleKey]}}); toast('Role updated.'); renderUsers(); }
    catch(e) { toast(e.message, true); }
  });
  document.querySelectorAll('[data-deactivate]').forEach(btn => btn.onclick = async () => {
    if (!confirm('Deactivate this user? Their active sessions will be revoked.')) return;
    try { await api(`/admin/users/${btn.dataset.deactivate}/deactivate`,{method:'POST',body:{}}); toast('User deactivated.'); renderUsers(); }
    catch(e) { toast(e.message, true); }
  });
  document.querySelectorAll('[data-reactivate]').forEach(btn => btn.onclick = async () => {
    try { await api(`/admin/users/${btn.dataset.reactivate}/reactivate`,{method:'POST',body:{}}); toast('User reactivated.'); renderUsers(); }
    catch(e) { toast(e.message, true); }
  });
}

// ── Roles & Permissions ───────────────────────────────────────────────────────
async function renderRoles() {
  shell(pageHead('Roles & Permissions', 'Loading…'), 'roles');
  if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

  let data = { roles:[], modules:[], levels:[] };
  try { data = await api('/admin/roles'); }
  catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

  const roles   = asArray(data, 'roles');
  const modules = Array.isArray(data?.modules) ? data.modules : [];
  const levels  = Array.isArray(data?.levels)  ? data.levels  : [];

  document.getElementById('main').innerHTML = `
    ${pageHead('Roles & Permissions', `${roles.length} roles · tick cells to grant a permission · click Save to apply`)}
    ${can('admin','create') ? `
    <div class="card card-inner" style="margin-bottom:18px">
      <h3>Create new role</h3>
      <div class="form-row">
        <div class="field"><label>Key (lowercase, underscores)</label><input id="r-key" placeholder="e.g. data_analyst"></div>
        <div class="field"><label>Display name</label><input id="r-name" placeholder="Data Analyst"></div>
        <div class="field"><label>Description</label><input id="r-desc" placeholder="Optional"></div>
        <div class="field" style="align-self:flex-end"><button class="btn-primary" id="create-role-btn">Create role</button></div>
      </div>
    </div>` : ''}
    ${roles.map(role => {
      const permSet = new Set((role.permissions||[]).map(p=>`${p.module}:${p.level}`));
      return `<div class="card" style="margin-bottom:16px; overflow-x:auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div><strong>${esc(role.name)}</strong> <span class="meta">${esc(role.key)}</span></div>
          ${can('admin','approve') ? `<button class="btn-primary btn-sm" data-save-role="${role.id}">Save permissions</button>` : ''}
        </div>
        <table class="perm-table">
          <thead><tr><th>Module</th>${levels.map(l=>`<th>${esc(l)}</th>`).join('')}</tr></thead>
          <tbody>
            ${modules.map(mod=>`<tr>
              <td class="mod-name">${esc(mod)}</td>
              ${levels.map(lev=>`<td class="perm-cell">
                <input type="checkbox" data-role="${role.id}" data-mod="${mod}" data-lev="${lev}"
                  ${permSet.has(`${mod}:${lev}`) ? 'checked' : ''}
                  ${can('admin','approve') ? '' : 'disabled'}>
              </td>`).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    }).join('')}`;

  if (can('admin','create')) {
    document.getElementById('create-role-btn').onclick = async () => {
      try {
        await api('/admin/roles',{method:'POST',body:{
          key: document.getElementById('r-key').value.trim(),
          name: document.getElementById('r-name').value.trim(),
          description: document.getElementById('r-desc').value.trim()||undefined,
        }});
        toast('Role created.'); renderRoles();
      } catch(e) { toast(e.message, true); }
    };
  }

  document.querySelectorAll('[data-save-role]').forEach(btn => btn.onclick = async () => {
    const roleId = Number(btn.dataset.saveRole);
    const perms = [...document.querySelectorAll(`input[data-role="${roleId}"]:checked`)]
      .map(cb=>({ module: cb.dataset.mod, level: cb.dataset.lev }));
    try {
      await api(`/admin/roles/${roleId}/permissions`,{method:'PUT',body:{permissions:perms}});
      toast(`Permissions saved (${perms.length} granted).`);
    } catch(e) { toast(e.message, true); }
  });
}

// ── System Config ─────────────────────────────────────────────────────────────
async function renderConfig() {
  shell(pageHead('System Configuration', 'Loading…'), 'config');
  if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

  let cfg=[], prefs={};
  try {
    cfg = asArray(await api('/admin/config'), 'config');
    prefs = await api('/admin/notifications/preferences').catch(()=>({}));
  } catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

  document.getElementById('main').innerHTML = `
    ${pageHead('System Configuration', 'Platform-wide settings managed by Foundation admin — no developer required.')}
    <div class="two-col">
      <div>
        <div class="card card-inner">
          <h3>Platform settings</h3>
          ${cfg.map(c => `<div class="cfg-row" data-key="${esc(c.key)}">
            <div class="cfg-label">
              <strong>${esc(c.label)}</strong>
              ${c.description ? `<span class="meta">${esc(c.description)}</span>` : ''}
            </div>
            <div class="cfg-control">
              ${cfgControl(c)}
              ${can('admin','edit') ? `<button class="btn-sm" data-cfg="${esc(c.key)}">Save</button>` : ''}
            </div>
          </div>`).join('')}
        </div>
      </div>
      <div>
        <div class="card card-inner">
          <h3>My notification preferences</h3>
          <p class="meta" style="margin-bottom:14px">These apply to your account only.</p>
          ${[
            ['email',    '✉️', 'Email notifications'],
            ['sms',      '📱', 'SMS notifications'],
            ['whatsapp', '💬', 'WhatsApp notifications'],
            ['in_app',   '🔔', 'In-app notifications'],
          ].map(([k,icon,label])=>`
            <div class="cfg-row">
              <div class="cfg-label"><strong>${icon} ${label}</strong></div>
              <div class="cfg-control">
                <label class="toggle-wrap">
                  <input type="checkbox" class="pref-toggle" data-pref="${k}" ${prefs[k]?'checked':''}>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>`).join('')}
          <div style="margin-top:16px">
            <button class="btn-primary" id="save-prefs-btn">Save preferences</button>
          </div>
        </div>
        <div class="card card-inner" style="margin-top:16px">
          <h3>Migration status</h3>
          <p class="meta">Applied SQL migrations tracked in <code>schema_migrations</code>.</p>
          <div id="migration-list" style="margin-top:10px">Loading…</div>
        </div>
      </div>
    </div>`;

  // Load migrations list
  pool_migrations_display();

  if (can('admin','edit')) {
    document.querySelectorAll('[data-cfg]').forEach(btn => btn.onclick = async () => {
      const key = btn.dataset.cfg;
      const row = document.querySelector(`.cfg-row[data-key="${key}"]`);
      const ctrl = row.querySelector('.cfg-value');
      const value = ctrl.type === 'checkbox' ? String(ctrl.checked) : ctrl.value;
      try {
        await api(`/admin/config/${key}`,{method:'PATCH',body:{value}});
        toast(`${key} saved.`);
      } catch(e) { toast(e.message, true); }
    });
  }

  document.getElementById('save-prefs-btn').onclick = async () => {
    const nextPrefs = {
      email:    document.querySelector('[data-pref="email"]').checked,
      sms:      document.querySelector('[data-pref="sms"]').checked,
      whatsapp: document.querySelector('[data-pref="whatsapp"]').checked,
      in_app:   document.querySelector('[data-pref="in_app"]').checked,
      subscriptions: ['approval_required','submission_flagged','project_milestone_due','system_alert'],
    };
    try { await api('/admin/notifications/preferences',{method:'PUT',body:nextPrefs}); toast('Notification preferences saved.'); }
    catch(e) { toast(e.message, true); }
  };
}

async function pool_migrations_display() {
  const el = document.getElementById('migration-list');
  if (!el) return;
  try {
    const stats = await api('/admin/stats');
    el.innerHTML = `<span class="badge badge-ok">✓ ${stats.migrationsApplied} migrations applied</span>`;
  } catch { el.textContent = 'Could not load.'; }
}

function cfgControl(c) {
  if (c.type === 'boolean') return `<label class="toggle-wrap"><input type="checkbox" class="cfg-value" ${c.value==='true'?'checked':''}><span class="toggle-slider"></span></label>`;
  if (c.type === 'select')  return `<select class="cfg-value">${(c.options||'').split(',').map(o=>`<option value="${esc(o.trim())}" ${c.value===o.trim()?'selected':''}>${esc(o.trim())}</option>`).join('')}</select>`;
  return `<input type="${c.type==='number'?'number':'text'}" class="cfg-value" value="${esc(c.value)}">`;
}

// ── Audit Log ─────────────────────────────────────────────────────────────────
async function renderAudit() {
  shell(pageHead('Audit Log','Full record of who changed what, and when.'), 'audit');
  if (!can('admin','view') && !can('data_collection','approve'))
    return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

  let data = { rows:[], total:0 };
  const filters = { action:'', entity:'', userId:'', from:'', to:'' };
  async function load() {
    const qs = new URLSearchParams({ limit:200, ...Object.fromEntries(Object.entries(filters).filter(([,v])=>v)) });
    data = await api(`/admin/audit?${qs}`).catch(()=>({ rows:[], total:0 }));
    renderTable();
  }

  function renderTable() {
    const tbody = document.getElementById('audit-tbody');
    if (!tbody) return;
    if (!data.rows.length) { tbody.innerHTML = `<tr><td colspan="6" class="meta" style="text-align:center;padding:24px">No records match the current filters.</td></tr>`; return; }
    tbody.innerHTML = data.rows.map(r=>`<tr>
      <td class="meta">${new Date(r.created_at).toLocaleString('en-GB')}</td>
      <td>${esc(r.user_email||'—')}</td>
      <td><span class="badge badge-action">${esc(r.action)}</span></td>
      <td>${esc(r.entity)}${r.entity_id?` <span class="meta">#${r.entity_id}</span>`:''}</td>
      <td class="meta">${esc(r.detail||'—')}</td>
    </tr>`).join('');
    document.getElementById('audit-count').textContent = `${data.rows.length} of ${data.total} events`;
  }

  document.getElementById('main').innerHTML = `
    ${pageHead('Audit Log', 'Every create, edit, delete, login and permission-denied event is recorded here.')}
    <div class="card card-inner" style="margin-bottom:16px">
      <div class="form-row">
        <div class="field"><label>Action</label>
          <select id="f-action">
            <option value="">All actions</option>
            ${['login','login_failed','logout','create','edit','delete','approve','export','permission_denied','mfa_enabled','mfa_disabled','token_reuse_detected','password_reset_requested','email_verified']
              .map(a=>`<option value="${a}">${a}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Entity type</label>
          <input id="f-entity" placeholder="e.g. user, me_submission">
        </div>
        <div class="field"><label>From</label><input type="date" id="f-from"></div>
        <div class="field"><label>To</label><input type="date" id="f-to"></div>
        <div class="field" style="align-self:flex-end">
          <button class="btn-primary" id="filter-btn">Apply filters</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px">
        <span class="meta" id="audit-count">Loading…</span>
        <button class="btn-sm" id="refresh-btn">↻ Refresh</button>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
          <tbody id="audit-tbody"><tr><td colspan="6" class="meta" style="text-align:center;padding:24px">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>`;

  document.getElementById('filter-btn').onclick = () => {
    filters.action = document.getElementById('f-action').value;
    filters.entity = document.getElementById('f-entity').value.trim();
    filters.from   = document.getElementById('f-from').value;
    filters.to     = document.getElementById('f-to').value;
    load();
  };
  document.getElementById('refresh-btn').onclick = load;
  load();
}

// ── M&E Forms ─────────────────────────────────────────────────────────────────
async function renderForms() {
  shell(pageHead('M&E Data Collection','Household Baseline Survey and field data submission.'), 'forms');
  let forms=[], submissions=[];
  try {
    forms       = asArray(await api('/forms'), 'forms');
    submissions = asArray(await api('/submissions'), 'submissions');
  }
  catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

  const form = forms[0];
  const canCreate = can('data_collection','create');

  document.getElementById('main').innerHTML = `
    ${pageHead('M&E Data Collection', form ? form.description : 'No forms available.')}
    ${form && canCreate ? `
    <div class="card card-inner" style="margin-bottom:18px">
      <h3>${esc(form.title)}</h3>
      <form id="me-form">
        <div class="form-grid">${(form.schema||[]).map(fieldHtml).join('')}</div>
        <button class="btn-primary" type="submit">Submit survey</button>
      </form>
    </div>` : form ? `<div class="card card-inner" style="margin-bottom:18px"><p class="meta">Your role can view submissions but not create new ones.</p></div>` : ''}
    <div class="card">
      <h3>Recent submissions (${submissions.length})</h3>
      ${!submissions.length ? `<p class="meta">No submissions yet.</p>` : `
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Beneficiary</th><th>Village</th><th>Programme</th><th>Submitted by</th><th>When</th></tr></thead>
        <tbody>${submissions.map(s=>`<tr>
          <td>${esc(s.answers?.beneficiary_name||'—')}</td>
          <td>${esc(s.answers?.village||'—')}</td>
          <td>${esc(s.answers?.programme_area||'—')}</td>
          <td class="meta">${esc(s.submitted_by_email)}</td>
          <td class="meta">${ago(s.submitted_at)}</td>
        </tr>`).join('')}</tbody>
      </table></div>`}
    </div>`;

  if (form && canCreate) {
    document.getElementById('me-form').onsubmit = async e => {
      e.preventDefault();
      const answers = {};
      for (const f of form.schema||[]) {
        const el = document.getElementById('f_'+f.id);
        if (el) answers[f.id] = f.type==='number' ? (el.value?Number(el.value):undefined) : el.value;
      }
      try {
        await api('/submissions',{method:'POST',body:{formKey:form.key,answers}});
        toast('Submission recorded.'); renderForms();
      } catch(e) { toast(e.message, true); }
    };
  }
}

function fieldHtml(f) {
  const req = f.required ? 'required' : '';
  if (f.type==='select') return `<div class="field"><label>${esc(f.label)}${f.required?' *':''}</label>
    <select id="f_${f.id}" ${req}><option value="">Select…</option>
    ${(f.options||[]).map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select></div>`;
  if (f.type==='textarea') return `<div class="field"><label>${esc(f.label)}${f.required?' *':''}</label>
    <textarea id="f_${f.id}" ${req}></textarea></div>`;
  return `<div class="field"><label>${esc(f.label)}${f.required?' *':''}</label>
    <input id="f_${f.id}" type="${f.type==='number'?'number':'text'}" ${req}></div>`;
}

// ── Contact Messages ──────────────────────────────────────────────────────────
async function renderMessages() {
  shell(pageHead('Contact Messages','Website enquiry inbox.'), 'messages');
  if (!can('admin','view')) return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());

  let msgs=[];
  try { msgs = asArray(await api('/admin/contact-messages'), 'messages'); }
  catch(e) { return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message)); }

  const statusColor = { new:'badge-new', read:'badge-role', replied:'badge-ok', archived:'meta' };

  document.getElementById('main').innerHTML = `
    ${pageHead('Contact Messages', `${msgs.filter(m=>m.status==='new').length} new · ${msgs.length} total`)}
    <div class="card">
      <div style="overflow-x:auto"><table>
        <thead><tr><th>From</th><th>Organisation</th><th>Subject</th><th>Status</th><th>Received</th><th>Actions</th></tr></thead>
        <tbody>
          ${msgs.map(m=>`<tr>
            <td><strong>${esc(m.full_name)}</strong><br><span class="meta">${esc(m.email)}</span></td>
            <td class="meta">${esc(m.organisation||'—')}</td>
            <td>${esc(m.subject)}<br><span class="meta">${esc((m.message||'').slice(0,80))}${(m.message||'').length>80?'…':''}</span></td>
            <td><span class="badge ${statusColor[m.status]||''}">${m.status}</span></td>
            <td class="meta">${ago(m.created_at)}</td>
            <td class="action-cell">
              ${['read','replied','archived'].map(s=>
                s!==m.status ? `<button class="btn-sm" data-msg="${m.id}" data-status="${s}">${s}</button>` : ''
              ).join('')}
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;

  document.querySelectorAll('[data-msg]').forEach(btn => btn.onclick = async () => {
    try {
      await api(`/admin/contact-messages/${btn.dataset.msg}/status`,{method:'PATCH',body:{status:btn.dataset.status}});
      toast(`Marked as ${btn.dataset.status}.`); renderMessages();
    } catch(e) { toast(e.message, true); }
  });
}

// ── Profile / MFA setup ───────────────────────────────────────────────────────
async function renderProfile() {
  shell(pageHead('My Profile','Account settings and two-factor authentication.'), 'profile');
  const u = state.user;

  document.getElementById('main').innerHTML = `
    ${pageHead('My Profile')}
    <div class="two-col">
      <div class="card card-inner">
        <h3>Account details</h3>
        <dl class="detail-list">
          <dt>Name</dt><dd>${esc(u.name)}</dd>
          <dt>Email</dt><dd>${esc(u.email)}</dd>
          <dt>Email verified</dt><dd>${u.emailVerified?'✅ Yes':'⚠️ Not verified'}</dd>
          <dt>MFA</dt><dd>${u.mfaEnabled?'✅ Enabled':'⬜ Disabled'}</dd>
          <dt>Roles</dt><dd>${state.roles.map(r=>`<span class="badge badge-role">${esc(r.name)}</span>`).join(' ')||'None'}</dd>
        </dl>
      </div>
      <div class="card card-inner">
        <h3>Two-factor authentication</h3>
        ${u.mfaEnabled ? `
          <p class="meta" style="margin-bottom:14px">MFA is active. Enter your current code to disable it.</p>
          <div class="field"><label>Current authentication code</label><input id="mfa-dis-code" type="text" maxlength="6" inputmode="numeric" placeholder="000000"></div>
          <button class="btn-primary btn-danger" id="dis-mfa-btn">Disable MFA</button>
        ` : `
          <p class="meta" style="margin-bottom:14px">Scan the QR code (or copy the key) into your authenticator app, then enter the 6-digit code to confirm.</p>
          <button class="btn-primary" id="setup-mfa-btn">Set up MFA</button>
          <div id="mfa-setup-area"></div>
        `}
        <div id="mfa-msg" style="margin-top:10px"></div>
      </div>
    </div>`;

  if (u.mfaEnabled) {
    document.getElementById('dis-mfa-btn').onclick = async () => {
      const code = document.getElementById('mfa-dis-code').value.trim();
      try {
        await api('/auth/mfa/disable',{method:'POST',body:{code}});
        toast('MFA disabled.'); const d = await api('/auth/me'); state.user=d.user; renderProfile();
      } catch(e) { document.getElementById('mfa-msg').textContent = e.message; }
    };
  } else {
    document.getElementById('setup-mfa-btn').onclick = async () => {
      try {
        const d = await api('/auth/mfa/setup',{method:'POST',body:{}});
        document.getElementById('mfa-setup-area').innerHTML = `
          <div style="margin-top:16px">
            <p class="meta">Scan with your authenticator app, or enter the key manually:</p>
            <code style="font-size:13px;background:#f3f5f1;padding:6px 10px;border-radius:4px;display:block;margin:10px 0;word-break:break-all">${esc(d.secret)}</code>
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(d.otpauthUri)}" alt="QR code" style="border:1px solid var(--line);border-radius:6px;display:block;margin:10px 0">
            <div class="field"><label>Enter the 6-digit code to confirm</label><input id="mfa-confirm-code" type="text" maxlength="6" inputmode="numeric" placeholder="000000"></div>
            <button class="btn-primary" id="confirm-mfa-btn">Enable MFA</button>
          </div>`;
        document.getElementById('confirm-mfa-btn').onclick = async () => {
          const code = document.getElementById('mfa-confirm-code').value.trim();
          try {
            await api('/auth/mfa/enable',{method:'POST',body:{code}});
            toast('MFA enabled!'); const d2 = await api('/auth/me'); state.user=d2.user; renderProfile();
          } catch(e) { document.getElementById('mfa-msg').textContent = e.message; }
        };
      } catch(e) { document.getElementById('mfa-msg').textContent = e.message; }
    };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function forbidden() { return `<div class="card card-inner meta">You don't have permission to view this section. Contact your Foundation Admin to request access.</div>`; }
function errBox(msg) { return `<div class="card card-inner" style="color:var(--danger)">${esc(msg)}</div>`; }

// ── Boot ──────────────────────────────────────────────────────────────────────
tryRestoreSession();
