// app.js — Kabonix Foundation Staff Portal
(() => {
  if (window.__kabonixAppLoaded) {
    console.warn('[app] already loaded — skipping duplicate');
    return;
  }
  window.__kabonixAppLoaded = true;

  console.log('[app] booting…');

  const WEBSITE_URL = document.querySelector('meta[name="website-url"]')?.content || 'http://localhost:3001';

  const DEMO_MODE =
    document.querySelector('meta[name="demo-mode"]')?.content === 'true' ||
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(location.hostname);

  window.addEventListener('error', e => {
    const r = document.getElementById('root');
    if (r && !r.innerHTML.trim()) {
      r.innerHTML = '<pre style="padding:24px;font:13px/1.5 Menlo,Consolas,monospace;color:#a4372c;white-space:pre-wrap">'
        + (e.error?.stack || e.message || 'Unknown error') + '</pre>';
    }
  });
  window.addEventListener('unhandledrejection', e => {
    const r = document.getElementById('root');
    if (r && !r.innerHTML.trim()) {
      r.innerHTML = '<pre style="padding:24px;font:13px/1.5 Menlo,Consolas,monospace;color:#a4372c;white-space:pre-wrap">'
        + (e.reason?.stack || String(e.reason) || 'Unhandled rejection') + '</pre>';
    }
  });

  const API = (document.querySelector('meta[name="api-url"]')?.content || 'http://localhost:4000') + '/api';

  const state = {
    token: lsGet('kabonix_token'),
    user: null, roles: [], permissions: [],
    route: 'dashboard', routeParam: null,
    mfaChallenge: null,
  };

  window.state = state;

  function lsGet(k)    { try { return localStorage.getItem(k); } catch { return (window.__m||{})[k]||null; } }
  function lsSet(k,v)  { try { localStorage.setItem(k,v); } catch { window.__m=window.__m||{}; window.__m[k]=v; } }
  function lsDel(k)    { try { localStorage.removeItem(k); } catch { if(window.__m) delete window.__m[k]; } }

  const root = document.getElementById('root');

  let renderSeq = 0;
  function isStale(seq) { return seq !== renderSeq; }

  async function api(path, opts = {}) {
    const { __silent401, ...fetchOpts } = opts;
    const res = await fetch(API + path, {
      ...fetchOpts,
      headers: { 'Content-Type':'application/json', ...(state.token?{Authorization:`Bearer ${state.token}`}:{}), ...(fetchOpts.headers||{}) },
      body: fetchOpts.body ? JSON.stringify(fetchOpts.body) : undefined,
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok) {
      if (res.status === 401 && state.token && !__silent401) {
        state.token = null; state.user = null; state.roles = []; state.permissions = [];
        lsDel('kabonix_token');
        render();
      }
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }
  window.api = api;

  const extraViews    = {};
  const extraNavItems = [];
  window.__kabonix = Object.freeze({
    get state()     { return state; },
    get renderSeq() { return renderSeq; },
    isStale, can, esc, toast, api, shell, pageHead, card, nav,
    registerView(key, fn) { extraViews[key] = fn; },
    registerNav(item)     { extraNavItems.push(item); },
  });

  function can(module, level) { return state.permissions.some(p=>p.module===module&&p.level===level); }

  function toast(msg, isErr) {
    let stack = document.getElementById('toast-stack');
    if (!stack) {
      stack = Object.assign(document.createElement('div'), { id: 'toast-stack' });
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    const el = Object.assign(document.createElement('div'), {
      className: 'toast' + (isErr ? ' error' : ''),
      textContent: msg,
    });
    if (isErr) el.setAttribute('role', 'alert');
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
    return new Date(ts).toLocaleDateString(window.KabonixI18n?.locale?.() || 'en-GB',{day:'numeric',month:'short',year:'numeric'});
  }

  function asArray(value, key) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value[key])) return value[key];
    return [];
  }

  async function handleUrlTokens() {
    const params = new URLSearchParams(location.search);
    const resetToken  = params.get('resetToken');
    const verifyToken = params.get('verifyToken');
    if (!resetToken && !verifyToken) return false;

    const url = new URL(location.href);
    url.searchParams.delete('resetToken');
    url.searchParams.delete('verifyToken');
    history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);

    if (verifyToken) {
      root.innerHTML = `
<div class="login-screen">
  <div class="login-form-side">
    <div class="login-card">
      <h2>Verifying your email</h2>
      <p class="sub">One moment…</p>
      <div id="tok-msg" class="err-msg"></div>
      <p class="hint" id="tok-retry-wrap" style="display:none"><a href="#" id="tok-retry">← Back to sign in</a></p>
    </div>
  </div>
</div>`;
      const msg = document.getElementById('tok-msg');
      try {
        await api('/auth/email/verify', { method: 'POST', body: { token: verifyToken } });
        msg.innerHTML = '<span style="color:var(--ok)">✅ Your email address is verified. Redirecting to sign in…</span>';
        setTimeout(() => render(), 1600);
      } catch (e) {
        msg.textContent = e.message;
        document.getElementById('tok-retry-wrap').style.display = '';
        document.getElementById('tok-retry').onclick = ev => { ev.preventDefault(); render(); };
      }
      return true;
    }

    root.innerHTML = `
<div class="login-screen">
  <div class="login-form-side">
    <div class="login-card">
      <h2>Set a new password</h2>
      <p class="sub">Choose something at least 8 characters long.</p>
      <div class="field"><label>New password</label><input id="tok-pw1" type="password" autocomplete="new-password"></div>
      <div class="field"><label>Confirm new password</label><input id="tok-pw2" type="password" autocomplete="new-password"></div>
      <button class="btn-primary" id="tok-submit">Update password</button>
      <p class="hint"><a href="#" id="tok-back">← Back to sign in</a></p>
      <div id="tok-msg" class="err-msg"></div>
    </div>
  </div>
</div>`;
    document.getElementById('tok-back').onclick = e => { e.preventDefault(); render(); };
    const submit = async () => {
      const pw1 = document.getElementById('tok-pw1').value;
      const pw2 = document.getElementById('tok-pw2').value;
      const msg = document.getElementById('tok-msg');
      msg.textContent = '';
      if (pw1.length < 8) return msg.textContent = 'Password must be at least 8 characters.';
      if (pw1 !== pw2)     return msg.textContent = 'Passwords do not match.';
      try {
        await api('/auth/password/reset', { method: 'POST', body: { token: resetToken, newPassword: pw1 } });
        msg.innerHTML = '<span style="color:var(--ok)">✅ Password updated. Redirecting to sign in…</span>';
        setTimeout(() => render(), 1600);
      } catch (e) { msg.textContent = e.message; }
    };
    document.getElementById('tok-submit').onclick = submit;
    document.getElementById('tok-pw2').onkeydown = e => { if (e.key === 'Enter') submit(); };
    return true;
  }

  async function tryRestoreSession() {
    if (!state.token) return render();

    root.innerHTML = `
      <div style="display:grid;place-items:center;min-height:100vh;font:14px -apple-system,'Segoe UI',sans-serif;color:#5f6d5c">
        Loading…
      </div>`;

    try {
      const d = await Promise.race([
        api('/auth/me', { __silent401: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Session check timed out')), 5000)),
      ]);
      state.user = d.user; state.roles = d.roles; state.permissions = d.permissions;
    } catch {
      state.token = null; lsDel('kabonix_token');
    }
    render();
  }

  async function login(email, password) {
    const d = await api('/auth/login',{method:'POST',body:{email,password}});
    if (d.mfaRequired) return d;
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

  function nav(route, param) { state.route=route; state.routeParam=param||null; render(); }
  window.nav = nav;

  function render() {
    const seq = ++renderSeq;
    if (!state.token || !state.user) return renderLogin();
    const views = {
      dashboard: renderDashboard,
      users:     renderUsers,
      roles:     renderRoles,
      config:    renderConfig,
      audit:     renderAudit,
      forms:     renderForms,
      messages:  renderMessages,
      profile:   renderProfile,
      ...extraViews,
    };
    (views[state.route]||renderDashboard)(seq);
  }

  function renderLogin() {
    const mfaChallenge = state.mfaChallenge;
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
        <div class="field"><label>Email</label><input id="l-email" type="email" ${DEMO_MODE?'value="admin@kabonix.org"':''}></div>
        <div class="field"><label>Password</label><input id="l-pw" type="password" ${DEMO_MODE?'value="ChangeMe123!"':''}></div>
        <button class="btn-primary" id="login-btn">Sign in</button>
        <p class="hint"><a href="#" id="forgot-link">Forgot your password?</a></p>
        <p class="hint">New to the platform? <a href="#" id="register-link">Create an account</a></p>
        ${DEMO_MODE ? `<p class="hint">Seeded accounts: <strong>admin@kabonix.org</strong> (Super Admin) · <strong>amina@kabonix.org</strong> (Field Officer) — password: <strong>ChangeMe123!</strong></p>` : ''}
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
      document.getElementById('back-link').onclick = e => {
        e.preventDefault(); state.mfaChallenge = null; render();
      };
    } else {
      document.getElementById('login-btn').onclick = doLogin;
      document.getElementById('l-pw').onkeydown = e => { if(e.key==='Enter') doLogin(); };
      document.getElementById('forgot-link').onclick = e => { e.preventDefault(); renderForgotPassword(); };
      document.getElementById('register-link').onclick = e => { e.preventDefault(); renderRegister(); };
    }
  }

  async function doLogin() {
    const email = document.getElementById('l-email').value.trim();
    const pw    = document.getElementById('l-pw').value;
    const err   = document.getElementById('l-err');
    err.textContent = '';
    try {
      const d = await login(email, pw);
      if (d?.mfaRequired) { state.mfaChallenge = d.challengeToken; renderLogin(); }
    } catch(e) { err.textContent = e.message; }
  }

  function renderRegister() {
    root.innerHTML = `
<div class="login-screen">
  <div class="login-visual">
    <div class="mark">KABONIX FOUNDATION</div>
    <h1>Join the platform</h1>
    <p>Register as a staff member or field officer. An administrator will review your request before your account is activated.</p>
    <div class="login-pills">
      <span>🌊 Blue Economy</span><span>🌱 Carbon</span><span>⚡ Renewable Energy</span><span>👩‍💼 Youth & Women</span>
    </div>
  </div>
  <div class="login-form-side">
    <div class="login-card">
      <h2>Create an account</h2>
      <p class="sub">You'll be able to sign in once an administrator approves your request.</p>
      <div class="field"><label>Full name</label><input id="reg-name" type="text" autocomplete="name" placeholder="Jane Doe"></div>
      <div class="field"><label>Email</label><input id="reg-email" type="email" autocomplete="email" placeholder="jane@example.org"></div>
      <div class="field"><label>Password</label><input id="reg-pw" type="password" autocomplete="new-password"></div>
      <div class="field"><label>Confirm password</label><input id="reg-pw2" type="password" autocomplete="new-password"></div>
      <button class="btn-primary" id="reg-submit">Create account</button>
      <p class="hint"><a href="#" id="reg-back">← Back to sign in</a></p>
      <div id="reg-msg" class="err-msg"></div>
    </div>
  </div>
</div>`;

    document.getElementById('reg-back').onclick = e => { e.preventDefault(); render(); };

    const submit = async () => {
      const name = document.getElementById('reg-name').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const pw1 = document.getElementById('reg-pw').value;
      const pw2 = document.getElementById('reg-pw2').value;
      const msg = document.getElementById('reg-msg');
      msg.textContent = '';
      msg.style.color = '';

      if (!name) return msg.textContent = 'Please enter your full name.';
      if (!email) return msg.textContent = 'Please enter your email address.';
      if (pw1.length < 8) return msg.textContent = 'Password must be at least 8 characters.';
      if (pw1 !== pw2) return msg.textContent = 'Passwords do not match.';

      try {
        const r = await api('/auth/register', { method: 'POST', body: { name, email, password: pw1 } });
        msg.style.color = 'var(--ok)';
        msg.textContent = r.message || 'Registration submitted. An administrator will review your request.';
        document.getElementById('reg-submit').disabled = true;
      } catch (e) {
        msg.textContent = e.message;
      }
    };

    document.getElementById('reg-submit').onclick = submit;
    document.getElementById('reg-pw2').onkeydown = e => { if (e.key === 'Enter') submit(); };
  }

  function renderForgotPassword() {
    root.innerHTML = `
<div class="login-screen">
  <div class="login-form-side">
    <div class="login-card">
      <h2>Reset your password</h2>
      <p class="sub">Enter your email address and we'll send a reset link.</p>
      <div class="field"><label>Email</label><input id="fp-email" type="email" placeholder="you@kabonix.org"></div>
      <button class="btn-primary" id="fp-submit">Send reset link</button>
      <p class="hint"><a href="#" id="fp-back">← Back to sign in</a></p>
      <div id="fp-msg" class="err-msg"></div>
    </div>
  </div>
</div>`;
    document.getElementById('fp-back').onclick = e => { e.preventDefault(); render(); };
    document.getElementById('fp-submit').onclick = async () => {
      const email = document.getElementById('fp-email').value.trim();
      const msg   = document.getElementById('fp-msg');
      msg.textContent = '';
      if (!email) return msg.textContent = 'Please enter your email address.';
      try {
        const r = await api('/auth/password/forgot', { method: 'POST', body: { email } });
        msg.innerHTML = `<span style="color:var(--ok)">${esc(r.message || 'If that email exists, a reset link has been sent.')}</span>`;
      } catch (e) { msg.textContent = e.message; }
    };
    document.getElementById('fp-email').onkeydown = e => {
      if (e.key === 'Enter') document.getElementById('fp-submit').click();
    };
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelector('.app-shell')?.classList.remove('sidebar-open');
  });
  window.addEventListener('resize', () => {
    if (window.innerWidth > 800) document.querySelector('.app-shell')?.classList.remove('sidebar-open');
  });
  document.addEventListener('click', e => {
    const sh = document.querySelector('.app-shell');
    if (!sh || !sh.classList.contains('sidebar-open')) return;
    if (e.target.closest('.sidebar') || e.target.closest('#sb-toggle')) return;
    sh.classList.remove('sidebar-open');
  });

  function shell(contentHtml, activeRoute) {
    const items = [
      { key:'dashboard', icon:'◉', label:'Dashboard' },
      can('data_collection','view') && { key:'forms', icon:'📋', label:'M&E Collection' },
      can('admin','view') && { key:'users', icon:'👥', label:'Staff & Users' },
      can('admin','view') && { key:'roles', icon:'🔐', label:'Roles & Permissions' },
      can('admin','view') && { key:'config', icon:'⚙️', label:'System Config' },
      can('admin','view') && { key:'messages', icon:'✉️', label:'Contact Messages' },
      (can('admin','view')||can('data_collection','approve')) && { key:'audit', icon:'📜', label:'Audit Log' },
      ...extraNavItems
        .filter(i => i.canAccess())
        .map(i => ({ key: i.key, icon: i.icon, label: i.label })),
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
    if (sbToggle && appShell) {
      sbToggle.onclick = () => appShell.classList.toggle('sidebar-open');
    }
  }

  function pageHead(title, sub='') {
    return `<div class="page-head"><h1>${esc(title)}</h1>${sub?`<p>${esc(sub)}</p>`:''}</div>`;
  }

  function card(content, cls='') { return `<div class="card ${cls}">${content}</div>`; }

  async function renderDashboard(seq) {
    shell(`${pageHead('Dashboard','Loading…')}`, 'dashboard');
    let stats = {};
    try { stats = await api('/admin/stats'); } catch {}
    if (isStale(seq)) return;

    const me = state.user;
    const roleNames = state.roles.map(r=>r.name).join(', ')||'No roles assigned';

    shell(`
      ${pageHead('Dashboard', `Welcome back, ${me.name.split(' ')[0]}. ${new Date().toLocaleDateString(window.KabonixI18n?.locale?.() || 'en-GB',{weekday:'long',day:'numeric',month:'long'})}.`)}
      <div class="stat-row">
        ${statCard('Active staff',     stats.activeUsers       ?? '—', '👥')}
        ${statCard('Submissions',      stats.submissions        ?? '—', '📋')}
        ${statCard('Audit events (24h)',stats.auditEventsToday ?? '—', '📜')}
        ${statCard('New enquiries',    stats.newContactMessages ?? '—', '✉️')}
      </div>
      ${stats.pendingApprovals ? `
      <div class="card card-inner" style="border-color:var(--sand);background:var(--sand-tint);margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div>
            <strong style="color:#7a5610">⏳ ${stats.pendingApprovals} registration${stats.pendingApprovals>1?'s':''} awaiting approval</strong>
            <p class="meta" style="margin-top:4px">New staff have registered and are waiting for you to review them.</p>
          </div>
          ${can('admin','view') ? `<button class="btn-primary" onclick="nav('users')">Review on Staff &amp; Users</button>` : ''}
        </div>
      </div>` : ''}
      <div class="two-col">
        ${card(`<h3>Your access</h3>
          <p class="meta">${esc(roleNames)}</p>
          <table class="mini-table"><tbody>
            ${Object.entries(groupPerms(state.permissions)).map(([m,ls])=>`<tr><td>${esc(m)}</td><td>${ls.map(l=>`<span class="badge">${esc(l)}</span>`).join('')}</td></tr>`).join('')}
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

  function userStatusCell(u) {
    if (u.approval_status === 'pending')  return '<span class="badge badge-new">Pending approval</span>';
    if (u.approval_status === 'rejected') return '<span class="badge" style="background:#f3f5f1;color:#7a5610">Rejected</span>';
    return `<span class="status-dot ${u.is_active?'active':'inactive'}"></span>${u.is_active?'Active':'Inactive'}`;
  }

  async function renderUsers(seq) {
    if (!can('admin','view')) {
      shell(pageHead('Staff & Users'), 'users');
      return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());
    }
    shell(pageHead('Staff & Users','Loading…'), 'users');

    let users=[], roles=[];
    try {
      const [usersRes, rolesRes] = await Promise.all([api('/admin/users'), api('/admin/roles')]);
      users = asArray(usersRes, 'users');
      roles = asArray(rolesRes, 'roles');
    } catch(e) {
      if (isStale(seq)) return;
      return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message));
    }
    if (isStale(seq)) return;

    const pending = users.filter(u => u.approval_status === 'pending');

    document.getElementById('main').innerHTML = `
      ${pageHead('Staff & Users', `${users.length} accounts · ${users.filter(u=>u.is_active).length} active · ${pending.length} awaiting approval`)}
      ${pending.length ? `
      <div class="card card-inner" style="margin-bottom:18px;border-color:var(--sand);background:var(--sand-tint)">
        <h3 style="color:#7a5610">⏳ ${pending.length} registration${pending.length>1?'s':''} awaiting approval</h3>
        <p class="meta" style="margin-bottom:14px">These people registered themselves. Assign a role and approve, or reject the request.</p>
        <table class="mini-table">
          <thead><tr><th>Name</th><th>Email</th><th>Registered</th><th>Assign role</th><th></th></tr></thead>
          <tbody>
            ${pending.map(u => `<tr data-pending-uid="${u.id}">
              <td><strong>${esc(u.name)}</strong></td>
              <td class="meta">${esc(u.email)}</td>
              <td class="meta">${ago(u.created_at)}</td>
              <td>
                <select class="inline-select" id="approve-role-${u.id}">
                  <option value="">No role yet</option>
                  ${roles.map(r=>`<option value="${esc(r.key)}">${esc(r.name)}</option>`).join('')}
                </select>
              </td>
              <td class="action-cell">
                ${can('admin','approve') ? `
                  <button class="btn-sm btn-ok" data-approve-user="${u.id}">Approve</button>
                  <button class="btn-sm btn-danger" data-reject-user="${u.id}">Reject</button>
                ` : '<span class="meta">Requires admin:approve</span>'}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}
      ${can('admin','create') ? `
      <div class="card card-inner" style="margin-bottom:18px">
        <h3>Invite new staff member</h3>
        <p class="meta" style="margin-bottom:14px">Admin-invited users skip approval — they can sign in immediately with the temporary password.</p>
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
              const isPending = u.approval_status === 'pending';
              const isRejected = u.approval_status === 'rejected';
              return `<tr data-uid="${u.id}">
              <td><strong>${esc(u.name)}</strong></td>
              <td class="meta">${esc(u.email)}</td>
              <td>${userRoles.map(r=>`<span class="badge badge-role">${esc(r.name)}</span>`).join(' ')||'<span class="meta">none</span>'}</td>
              <td>${userStatusCell(u)}</td>
              <td>${u.mfa_enabled?'✅ On':'⬜ Off'}</td>
              <td class="meta">${ago(u.last_active)}</td>
              <td class="action-cell">
                ${isPending || isRejected ? '' : `
                  ${can('admin','edit') ? `
                  <select class="inline-select" data-uid="${u.id}" id="role-sel-${u.id}">
                    ${roles.map(r=>`<option value="${esc(r.key)}" ${userRoles.some(ur=>ur.key===r.key)?'selected':''}>${esc(r.name)}</option>`).join('')}
                  </select>
                  <button class="btn-sm" data-assign="${u.id}">Assign</button>
                  ${u.is_active && u.id!==state.user.id ?
