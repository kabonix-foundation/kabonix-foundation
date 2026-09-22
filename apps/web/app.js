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
    prefillEmail: null,       // set after successful registration, cleared after prefill
    regSuccess: null,         // { email, message } shown on the login screen
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
        lsDel('kabonix_token'); render();
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
  window.__kabonix = {
    get state()     { return state; },
    get renderSeq() { return renderSeq; },
    isStale, can, esc, toast, api, shell, pageHead, card, nav,
    registerView(key, fn) { extraViews[key] = fn; },
    registerNav(item)     { extraNavItems.push(item); },
  };

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
        const r = await api('/auth/email/verify', { method: 'POST', body: { token: verifyToken } });
        msg.innerHTML = '<span style="color:var(--ok)">✅ ' + esc(r.message || 'Email verified.') + ' Redirecting to sign in…</span>';
        setTimeout(() => render(), 1800);
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
      dashboard: renderDashboard, users: renderUsers, roles: renderRoles,
      config: renderConfig, audit: renderAudit, forms: renderForms,
      messages: renderMessages, profile: renderProfile,
      ...extraViews,
    };
    (views[state.route]||renderDashboard)(seq);
  }

  function renderLogin() {
    const mfaChallenge = state.mfaChallenge;
    const regSuccess   = state.regSuccess;
    const prefillEmail = state.prefillEmail || (DEMO_MODE ? 'admin@kabonix.org' : '');
    const prefillPw    = DEMO_MODE && !state.prefillEmail ? 'ChangeMe123!' : '';

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
        ${regSuccess ? `
          <div class="card card-inner" style="background:var(--leaf-tint);border-color:var(--leaf);margin-bottom:20px;padding:16px 18px">
            <strong style="color:var(--ok);font-family:-apple-system,'Segoe UI',sans-serif;font-size:13px">✅ Account created</strong>
            <p class="meta" style="margin-top:6px;color:var(--ink-soft);font-size:13px;line-height:1.5">${esc(regSuccess.message)}</p>
          </div>` : ''}
        <h2>Sign in</h2>
        <p class="sub">Foundation staff and field officers only.</p>
        <div class="field"><label>Email</label><input id="l-email" type="email" value="${esc(prefillEmail)}"></div>
        <div class="field"><label>Password</label><input id="l-pw" type="password" value="${esc(prefillPw)}"></div>
        <button class="btn-primary" id="login-btn">Sign in</button>
        <p class="hint"><a href="#" id="forgot-link">Forgot your password?</a></p>
        <p class="hint">New to the platform? <a href="#" id="register-link">Create an account</a></p>
        ${DEMO_MODE ? `<p class="hint">Seeded accounts: <strong>admin@kabonix.org</strong> (Super Admin) · <strong>amina@kabonix.org</strong> (Field Officer) — password: <strong>ChangeMe123!</strong></p>` : ''}
      `}
      <div id="l-err" class="err-msg"></div>
      ${state.emailNeedsVerification ? `
        <p class="hint" style="margin-top:14px">
          Didn't get the email?
          <a href="#" id="resend-verify-link">Resend verification link</a>
        </p>` : ''}
    </div>
  </div>
</div>`;

    // Clear one-shot state
    state.prefillEmail = null;
    state.regSuccess   = null;

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
      if (document.getElementById('resend-verify-link')) {
        document.getElementById('resend-verify-link').onclick = async e => {
          e.preventDefault();
          const email = document.getElementById('l-email').value.trim();
          if (!email) return toast('Enter your email address first.', true);
          try {
            const r = await api('/auth/email/resend', { method: 'POST', body: { email } });
            toast(r.message || 'If unverified, a new link has been sent.');
          } catch (err) { toast(err.message, true); }
        };
      }
    }
  }

  async function doLogin() {
    const email = document.getElementById('l-email').value.trim();
    const pw    = document.getElementById('l-pw').value;
    const err   = document.getElementById('l-err');
    err.textContent = '';
    state.emailNeedsVerification = false;
    try {
      const d = await login(email, pw);
      if (d?.mfaRequired) { state.mfaChallenge = d.challengeToken; renderLogin(); }
    } catch(e) {
      err.textContent = e.message;
      if (e.body?.code === 'email_not_verified') {
        state.emailNeedsVerification = true;
        renderLogin();
        document.getElementById('l-err').textContent = e.message;
      }
    }
  }

  function renderRegister() {
    root.innerHTML = `
<div class="login-screen">
  <div class="login-visual">
    <div class="mark">KABONIX FOUNDATION</div>
    <h1>Join the platform</h1>
    <p>Register as a staff member or field officer. After verifying your email, an administrator will review your request.</p>
    <div class="login-pills">
      <span>🌊 Blue Economy</span><span>🌱 Carbon</span><span>⚡ Renewable Energy</span><span>👩‍💼 Youth & Women</span>
    </div>
  </div>
  <div class="login-form-side">
    <div class="login-card">
      <h2>Create an account</h2>
      <p class="sub">You'll receive a verification email. Sign-in is enabled once your email is verified <em>and</em> an administrator approves your account.</p>
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
      const name  = document.getElementById('reg-name').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const pw1   = document.getElementById('reg-pw').value;
      const pw2   = document.getElementById('reg-pw2').value;
      const msg   = document.getElementById('reg-msg');
      msg.textContent = ''; msg.style.color = '';

      if (!name)          return msg.textContent = 'Please enter your full name.';
      if (!email)         return msg.textContent = 'Please enter your email address.';
      if (pw1.length < 8) return msg.textContent = 'Password must be at least 8 characters.';
      if (pw1 !== pw2)    return msg.textContent = 'Passwords do not match.';

      try {
        const r = await api('/auth/register', { method: 'POST', body: { name, email, password: pw1 } });
        // Redirect to login with a success banner + prefilled email.
        state.regSuccess   = { email, message: r.message || 'Check your inbox for a verification link, then wait for administrator approval.' };
        state.prefillEmail = email;
        state.emailNeedsVerification = false;
        renderLogin();
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

  // ── Shell, dashboard, users, roles, config, audit, forms, messages, profile ──
  // (continued in Part B — paste directly below this line)

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

  function shell(contentHtml) {
    const items = [
      { key:'dashboard', icon:'◉', label:'Dashboard' },
      can('data_collection','view') && { key:'forms', icon:'📋', label:'M&E Collection' },
      can('admin','view') && { key:'users', icon:'👥', label:'Staff & Users' },
      can('admin','view') && { key:'roles', icon:'🔐', label:'Roles & Permissions' },
      can('admin','view') && { key:'config', icon:'⚙️', label:'System Config' },
      can('admin','view') && { key:'messages', icon:'✉️', label:'Contact Messages' },
      (can('admin','view')||can('data_collection','approve')) && { key:'audit', icon:'📜', label:'Audit Log' },
      ...extraNavItems.filter(i => i.canAccess()).map(i => ({ key: i.key, icon: i.icon, label: i.label })),
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
    if (sbToggle && appShell) sbToggle.onclick = () => appShell.classList.toggle('sidebar-open');
  }

  function pageHead(title, sub='') { return `<div class="page-head"><h1>${esc(title)}</h1>${sub?`<p>${esc(sub)}</p>`:''}</div>`; }
  function card(content, cls='')  { return `<div class="card ${cls}">${content}</div>`; }

  async function renderDashboard(seq) {
    shell(`${pageHead('Dashboard','Loading…')}`);
    let stats = {};
    try { stats = await api('/admin/stats'); } catch {}
    if (isStale(seq)) return;

    const me = state.user;
    const roleNames = state.roles.map(r=>r.name).join(', ')||'No roles assigned';

    shell(`
      ${pageHead('Dashboard', `Welcome back, ${me.name.split(' ')[0]}. ${new Date().toLocaleDateString(window.KabonixI18n?.locale?.() || 'en-GB',{weekday:'long',day:'numeric',month:'long'})}.`)}
      <div class="stat-row">
        ${statCard('Active staff',      stats.activeUsers        ?? '—', '👥')}
        ${statCard('Submissions',       stats.submissions        ?? '—', '📋')}
        ${statCard('Audit events (24h)',stats.auditEventsToday   ?? '—', '📜')}
        ${statCard('New enquiries',     stats.newContactMessages ?? '—', '✉️')}
      </div>
      ${stats.pendingApprovals ? `
      <div class="card card-inner" style="border-color:var(--sand);background:var(--sand-tint);margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div>
            <strong style="color:#7a5610">⏳ ${stats.pendingApprovals} registration${stats.pendingApprovals>1?'s':''} awaiting approval</strong>
            <p class="meta" style="margin-top:4px">New staff have registered and are waiting for review.</p>
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
            <button class="qa-btn" onclick="nav('profile')">👤 Manage my profile</button>
          </div>`, 'card-inner')}
      </div>
      <div style="margin-top:8px" class="meta">Platform: Postgres + PostGIS · Migrations applied: ${stats.migrationsApplied ?? '—'} · <a href="${WEBSITE_URL}" target="_blank">Public website ↗</a></div>
    `);
  }

  function statCard(label, value, icon) {
    return `<div class="stat-card"><div class="stat-icon">${icon}</div><div class="stat-value">${esc(String(value))}</div><div class="stat-label">${esc(label)}</div></div>`;
  }

  function groupPerms(perms) { const out={}; for(const p of perms) (out[p.module]??=[]).push(p.level); return out; }

  function userStatusCell(u) {
    if (u.approval_status === 'pending')  return '<span class="badge badge-new">Pending approval</span>';
    if (u.approval_status === 'rejected') return '<span class="badge" style="background:#f3f5f1;color:#7a5610">Rejected</span>';
    if (!u.email_verified_at)             return '<span class="badge" style="background:#fdf3e3;color:#7a5610">Unverified</span>';
    return `<span class="status-dot ${u.is_active?'active':'inactive'}"></span>${u.is_active?'Active':'Inactive'}`;
  }

  async function renderUsers(seq) {
    if (!can('admin','view')) {
      shell(pageHead('Staff & Users'));
      return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());
    }
    shell(pageHead('Staff & Users','Loading…'));

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
        <p class="meta" style="margin-bottom:14px">Assign a role and approve, or reject the request.</p>
        <table class="mini-table">
          <thead><tr><th>Name</th><th>Email</th><th>Verified</th><th>Registered</th><th>Assign role</th><th></th></tr></thead>
          <tbody>
            ${pending.map(u => `<tr data-pending-uid="${u.id}">
              <td><strong>${esc(u.name)}</strong></td>
              <td class="meta">${esc(u.email)}</td>
              <td>${u.email_verified_at ? '✅' : '<span class="meta">⏳ not yet</span>'}</td>
              <td class="meta">${ago(u.created_at)}</td>
              <td><select class="inline-select" id="approve-role-${u.id}">
                <option value="">No role yet</option>
                ${roles.map(r=>`<option value="${esc(r.key)}">${esc(r.name)}</option>`).join('')}
              </select></td>
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
        <p class="meta" style="margin-bottom:14px">Admin-invited users skip approval. They still need to verify their email.</p>
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
          <tbody>
            ${users.map(u => {
              const userRoles = u.roles || [];
              const isPending  = u.approval_status === 'pending';
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
                  <select class="inline-select" id="role-sel-${u.id}">
                    ${roles.map(r=>`<option value="${esc(r.key)}" ${userRoles.some(ur=>ur.key===r.key)?'selected':''}>${esc(r.name)}</option>`).join('')}
                  </select>
                  <button class="btn-sm" data-assign="${u.id}">Assign</button>
                  ${u.is_active && u.id!==state.user.id ? `<button class="btn-sm btn-danger" data-deactivate="${u.id}">Deactivate</button>` : ''}
                  ${!u.is_active ? `<button class="btn-sm btn-ok" data-reactivate="${u.id}">Reactivate</button>` : ''}
                  ${can('admin','approve') && u.id!==state.user.id ? `<button class="btn-sm btn-danger" data-delete-user="${u.id}">Delete</button>` : ''}
                  ` : ''}
                `}
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
          toast('Invitation sent.');
          renderUsers(++renderSeq);
        } catch(e) { toast(e.message, true); }
      };
    }

    document.querySelectorAll('[data-approve-user]').forEach(btn => btn.onclick = async () => {
      const uid = Number(btn.dataset.approveUser);
      const roleKey = document.getElementById(`approve-role-${uid}`).value;
      if (!confirm(`Approve this registration${roleKey ? ` and assign the ${roleKey} role` : ''}?`)) return;
      try {
        await api(`/admin/users/${uid}/approve`,{method:'POST',body:{roleKeys: roleKey ? [roleKey] : []}});
        toast('Registration approved.'); renderUsers(++renderSeq);
      } catch(e) { toast(e.message, true); }
    });

    document.querySelectorAll('[data-reject-user]').forEach(btn => btn.onclick = async () => {
      if (!confirm('Reject this registration? The user will not be able to sign in.')) return;
      try {
        await api(`/admin/users/${btn.dataset.rejectUser}/reject`,{method:'POST',body:{}});
        toast('Registration rejected.'); renderUsers(++renderSeq);
      } catch(e) { toast(e.message, true); }
    });

    document.querySelectorAll('[data-assign]').forEach(btn => btn.onclick = async () => {
      const uid = Number(btn.dataset.assign);
      const roleKey = document.getElementById(`role-sel-${uid}`).value;
      try { await api(`/admin/users/${uid}/roles`,{method:'PUT',body:{roleKeys:[roleKey]}}); toast('Role updated.'); renderUsers(++renderSeq); }
      catch(e) { toast(e.message, true); }
    });
    document.querySelectorAll('[data-deactivate]').forEach(btn => btn.onclick = async () => {
      if (!confirm('Deactivate this user?')) return;
      try { await api(`/admin/users/${btn.dataset.deactivate}/deactivate`,{method:'POST',body:{}}); toast('User deactivated.'); renderUsers(++renderSeq); }
      catch(e) { toast(e.message, true); }
    });
    document.querySelectorAll('[data-reactivate]').forEach(btn => btn.onclick = async () => {
      try { await api(`/admin/users/${btn.dataset.reactivate}/reactivate`,{method:'POST',body:{}}); toast('User reactivated.'); renderUsers(++renderSeq); }
      catch(e) { toast(e.message, true); }
    });
    document.querySelectorAll('[data-delete-user]').forEach(btn => btn.onclick = async () => {
      const uid = Number(btn.dataset.deleteUser);
      const row = document.querySelector(`tr[data-uid="${uid}"]`);
      const name = row?.querySelector('strong')?.textContent || `user #${uid}`;
      if (!confirm(`Permanently delete ${name}? This cannot be undone.`)) return;
      try {
        await api(`/admin/users/${uid}`, { method: 'DELETE' });
        toast('User deleted.'); renderUsers(++renderSeq);
      } catch(e) { toast(e.message, true); }
    });
  }

  async function renderRoles(seq) {
    if (!can('admin','view')) {
      shell(pageHead('Roles & Permissions'));
      return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());
    }
    shell(pageHead('Roles & Permissions', 'Loading…'));

    let data = { roles:[], modules:[], levels:[] };
    try { data = await api('/admin/roles'); }
    catch(e) {
      if (isStale(seq)) return;
      return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message));
    }
    if (isStale(seq)) return;

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
                  <input type="checkbox" data-role="${role.id}" data-mod="${esc(mod)}" data-lev="${esc(lev)}"
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
          toast('Role created.'); renderRoles(++renderSeq);
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

  async function renderConfig(seq) {
    if (!can('admin','view')) {
      shell(pageHead('System Configuration'));
      return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());
    }
    shell(pageHead('System Configuration', 'Loading…'));

    let cfg=[], prefs={};
    try {
      cfg = asArray(await api('/admin/config'), 'config');
      prefs = await api('/admin/notifications/preferences').catch(()=>({}));
    } catch(e) {
      if (isStale(seq)) return;
      return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message));
    }
    if (isStale(seq)) return;

    document.getElementById('main').innerHTML = `
      ${pageHead('System Configuration', 'Platform-wide settings managed by Foundation admin.')}
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
              ['email','✉️','Email notifications'],
              ['sms','📱','SMS notifications'],
              ['whatsapp','💬','WhatsApp notifications'],
              ['in_app','🔔','In-app notifications'],
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
            <div style="margin-top:16px"><button class="btn-primary" id="save-prefs-btn">Save preferences</button></div>
          </div>
          <div class="card card-inner" style="margin-top:16px">
            <h3>Migration status</h3>
            <p class="meta">Applied SQL migrations tracked in <code>schema_migrations</code>.</p>
            <div id="migration-list" style="margin-top:10px">Loading…</div>
          </div>
        </div>
      </div>`;

    renderMigrationStatus();

    if (can('admin','edit')) {
      document.querySelectorAll('[data-cfg]').forEach(btn => btn.onclick = async () => {
        const key = btn.dataset.cfg;
        const row = document.querySelector(`.cfg-row[data-key="${key}"]`);
        const ctrl = row.querySelector('.cfg-value');
        const value = ctrl.type === 'checkbox' ? String(ctrl.checked) : ctrl.value;
        if (ctrl.type === 'number' && (value === '' || Number.isNaN(Number(value)))) {
          return toast(`${key} must be a number.`, true);
        }
        try { await api(`/admin/config/${key}`,{method:'PATCH',body:{value}}); toast(`${key} saved.`); }
        catch(e) { toast(e.message, true); }
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

  async function renderMigrationStatus() {
    const el = document.getElementById('migration-list');
    if (!el) return;
    try {
      const stats = await api('/admin/stats');
      if (!document.body.contains(el)) return;
      el.innerHTML = `<span class="badge badge-ok">✓ ${esc(String(stats.migrationsApplied))} migrations applied</span>`;
    } catch { el.textContent = 'Could not load.'; }
  }

  function cfgControl(c) {
    if (c.type === 'boolean') return `<label class="toggle-wrap"><input type="checkbox" class="cfg-value" ${c.value==='true'?'checked':''}><span class="toggle-slider"></span></label>`;
    if (c.type === 'select')  return `<select class="cfg-value">${(c.options||'').split(',').map(o=>`<option value="${esc(o.trim())}" ${c.value===o.trim()?'selected':''}>${esc(o.trim())}</option>`).join('')}</select>`;
    if (c.type === 'number')  return `<input type="number" class="cfg-value" value="${esc(c.value)}">`;
    return `<input type="text" class="cfg-value" value="${esc(c.value)}">`;
  }

  async function renderAudit(seq) {
    if (!can('admin','view') && !can('data_collection','approve')) {
      shell(pageHead('Audit Log'));
      return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());
    }
    shell(pageHead('Audit Log','Loading…'));

    const filters = { action:'', entity:'', from:'', to:'' };
    let data = { rows:[], total:0 };

    function renderTable() {
      const tbody = document.getElementById('audit-tbody');
      if (!tbody) return;
      if (!data.rows.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="meta" style="text-align:center;padding:24px">No records match the current filters.</td></tr>`;
        document.getElementById('audit-count').textContent = `0 of ${data.total} events`;
        return;
      }
      tbody.innerHTML = data.rows.map(r=>`<tr>
        <td class="meta">${esc(new Date(r.created_at).toLocaleString(window.KabonixI18n?.locale?.() || 'en-GB'))}</td>
        <td>${esc(r.user_email||'—')}</td>
        <td><span class="badge badge-action">${esc(r.action)}</span></td>
        <td>${esc(r.entity)}${r.entity_id?` <span class="meta">#${esc(String(r.entity_id))}</span>`:''}</td>
        <td class="meta">${esc(r.detail||'—')}</td>
      </tr>`).join('');
      document.getElementById('audit-count').textContent = `${data.rows.length} of ${data.total} events`;
    }

    async function load() {
      const qs = new URLSearchParams({ limit:200, ...Object.fromEntries(Object.entries(filters).filter(([,v])=>v)) });
      const mySeq = renderSeq;
      const result = await api(`/admin/audit?${qs}`).catch(()=>({ rows:[], total:0 }));
      if (mySeq !== renderSeq) return;
      data = result;
      renderTable();
    }

    document.getElementById('main').innerHTML = `
      ${pageHead('Audit Log', 'Every create, edit, delete, login and permission-denied event is recorded here.')}
      <div class="card card-inner" style="margin-bottom:16px">
        <div class="form-row">
          <div class="field"><label>Action</label>
            <select id="f-action">
              <option value="">All actions</option>
              ${['login','login_failed','login_blocked','logout','create','edit','delete','approve','register','email_verified','email_changed','email_change_requested','password_reset_requested','password_reset_completed','password_change_failed','permission_denied','mfa_enabled','mfa_disabled','token_reuse_detected']
                .map(a=>`<option value="${a}">${a}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Entity type</label><input id="f-entity" placeholder="e.g. user, me_submission"></div>
          <div class="field"><label>From</label><input type="date" id="f-from"></div>
          <div class="field"><label>To</label><input type="date" id="f-to"></div>
          <div class="field" style="align-self:flex-end"><button class="btn-primary" id="filter-btn">Apply filters</button></div>
        </div>
      </div>
      <div class="card card-table">
        <div style="display:flex;justify-content:space-between;margin-bottom:10px;padding:22px 24px 0">
          <span class="meta" id="audit-count">Loading…</span>
          <button class="btn-sm" id="refresh-btn">↻ Refresh</button>
        </div>
        <table>
          <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
          <tbody id="audit-tbody"><tr><td colspan="5" class="meta" style="text-align:center;padding:24px">Loading…</td></tr></tbody>
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

  async function renderForms(seq) {
    shell(pageHead('M&E Data Collection','Loading…'));

    let forms=[], submissions=[];
    try {
      forms       = asArray(await api('/forms'), 'forms');
      submissions = asArray(await api('/submissions'), 'submissions');
    } catch(e) {
      if (isStale(seq)) return;
      return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message));
    }
    if (isStale(seq)) return;

    const form = forms[0];
    const canCreate = can('data_collection','create');

    document.getElementById('main').innerHTML = `
      ${pageHead('M&E Data Collection', form ? form.description : 'No forms available.')}
      ${form && canCreate ? `
      <div class="card card-inner" style="margin-bottom:18px">
        <h3>${esc(form.title)}</h3>
        <form id="me-form" novalidate>
          <div class="form-grid">${(form.schema||[]).map(fieldHtml).join('')}</div>
          <button class="btn-primary" type="submit">Submit survey</button>
        </form>
      </div>` : form ? `<div class="card card-inner" style="margin-bottom:18px"><p class="meta">Your role can view submissions but not create new ones.</p></div>` : ''}
      <div class="card card-table">
        <h3 style="padding:22px 24px 0">Recent submissions (${submissions.length})</h3>
        ${!submissions.length ? `<p class="meta" style="padding:12px 24px 22px">No submissions yet.</p>` : `
        <table>
          <thead><tr><th>Beneficiary</th><th>Village</th><th>Programme</th><th>Location</th><th>Submitted by</th><th>When</th><th></th></tr></thead>
          <tbody>${submissions.map(s=>`<tr>
            <td>${esc(s.answers?.beneficiary_name||'—')}</td>
            <td>${esc(s.answers?.village||'—')}</td>
            <td>${esc(s.answers?.programme_area||'—')}</td>
            <td class="meta">${(s.answers?.gps_lat != null && s.answers?.gps_lng != null)
                                ? `${Number(s.answers.gps_lat).toFixed(4)}, ${Number(s.answers.gps_lng).toFixed(4)}` : '—'}</td>
            <td class="meta">${esc(s.submitted_by_email)}</td>
            <td class="meta">${ago(s.submitted_at)}</td>
            <td class="action-cell">
              <button class="btn-sm" data-history-sub="${s.id}">History</button>
              ${can('data_collection','approve') ? `<button class="btn-sm btn-danger" data-delete-sub="${s.id}">Delete</button>` : ''}
            </td>
          </tr>`).join('')}</tbody>
        </table>`}
      </div>`;

    if (typeof window.__mapPickerScan === 'function') {
      requestAnimationFrame(() => window.__mapPickerScan());
    }

    if (form && canCreate) {
      document.getElementById('me-form').onsubmit = async e => {
        e.preventDefault();
        const answers = {};
        for (const f of form.schema||[]) {
          if (f.type === 'map') {
            const picker = window.__meMapPickers?.get?.(f.id);
            const val = picker?.getValue?.();
            if (val) { answers.gps_lat = val.lat; answers.gps_lng = val.lng; }
            continue;
          }
          const el = document.getElementById('f_'+f.id);
          if (!el) continue;
          answers[f.id] = f.type === 'number'
            ? (el.value === '' ? undefined : Number(el.value))
            : el.value;
        }

        for (const f of form.schema||[]) {
          if (f.type === 'map') {
            if (f.required && (answers.gps_lat == null || answers.gps_lng == null)) {
              return toast(`${f.label} is required — tap the map to place a pin.`, true);
            }
            continue;
          }
          const v = answers[f.id];
          const empty = v === undefined || v === null || v === '';
          if (f.required && empty) return toast(`${f.label} is required.`, true);
          if (empty) continue;
          if (f.type === 'number') {
            if (f.integer && !Number.isInteger(v)) return toast(`${f.label} must be a whole number.`, true);
            if (f.min != null && v < f.min)        return toast(`${f.label} must be at least ${f.min}.`, true);
            if (f.max != null && v > f.max)        return toast(`${f.label} must be at most ${f.max}.`, true);
          } else {
            if (f.minLength != null && String(v).length < f.minLength)
              return toast(`${f.label} must be at least ${f.minLength} characters.`, true);
            if (f.maxLength != null && String(v).length > f.maxLength)
              return toast(`${f.label} must be at most ${f.maxLength} characters.`, true);
          }
        }

        try {
          await api('/submissions',{method:'POST',body:{formKey:form.key,answers}});
          toast('Submission recorded.'); renderForms(++renderSeq);
        } catch(err) {
          if (err.status === 409 && err.body?.duplicate) {
            const d = err.body.duplicate;
            const proceed = confirm(
              `Possible duplicate beneficiary\n\nExisting record:\n  ${d.full_name} — ${d.village || 'no village'}\n  created ${new Date(d.created_at).toLocaleDateString(window.KabonixI18n?.locale?.() || 'en-GB')}\n\nIs this a genuinely different person?\nClick OK to create a new record, or Cancel to stop.`
            );
            if (!proceed) return;
            try {
              await api('/submissions',{method:'POST',body:{formKey:form.key,answers,forceNew:true}});
              toast('Submission recorded (confirmed as new).'); renderForms(++renderSeq);
            } catch(e2) { toast(e2.message, true); }
            return;
          }
          toast(err.message, true);
        }
      };
    }

    document.querySelectorAll('[data-delete-sub]').forEach(btn => btn.onclick = async () => {
      if (!confirm('Delete this M&E submission?')) return;
      try {
        await api(`/submissions/${btn.dataset.deleteSub}`, { method: 'DELETE' });
        toast('Submission deleted.'); renderForms(++renderSeq);
      } catch(e) { toast(e.message, true); }
    });

    document.querySelectorAll('[data-history-sub]').forEach(btn => btn.onclick = async () => {
      const id = Number(btn.dataset.historySub);
      try {
        const data = await api(`/submissions/${id}/revisions`);
        const revs = data.revisions || [];
        const lines = revs.map(r => {
          const when = new Date(r.changed_at).toLocaleString(window.KabonixI18n?.locale?.() || 'en-GB');
          const who  = r.changed_by_name || 'unknown';
          return `r${r.revision_no}  ${when}\n     ${who} — ${r.change_summary || '(no note)'}`;
        }).join('\n\n');
        alert(`Submission #${id} — ${revs.length} revision(s)\n\n${lines || 'No revisions recorded.'}`);
      } catch(e) { toast(e.message, true); }
    });
  }

  function fieldHtml(f) {
    const req = f.required ? 'required' : '';
    const attrs = [
      f.minLength != null ? `minlength="${f.minLength}"` : '',
      f.maxLength != null ? `maxlength="${f.maxLength}"` : '',
      f.min != null       ? `min="${f.min}"`              : '',
      f.max != null       ? `max="${f.max}"`              : '',
      f.pattern           ? `pattern="${esc(f.pattern)}"` : '',
    ].filter(Boolean).join(' ');

    if (f.type === 'map') {
      return `<div class="field field-map field-map-wide">
        <label>${esc(f.label)}${f.required?' *':''}</label>
        <p class="meta" style="margin-bottom:8px">Tap the map to drop a pin, drag the pin to fine-tune, or use your device's GPS.</p>
        <div class="map-picker" id="f_${f.id}_map" data-field="${f.id}"></div>
        <div class="map-tools">
          <button type="button" class="btn-sm" data-map-locate>📍 Use my location</button>
          <button type="button" class="btn-sm" data-map-clear>Clear</button>
          <span class="map-readout" data-map-readout>No location selected</span>
        </div>
      </div>`;
    }
    if (f.type === 'select') {
      const ph = `<option value="" ${f.required ? 'disabled selected' : ''}>Select…</option>`;
      return `<div class="field"><label>${esc(f.label)}${f.required?' *':''}</label>
        <select id="f_${f.id}" ${req}>${ph}
        ${(f.options||[]).map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select></div>`;
    }
    if (f.type === 'textarea') return `<div class="field"><label>${esc(f.label)}${f.required?' *':''}</label>
      <textarea id="f_${f.id}" ${req} ${attrs}></textarea></div>`;
    return `<div class="field"><label>${esc(f.label)}${f.required?' *':''}</label>
      <input id="f_${f.id}" type="${f.type==='number'?'number':'text'}" ${req} ${attrs}></div>`;
  }

  async function renderMessages(seq) {
    if (!can('admin','view')) {
      shell(pageHead('Contact Messages'));
      return document.getElementById('main').insertAdjacentHTML('beforeend', forbidden());
    }
    shell(pageHead('Contact Messages','Loading…'));

    let msgs=[];
    try { msgs = asArray(await api('/admin/contact-messages'), 'messages'); }
    catch(e) {
      if (isStale(seq)) return;
      return document.getElementById('main').insertAdjacentHTML('beforeend', errBox(e.message));
    }
    if (isStale(seq)) return;

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
              <td><span class="badge ${esc(statusColor[m.status]||'')}">${esc(m.status)}</span></td>
              <td class="meta">${ago(m.created_at)}</td>
              <td class="action-cell">
                ${['read','replied','archived'].map(s=>
                  s!==m.status ? `<button class="btn-sm" data-msg="${m.id}" data-status="${esc(s)}">${esc(s)}</button>` : ''
                ).join('')}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    document.querySelectorAll('[data-msg]').forEach(btn => btn.onclick = async () => {
      try {
        await api(`/admin/contact-messages/${btn.dataset.msg}/status`,{method:'PATCH',body:{status:btn.dataset.status}});
        toast(`Marked as ${btn.dataset.status}.`); renderMessages(++renderSeq);
      } catch(e) { toast(e.message, true); }
    });
  }

  // ── Profile management ────────────────────────────────────────────────────
  async function renderProfile(seq) {
    shell(pageHead('My Profile','Loading…'));

    // Refresh user record so we see pending_email etc.
    let u = state.user;
    try {
      const d = await api('/auth/me', { __silent401: true });
      state.user = d.user; state.roles = d.roles; state.permissions = d.permissions;
      u = d.user;
    } catch {}
    if (isStale(seq)) return;

    document.getElementById('main').innerHTML = `
      ${pageHead('My Profile', 'Manage your account details, security and two-factor authentication.')}
      <div class="two-col">
        <div>
          <!-- ── Account details ── -->
          <div class="card card-inner">
            <h3>Account details</h3>
            <div class="field">
              <label>Full name</label>
              <input id="prof-name" type="text" value="${esc(u.name)}" maxlength="120">
            </div>
            <div class="field">
              <label>Email</label>
              <input type="email" value="${esc(u.email)}" disabled>
              <p class="meta" style="margin-top:6px">
                ${u.emailVerified ? '✅ Verified' : '⚠️ Not verified'}
              </p>
            </div>
            <div class="field">
              <label>Roles</label>
              <div>${state.roles.map(r=>`<span class="badge badge-role">${esc(r.name)}</span>`).join(' ')||'<span class="meta">None</span>'}</div>
            </div>
            <button class="btn-primary" id="save-name-btn">Save name</button>
            <div id="prof-msg" class="err-msg"></div>
          </div>

          <!-- ── Change email ── -->
          <div class="card card-inner" style="margin-top:16px">
            <h3>Change email address</h3>
            ${u.pendingEmail ? `
              <p class="meta" style="margin-bottom:14px;color:#7a5610">⏳ Waiting for confirmation at <strong>${esc(u.pendingEmail)}</strong>. Click the link in that inbox to complete the change.</p>
            ` : `
              <p class="meta" style="margin-bottom:14px">We'll send a verification link to the new address. Your current email stays active until you confirm the change.</p>
            `}
            <div class="field"><label>New email address</label><input id="prof-new-email" type="email" placeholder="new@example.org"></div>
            <div class="field"><label>Your current password</label><input id="prof-email-pw" type="password" autocomplete="current-password"></div>
            <button class="btn-primary" id="change-email-btn">${u.pendingEmail ? 'Resend verification link' : 'Send verification link'}</button>
            <div id="prof-email-msg" class="err-msg"></div>
          </div>

          <!-- ── Change password ── -->
          <div class="card card-inner" style="margin-top:16px">
            <h3>Change password</h3>
            <p class="meta" style="margin-bottom:14px">For security, all other sessions will be signed out when you change your password.</p>
            <div class="field"><label>Current password</label><input id="prof-pw-cur" type="password" autocomplete="current-password"></div>
            <div class="field"><label>New password</label><input id="prof-pw-new" type="password" autocomplete="new-password"></div>
            <div class="field"><label>Confirm new password</label><input id="prof-pw-confirm" type="password" autocomplete="new-password"></div>
            <button class="btn-primary" id="change-pw-btn">Update password</button>
            <div id="prof-pw-msg" class="err-msg"></div>
          </div>
        </div>

        <div>
          <!-- ── MFA ── -->
          <div class="card card-inner">
            <h3>Two-factor authentication</h3>
            ${u.mfaEnabled ? `
              <p class="meta" style="margin-bottom:14px">MFA is active. Enter your current code to disable it.</p>
              <div class="field"><label>Current authentication code</label><input id="mfa-dis-code" type="text" maxlength="6" inputmode="numeric" placeholder="000000"></div>
              <button class="btn-primary btn-danger" id="dis-mfa-btn">Disable MFA</button>
            ` : `
              <p class="meta" style="margin-bottom:14px">Scan the QR code with any authenticator app (Google Authenticator, Authy, 1Password, …), then enter the 6-digit code to confirm.</p>
              <button class="btn-primary" id="setup-mfa-btn">Set up MFA</button>
              <div id="mfa-setup-area"></div>
            `}
            <div id="mfa-msg" class="err-msg"></div>
          </div>
        </div>
      </div>`;

    // ── Save name ──
    document.getElementById('save-name-btn').onclick = async () => {
      const name = document.getElementById('prof-name').value.trim();
      const msg  = document.getElementById('prof-msg');
      msg.textContent = ''; msg.style.color = '';
      if (!name) return msg.textContent = 'Please enter your name.';
      try {
        const r = await api('/auth/profile', { method: 'PUT', body: { name } });
        state.user = r.user;
        msg.style.color = 'var(--ok)';
        msg.textContent = '✅ Name updated.';
        // Update sidebar greeting
        const sidebarLink = document.querySelector('.sb-foot .nav-item[data-route="profile"]');
        if (sidebarLink) sidebarLink.innerHTML = `<span class="nav-icon">👤</span>${esc(name.split(' ')[0])}`;
      } catch(e) { msg.textContent = e.message; }
    };

    // ── Change email ──
    document.getElementById('change-email-btn').onclick = async () => {
      const newEmail = document.getElementById('prof-new-email').value.trim();
      const pw       = document.getElementById('prof-email-pw').value;
      const msg      = document.getElementById('prof-email-msg');
      msg.textContent = ''; msg.style.color = '';

      // If there's a pending change and no new email entered, resend to the pending address.
      const targetEmail = newEmail || u.pendingEmail;
      if (!targetEmail) return msg.textContent = 'Please enter the new email address.';
      if (!pw)          return msg.textContent = 'Please enter your current password.';

      try {
        const r = await api('/auth/email/change', { method: 'POST', body: { newEmail: targetEmail, currentPassword: pw } });
        msg.style.color = 'var(--ok)';
        msg.textContent = '✅ ' + (r.message || 'Verification link sent.');
        renderProfile(++renderSeq);
      } catch(e) { msg.textContent = e.message; }
    };

    // ── Change password ──
    document.getElementById('change-pw-btn').onclick = async () => {
      const cur     = document.getElementById('prof-pw-cur').value;
      const newPw   = document.getElementById('prof-pw-new').value;
      const confirm = document.getElementById('prof-pw-confirm').value;
      const msg     = document.getElementById('prof-pw-msg');
      msg.textContent = ''; msg.style.color = '';

      if (!cur)                  return msg.textContent = 'Please enter your current password.';
      if (newPw.length < 8)      return msg.textContent = 'New password must be at least 8 characters.';
      if (newPw !== confirm)     return msg.textContent = 'New passwords do not match.';
      if (newPw === cur)         return msg.textContent = 'New password must be different from your current one.';

      try {
        const r = await api('/auth/password', { method: 'PUT', body: { currentPassword: cur, newPassword: newPw } });
        msg.style.color = 'var(--ok)';
        msg.textContent = '✅ ' + (r.message || 'Password updated.');
        document.getElementById('prof-pw-cur').value = '';
        document.getElementById('prof-pw-new').value = '';
        document.getElementById('prof-pw-confirm').value = '';
      } catch(e) { msg.textContent = e.message; }
    };

    // ── MFA disable ──
    if (u.mfaEnabled) {
      document.getElementById('dis-mfa-btn').onclick = async () => {
        const code = document.getElementById('mfa-dis-code').value.trim();
        const msg  = document.getElementById('mfa-msg');
        msg.textContent = '';
        try {
          await api('/auth/mfa/disable',{method:'POST',body:{code}});
          toast('MFA disabled.');
          const d = await api('/auth/me'); state.user = d.user;
          renderProfile(++renderSeq);
        } catch(e) { msg.textContent = e.message; }
      };
    } else {
      // ── MFA setup ──
      document.getElementById('setup-mfa-btn').onclick = async () => {
        const msg = document.getElementById('mfa-msg');
        msg.textContent = '';
        try {
          const d = await api('/auth/mfa/setup',{method:'POST',body:{}});
          document.getElementById('mfa-setup-area').innerHTML = `
            <div style="margin-top:16px">
              ${d.qrDataUrl ? `
                <p class="meta" style="margin-bottom:8px">Scan this code with your authenticator app:</p>
                <img src="${esc(d.qrDataUrl)}" alt="MFA setup QR code"
                     style="display:block;margin:10px 0;border:1px solid var(--line);border-radius:8px;background:#fff">
              ` : `
                <p class="meta" style="margin-bottom:8px;color:var(--warn)">QR image unavailable — use the setup key below.</p>
              `}
              <details style="margin:8px 0">
                <summary class="meta" style="cursor:pointer">Can't scan? Show the setup key</summary>
                <code style="font-size:13px;background:#f3f5f1;padding:6px 10px;border-radius:4px;display:block;margin:10px 0;word-break:break-all">${esc(d.secret)}</code>
              </details>
              <div class="field" style="margin-top:14px">
                <label>Enter the 6-digit code to confirm</label>
                <input id="mfa-confirm-code" type="text" maxlength="6" inputmode="numeric" placeholder="000000">
              </div>
              <button class="btn-primary" id="confirm-mfa-btn">Enable MFA</button>
            </div>`;
          document.getElementById('confirm-mfa-btn').onclick = async () => {
            const code = document.getElementById('mfa-confirm-code').value.trim();
            const m2   = document.getElementById('mfa-msg');
            m2.textContent = '';
            try {
              await api('/auth/mfa/enable',{method:'POST',body:{code}});
              toast('MFA enabled!');
              const d2 = await api('/auth/me'); state.user = d2.user;
              renderProfile(++renderSeq);
            } catch(e) { m2.textContent = e.message; }
          };
        } catch(e) { msg.textContent = e.message; }
      };
    }
  }

  function forbidden() { return `<div class="card card-inner meta">You don't have permission to view this section.</div>`; }
  function errBox(msg) { return `<div class="card card-inner" style="color:var(--danger)">${esc(msg)}</div>`; }

  (async () => {
    try {
      const handled = await handleUrlTokens();
      if (handled) return;
      await tryRestoreSession();
    } catch (e) {
      console.error('[app] boot failed:', e);
      if (root) root.innerHTML = '<pre style="padding:24px;font:13px/1.5 Menlo,Consolas,monospace;color:#a4372c;white-space:pre-wrap">Boot failed: '
        + (e?.stack || e?.message || String(e)) + '</pre>';
    }
  })();
})();