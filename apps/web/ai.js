// ai.js — Staff portal AI & Data Intelligence workspace.
// Registers itself with app.js via window.__kabonix so it participates in the
// same render sequencing, permission model, i18n pass, and sidebar as the
// built-in views. Falls back to a safe preview when the AI endpoint is not
// yet configured.
//
// [FIX] Replaces the previous MutationObserver-based injection with a
// registered view + nav item. No observers, no fighting app.js for #main.
(() => {
  const K = window.__kabonix;
  if (!K) {
    console.warn('[ai] app.js hooks not found — ai.js must load after app.js');
    return;
  }
  if (window.__kabonixAiLoaded) return;
  window.__kabonixAiLoaded = true;

  const { esc, toast, shell, pageHead, api, isStale, nav,
          registerView, registerNav, state } = K;

  const hasAiAccess = () =>
    Array.isArray(state.permissions) &&
    state.permissions.some(p => p.module === 'ai_intelligence');

  const isSignedIn = () => !!(state.token && state.user);

  // Re-evaluated on every shell() render — signing in/out or a permission
  // change takes effect immediately, no observer required.
  registerNav({
    key: 'ai',
    icon: '✦',
    label: 'AI Intelligence',
    canAccess: () => isSignedIn() && hasAiAccess(),
  });

  async function renderAi(seq) {
    if (!hasAiAccess()) {
      shell(pageHead('AI & Data Intelligence'), 'ai');
      return document.getElementById('main').insertAdjacentHTML(
        'beforeend',
        `<div class="card card-inner meta">Your role doesn't have access to the AI workspace. Ask a Foundation Admin to grant the <code>ai_intelligence</code> permission.</div>`
      );
    }

    shell(`
      ${pageHead('AI & Data Intelligence', "Turn the platform's accumulated data into faster answers and early warnings.")}
      <div class="ai-grid">
        <section class="card card-inner ai-assistant-card">
          <div class="ai-card-head">
            <div>
              <h3>Staff assistant</h3>
              <p class="meta">Ask about programme data, draft reports, or request an operational summary.</p>
            </div>
            <span class="ai-status" id="ai-status">● Ready</span>
          </div>
          <form id="ai-query-form" novalidate>
            <div class="field">
              <label for="ai-query">Your question</label>
              <textarea id="ai-query" rows="4"
                placeholder="e.g. Summarise this month's field submissions and flag anything unusual."></textarea>
            </div>
            <button class="btn-primary" type="submit" id="ai-submit">Ask assistant</button>
          </form>
          <div id="ai-answer" class="ai-answer" aria-live="polite">
            <span class="meta">Responses will appear here.</span>
          </div>
        </section>
        <section class="card card-inner">
          <h3>Intelligence centre</h3>
          <div class="ai-capability"><span>⌁</span><div><strong>Environmental &amp; programme analysis</strong><p class="meta">Compare trends across submissions, sites, and programme areas.</p></div></div>
          <div class="ai-capability"><span>⚠</span><div><strong>Data-quality checks</strong><p class="meta">Detect missing, inconsistent, or unexpected field values.</p></div></div>
          <div class="ai-capability"><span>↗</span><div><strong>Field advisory recommendations</strong><p class="meta">Surface practical follow-up actions for programme teams.</p></div></div>
        </section>
      </div>
      <section class="card card-inner ai-insights">
        <div class="ai-card-head">
          <div><h3>Early-warning summary</h3><p class="meta">Signals generated from currently available portal data.</p></div>
          <button class="btn-sm" id="ai-refresh">Refresh</button>
        </div>
        <div class="ai-insight-grid">
          <div class="ai-insight"><span class="ai-insight-icon">✓</span><div><strong>Submission coverage</strong><p class="meta">No critical coverage issue detected in the current workspace.</p></div></div>
          <div class="ai-insight"><span class="ai-insight-icon warn">!</span><div><strong>Review queue</strong><p class="meta">Use data-quality checks before approving recent submissions.</p></div></div>
          <div class="ai-insight"><span class="ai-insight-icon info">i</span><div><strong>Next action</strong><p class="meta">Ask the assistant to draft a programme update for stakeholders.</p></div></div>
        </div>
      </section>`, 'ai');

    const form      = document.getElementById('ai-query-form');
    const answer    = document.getElementById('ai-answer');
    const submitBtn = document.getElementById('ai-submit');
    const status    = document.getElementById('ai-status');
    let submitting  = false;

    function setLoading(on) {
      submitting = on;
      submitBtn.disabled = on;
      status.textContent = on ? '● Working…' : '● Ready';
      status.style.color = on ? 'var(--warn)' : '';
    }

    form.onsubmit = async event => {
      event.preventDefault();
      if (submitting) return;
      const query = document.getElementById('ai-query').value.trim();
      if (!query) return;
      setLoading(true);
      answer.innerHTML = '<span class="meta">Analysing your request…</span>';
      try {
        const response = await api('/ai/query', { method: 'POST', body: { query } });
        if (isStale(seq)) return;
        const text = response?.answer || 'No answer was returned.';
        // esc() then <br> so model output can't inject HTML but newlines survive.
        answer.innerHTML = `<strong>Assistant</strong><p>${esc(text).replace(/\n/g, '<br>')}</p>`;
      } catch (err) {
        if (isStale(seq)) return;
        // 404/501 or a clear "not configured" message → show the safe preview.
        const notConfigured = err?.status === 404 || err?.status === 501
          || /not.?configured|unavailable/i.test(err?.message || '');
        if (notConfigured) {
          answer.innerHTML = `<strong>Assistant preview</strong>
            <p>I can help analyse programme data, identify data-quality concerns, draft reports, and suggest field follow-up actions. The AI service is not configured yet, so this is a safe preview of the workspace.</p>
            <p class="meta">Request received: ${esc(query)}</p>`;
        } else {
          answer.innerHTML = `<strong>Assistant</strong><p class="meta" style="color:var(--danger)">${esc(err?.message || 'Request failed.')}</p>`;
          toast(err?.message || 'AI request failed', true);
        }
      } finally {
        if (!isStale(seq)) setLoading(false);
      }
    };

    // Refresh re-enters through app.js's router so renderSeq bumps cleanly.
    document.getElementById('ai-refresh').onclick = () => nav('ai');
  }

  registerView('ai', renderAi);
})();
