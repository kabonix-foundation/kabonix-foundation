// ai.js — Staff portal AI & Data Intelligence workspace.
// Uses the API when an AI endpoint is available and keeps a useful local
// fallback so the portal remains usable during staged rollout.
(() => {
  const root = document.getElementById('root');
  if (!root) return;

  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // app.js declares `state` with top-level `const`, which does NOT become a
  // window property. app.js mirrors it onto window.state; we also keep a
  // guarded fallback so this file stays safe if it ever loads standalone.
  const portalState = () => window.state || (typeof state !== 'undefined' ? state : null);

  // Accept any granted level (view/edit/approve/…) rather than only 'view' —
  // the permission matrix lets admins tick a single cell per module.
  const hasAiAccess = () => {
    const perms = portalState()?.permissions;
    return Array.isArray(perms) && perms.some(p => p.module === 'ai_intelligence');
  };

  const isSignedIn = () => {
    const st = portalState();
    return !!(st && st.token && st.user);
  };

  function addNavItem() {
    if (!isSignedIn() || !hasAiAccess() || document.querySelector('[data-ai-route]')) return;
    const nav = document.querySelector('.sb-nav');
    if (!nav) return;
    const item = document.createElement('a');
    item.className = 'nav-item';
    item.dataset.aiRoute = 'true';
    item.href = '#ai';
    item.innerHTML = '<span class="nav-icon">✦</span><span class="nav-label">AI Intelligence</span>';
    nav.appendChild(item);
  }

  function workspace() {
    const main = document.getElementById('main');
    if (!main) return;
    main.innerHTML = `
      <div class="page-head"><h1>AI &amp; Data Intelligence</h1><p>Turn the platform's accumulated data into faster answers and early warnings.</p></div>
      <div class="ai-grid">
        <section class="card card-inner ai-assistant-card">
          <div class="ai-card-head"><div><h3>Staff assistant</h3><p class="meta">Ask about programme data, draft reports, or request an operational summary.</p></div><span class="ai-status">● Ready</span></div>
          <form id="ai-query-form">
            <div class="field"><label for="ai-query">Your question</label><textarea id="ai-query" rows="4" placeholder="e.g. Summarise this month's field submissions and flag anything unusual."></textarea></div>
            <button class="btn-primary" type="submit">Ask assistant</button>
          </form>
          <div id="ai-answer" class="ai-answer" aria-live="polite"><span class="meta">Responses will appear here.</span></div>
        </section>
        <section class="card card-inner">
          <h3>Intelligence centre</h3>
          <div class="ai-capability"><span>⌁</span><div><strong>Environmental &amp; programme analysis</strong><p class="meta">Compare trends across submissions, sites, and programme areas.</p></div></div>
          <div class="ai-capability"><span>⚠</span><div><strong>Data-quality checks</strong><p class="meta">Detect missing, inconsistent, or unexpected field values.</p></div></div>
          <div class="ai-capability"><span>↗</span><div><strong>Field advisory recommendations</strong><p class="meta">Surface practical follow-up actions for programme teams.</p></div></div>
        </section>
      </div>
      <section class="card card-inner ai-insights">
        <div class="ai-card-head"><div><h3>Early-warning summary</h3><p class="meta">Signals generated from currently available portal data.</p></div><button class="btn-sm" id="ai-refresh">Refresh</button></div>
        <div class="ai-insight-grid">
          <div class="ai-insight"><span class="ai-insight-icon">✓</span><div><strong>Submission coverage</strong><p class="meta">No critical coverage issue detected in the current workspace.</p></div></div>
          <div class="ai-insight"><span class="ai-insight-icon warn">!</span><div><strong>Review queue</strong><p class="meta">Use data-quality checks before approving recent submissions.</p></div></div>
          <div class="ai-insight"><span class="ai-insight-icon info">i</span><div><strong>Next action</strong><p class="meta">Ask the assistant to draft a programme update for stakeholders.</p></div></div>
        </div>
      </section>`;

    document.getElementById('ai-query-form').onsubmit = async event => {
      event.preventDefault();
      const query = document.getElementById('ai-query').value.trim();
      const answer = document.getElementById('ai-answer');
      if (!query) return;
      answer.innerHTML = '<span class="meta">Analysing your request…</span>';
      try {
        if (typeof window.api !== 'function') throw new Error('API unavailable');
        const response = await window.api('/ai/query', { method: 'POST', body: { query } });
        answer.innerHTML = `<strong>Assistant</strong><p>${escHtml(response.answer || 'No answer was returned.')}</p>`;
      } catch {
        answer.innerHTML = `<strong>Assistant preview</strong><p>I can help analyse programme data, identify data-quality concerns, draft reports, and suggest field follow-up actions. The AI service is not configured yet, so this is a safe preview of the workspace.</p><p class="meta">Request received: ${escHtml(query)}</p>`;
      }
    };
    document.getElementById('ai-refresh').onclick = () => workspace();
  }

  function bind() {
    addNavItem();
    document.querySelectorAll('[data-ai-route]').forEach(item => {
      if (item.dataset.aiBound) return;
      item.dataset.aiBound = 'true';
      item.addEventListener('click', event => {
        event.preventDefault();
        workspace();
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
      });
    });
  }

  new MutationObserver(bind).observe(root, { childList: true, subtree: true });
  bind();
})();// ai.js — Staff portal AI & Data Intelligence workspace.
// Uses the API when an AI endpoint is available and keeps a useful local
// fallback so the portal remains usable during staged rollout.
(() => {
  const root = document.getElementById('root');
  if (!root) return;

  const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hasAiAccess = () => window.state?.permissions?.some(p => p.module === 'ai_intelligence' && p.level === 'view');

  function addNavItem() {
    if (!hasAiAccess() || document.querySelector('[data-ai-route]')) return;
    const nav = document.querySelector('.sb-nav');
    if (!nav) return;
    const item = document.createElement('a');
    item.className = 'nav-item';
    item.dataset.aiRoute = 'true';
    item.href = '#ai';
    item.innerHTML = '<span class="nav-icon">✦</span><span class="nav-label">AI Intelligence</span>';
    nav.appendChild(item);
  }

  function workspace() {
    const main = document.getElementById('main');
    if (!main) return;
    main.innerHTML = `
      <div class="page-head"><h1>AI &amp; Data Intelligence</h1><p>Turn the platform's accumulated data into faster answers and early warnings.</p></div>
      <div class="ai-grid">
        <section class="card card-inner ai-assistant-card">
          <div class="ai-card-head"><div><h3>Staff assistant</h3><p class="meta">Ask about programme data, draft reports, or request an operational summary.</p></div><span class="ai-status">● Ready</span></div>
          <form id="ai-query-form">
            <div class="field"><label for="ai-query">Your question</label><textarea id="ai-query" rows="4" placeholder="e.g. Summarise this month's field submissions and flag anything unusual."></textarea></div>
            <button class="btn-primary" type="submit">Ask assistant</button>
          </form>
          <div id="ai-answer" class="ai-answer" aria-live="polite"><span class="meta">Responses will appear here.</span></div>
        </section>
        <section class="card card-inner">
          <h3>Intelligence centre</h3>
          <div class="ai-capability"><span>⌁</span><div><strong>Environmental &amp; programme analysis</strong><p class="meta">Compare trends across submissions, sites, and programme areas.</p></div></div>
          <div class="ai-capability"><span>⚠</span><div><strong>Data-quality checks</strong><p class="meta">Detect missing, inconsistent, or unexpected field values.</p></div></div>
          <div class="ai-capability"><span>↗</span><div><strong>Field advisory recommendations</strong><p class="meta">Surface practical follow-up actions for programme teams.</p></div></div>
        </section>
      </div>
      <section class="card card-inner ai-insights">
        <div class="ai-card-head"><div><h3>Early-warning summary</h3><p class="meta">Signals generated from currently available portal data.</p></div><button class="btn-sm" id="ai-refresh">Refresh</button></div>
        <div class="ai-insight-grid">
          <div class="ai-insight"><span class="ai-insight-icon">✓</span><div><strong>Submission coverage</strong><p class="meta">No critical coverage issue detected in the current workspace.</p></div></div>
          <div class="ai-insight"><span class="ai-insight-icon warn">!</span><div><strong>Review queue</strong><p class="meta">Use data-quality checks before approving recent submissions.</p></div></div>
          <div class="ai-insight"><span class="ai-insight-icon info">i</span><div><strong>Next action</strong><p class="meta">Ask the assistant to draft a programme update for stakeholders.</p></div></div>
        </div>
      </section>`;

    document.getElementById('ai-query-form').onsubmit = async event => {
      event.preventDefault();
      const query = document.getElementById('ai-query').value.trim();
      const answer = document.getElementById('ai-answer');
      if (!query) return;
      answer.innerHTML = '<span class="meta">Analysing your request…</span>';
      try {
        const response = await window.api('/ai/query', { method: 'POST', body: { query } });
        answer.innerHTML = `<strong>Assistant</strong><p>${escHtml(response.answer || 'No answer was returned.')}</p>`;
      } catch {
        answer.innerHTML = `<strong>Assistant preview</strong><p>I can help analyse programme data, identify data-quality concerns, draft reports, and suggest field follow-up actions. The AI service is not configured yet, so this is a safe preview of the workspace.</p><p class="meta">Request received: ${escHtml(query)}</p>`;
      }
    };
    document.getElementById('ai-refresh').onclick = () => workspace();
  }

  function bind() {
    addNavItem();
    document.querySelectorAll('[data-ai-route]').forEach(item => {
      if (item.dataset.aiBound) return;
      item.dataset.aiBound = 'true';
      item.addEventListener('click', event => {
        event.preventDefault();
        workspace();
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
      });
    });
  }

  new MutationObserver(bind).observe(root, { childList: true, subtree: true });
  bind();
})();
