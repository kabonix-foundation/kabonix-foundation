// script.js — Public website: language toggle, dynamic content, slideshows.

// ── Translation dictionary ────────────────────────────────────────────────
const translations = {
  en: {
    top_identity: "Public Identity & Transparency",
    top_partner: "Partner With Us →",
    nav_about_us: "About Us",
    nav_news: "News & Events",
    nav_impact: "Impact",
    nav_partners: "Partners",
    nav_contact: "Contact",
    btn_portals: "Portals ▾",
    portal_staff: "Staff Portal",
    portal_community: "Community Portal",
    hero_kicker: "Foundation Website",
    hero_title: "The Foundation's public identity & transparency window.",
    hero_sub: "Visited by donors, partners, government and the communities it serves. Discover our commitment to climate and the blue economy.",
    btn_learn: "Learn About Us",
    feat_climate_title: "Climate Focus",
    feat_climate_desc: "Driving sustainable environmental solutions.",
    feat_blue_title: "Blue Economy",
    feat_blue_desc: "Protecting our oceans and marine resources.",
    feat_comm_title: "Community First",
    feat_comm_desc: "Empowering the people we serve.",
    about_kicker: "About Kabonix",
    about_title: "Our Focus Areas",
    about_sub: "Kabonix Foundation is dedicated to climate resilience and the sustainable blue economy. We work hand-in-hand with communities to create lasting impact.",
    card_climate_title: "Climate Action",
    card_climate_desc: "Implementing projects that mitigate climate change and build resilient ecosystems.",
    card_blue_title: "Blue Economy",
    card_blue_desc: "Promoting sustainable use of ocean resources for economic growth and improved livelihoods.",
    card_gov_title: "Governance & Transparency",
    card_gov_desc: "Ensuring accountability to our donors, partners, and the communities we serve.",
    impact_kicker: "Impact Stories",
    impact_title: "Results Highlights",
    impact_sub: "Real numbers. Real change. See how your support translates into measurable impact.",
    news_kicker: "News & Events",
    news_title: "Latest Updates & Publications",
    news_sub: "Stay informed about our latest projects, upcoming events, and published reports.",
    partners_kicker: "Partners & Donors",
    partners_title: "Recognition & Collaboration",
    partners_sub: "We are grateful for the support of our partners and donors who make our work possible.",
    cta_title: "Partner with Kabonix Foundation.",
    cta_sub: "Contact us to discuss how we can work together for a sustainable future.",
    contact_via_email: "Email us",
    contact_via_whatsapp: "WhatsApp",
    footer_desc: "The Foundation's public identity and transparency window — visited by donors, partners, government and the communities it serves.",
    footer_quick: "Quick Links",
    footer_focus: "Focus Areas",
    footer_newsletter: "Subscribe to Our Newsletter",
    footer_newsletter_sub: "Get the latest updates on our projects, news and sustainability tips.",
    footer_email_placeholder: "Your email address",
    footer_subscribe_btn: "Subscribe →",
    footer_rights: "© 2026 Kabonix Foundation. All rights reserved.",
    footer_privacy: "Privacy Policy",
    footer_terms: "Terms & Conditions",
    footer_transparency: "Transparency Report",
    empty_news: "No news yet — check back soon.",
    empty_impact: "No impact stories yet.",
    empty_partners: "No partners listed yet."
  },
  sw: {
    top_identity: "Utambulisho wa Umma na Uwazi",
    top_partner: "Shirikiana Nasi →",
    nav_about_us: "Kuhusu Sisi",
    nav_news: "Habari na Matukio",
    nav_impact: "Athari",
    nav_partners: "Washirika",
    nav_contact: "Wasiliana",
    btn_portals: "Milango ▾",
    portal_staff: "Lango la Wafanyakazi",
    portal_community: "Lango la Jamii",
    hero_kicker: "Tovuti ya Foundation",
    hero_title: "Dirisha la utambulisho wa umma na uwazi wa Foundation.",
    hero_sub: "Inatembelewa na wafadhili, washirika, serikali na jamii inayohudumia. Gundua kujitolea kwetu kwa hali ya hewa na uchumi wa bluu.",
    btn_learn: "Jifunze Kuhusu Sisi",
    feat_climate_title: "Mwelekeo wa Hali ya Hewa",
    feat_climate_desc: "Kuendesha suluhisho endelevu za mazingira.",
    feat_blue_title: "Uchumi wa Bluu",
    feat_blue_desc: "Kulinda bahari na rasilimali zetu za baharini.",
    feat_comm_title: "Jamii Kwanza",
    feat_comm_desc: "Kuwapa nguvu watu tunaowahudumia.",
    about_kicker: "Kuhusu Kabonix",
    about_title: "Maeneo Yetu ya Kipaumbele",
    about_sub: "Kabonix Foundation imejitolea kwa ustahimilivu wa hali ya hewa na uchumi endelevu wa bluu. Tunafanya kazi bega kwa bega na jamii kuunda athari ya kudumu.",
    card_climate_title: "Hatua za Hali ya Hewa",
    card_climate_desc: "Kutekeleza miradi inayopunguza mabadiliko ya hali ya hewa na kujenga mifumo ikolojia imara.",
    card_blue_title: "Uchumi wa Bluu",
    card_blue_desc: "Kukuza matumizi endelevu ya rasilimali za bahari kwa ukuaji wa uchumi na maisha bora.",
    card_gov_title: "Utawala na Uwazi",
    card_gov_desc: "Kuhakikisha uwajibikaji kwa wafadhili wetu, washirika, na jamii tunazohudumia.",
    impact_kicker: "Hadithi za Athari",
    impact_title: "Mambo Muhimu ya Matokeo",
    impact_sub: "Nambari halisi. Mabadiliko halisi. Tazama jinsi msaada wako unavyogeuka kuwa athari inayoweza kupimwa.",
    news_kicker: "Habari na Matukio",
    news_title: "Habari na Machapisho ya Hivi Karibuni",
    news_sub: "Kaa na habari kuhusu miradi yetu ya hivi karibuni, matukio yajayo, na ripoti zilizochapishwa.",
    partners_kicker: "Washirika na Wafadhili",
    partners_title: "Utambuzi na Ushirikiano",
    partners_sub: "Tunashukuru kwa msaada wa washirika na wafadhili wetu ambao hufanya kazi yetu iwezekane.",
    cta_title: "Shirikiana na Kabonix Foundation.",
    cta_sub: "Wasiliana nasi ili kujadili jinsi tunaweza kufanya kazi pamoja kwa mustakabali endelevu.",
    contact_via_email: "Tutumie barua pepe",
    contact_via_whatsapp: "WhatsApp",
    footer_desc: "Dirisha la utambulisho wa umma na uwazi wa Foundation — linatembelewa na wafadhili, washirika, serikali na jamii inayohudumia.",
    footer_quick: "Viungo vya Haraka",
    footer_focus: "Maeneo ya Kipaumbele",
    footer_newsletter: "Jiunge na Jarida letu",
    footer_newsletter_sub: "Pata habari za hivi karibuni kuhusu miradi yetu, habari na vidokezo vya uendelevu.",
    footer_email_placeholder: "Barua pepe yako",
    footer_subscribe_btn: "Jiunge →",
    footer_rights: "© 2026 Kabonix Foundation. Haki zote zimehifadhiwa.",
    footer_privacy: "Sera ya Faragha",
    footer_terms: "Masharti na Vigezo",
    footer_transparency: "Ripoti ya Uwazi",
    empty_news: "Bado hakuna habari — angalia tena hivi karibuni.",
    empty_impact: "Bado hakuna hadithi za athari.",
    empty_partners: "Bado hakuna washirika walioorodheshwa."
  }
};

// ── Language state ───────────────────────────────────────────────────────
const STORAGE_KEY = 'kabonix_lang';
const queryLang = new URLSearchParams(window.location.search).get('lang');
let currentLang = (queryLang === 'sw' || queryLang === 'en')
  ? queryLang
  : (localStorage.getItem(STORAGE_KEY) || 'en');

// ── API URL from meta tag (injected by serve.js) ─────────────────────────
const API_URL = (document.querySelector('meta[name="api-url"]')?.content || '').replace(/\/$/, '');

// ── Helpers ──────────────────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function pickImages(item) {
  if (Array.isArray(item.image_urls) && item.image_urls.length) return item.image_urls;
  if (item.image_url) return [item.image_url];
  return [];
}

function formatDate(ts) {
  if (!ts) return '';
  const locale = currentLang === 'sw' ? 'sw-TZ' : 'en-GB';
  return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

function withLang(href, lang = currentLang) {
  try {
    const url = new URL(href, window.location.href);
    url.searchParams.set('lang', lang === 'sw' ? 'sw' : 'en');
    return url.href;
  } catch {
    const sep = href.includes('?') ? '&' : '?';
    return `${href}${sep}lang=${encodeURIComponent(lang)}`;
  }
}

// ── Language application ─────────────────────────────────────────────────
function setLanguage(lang) {
  currentLang = (lang === 'sw') ? 'sw' : 'en';
  try { localStorage.setItem(STORAGE_KEY, currentLang); } catch {}
  document.documentElement.lang = currentLang;

  const url = new URL(window.location.href);
  url.searchParams.set('lang', currentLang);
  history.replaceState(null, '', url.pathname + url.search + url.hash);

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[lang] && translations[lang][key]) {
      if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
        el.setAttribute('placeholder', translations[lang][key]);
      } else {
        el.textContent = translations[lang][key];
      }
    }
  });

  updatePortalLinks();
  const backLink = document.querySelector('.back-link');
  if (backLink) backLink.href = withLang('/');

  loadWebsiteContent();
}

function updatePortalLinks() {
  const configuredPortal = document.querySelector('meta[name="portal-url"]')?.content;
  if (!configuredPortal) return;
  document.querySelectorAll('.portal-link').forEach(link => {
    link.href = withLang(configuredPortal);
  });
}

// ── Slideshow ────────────────────────────────────────────────────────────
function initSlideshow(root) {
  const slides = root.querySelectorAll('.slide');
  if (slides.length < 2) return;
  const dots = root.querySelectorAll('.slide-dot');
  let idx = 0;
  let timer = null;

  function show(i) {
    idx = (i + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('active', k === idx));
    dots.forEach((d, k) => d.classList.toggle('active', k === idx));
  }

  function start() {
    stop();
    timer = setInterval(() => show(idx + 1), 4500);
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  dots.forEach((dot, k) => {
    dot.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      show(k);
      start();
    });
  });

  root.addEventListener('mouseenter', stop);
  root.addEventListener('mouseleave', start);

  show(0);
  start();
}

// ── Card renderers ───────────────────────────────────────────────────────
function renderSlideshow(images, altText) {
  if (!images.length) {
    return `<div class="card-slideshow-empty" aria-hidden="true"></div>`;
  }
  const slides = images.map((u, i) =>
    `<img class="slide${i === 0 ? ' active' : ''}" src="${esc(u)}" alt="${esc(altText)}" loading="${i === 0 ? 'eager' : 'lazy'}">`
  ).join('');
  const dots = images.length > 1
    ? `<div class="slide-dots">${images.map((_, i) =>
        `<button class="slide-dot${i === 0 ? ' active' : ''}" type="button" aria-label="Image ${i+1}"></button>`
      ).join('')}</div>`
    : '';
  return `<div class="slideshow" data-slideshow>${slides}${dots}</div>`;
}

function renderNewsCard(post) {
  const images = pickImages(post);
  const altText = post.title || 'Post image';
  const tag = post.type === 'event' ? 'Upcoming Event'
            : post.type === 'publication' ? 'Publication'
            : 'Press Release';
  const meta = post.event_date ? `📅 ${formatDate(post.event_date)}`
             : post.doc_url ? '📄 Download PDF'
             : post.published_at ? formatDate(post.published_at)
             : '';
  return `
    <div class="project-card reveal">
      ${renderSlideshow(images, altText)}
      <div class="project-content">
        <span class="project-tag">${esc(tag)}</span>
        <h3>${esc(post.title || '')}</h3>
        <p class="meta" style="margin: 6px 0 8px">${esc(post.summary || '')}</p>
        ${meta ? `<div class="project-loc">${esc(meta)}</div>` : ''}
      </div>
    </div>`;
}

function renderImpactCard(story) {
  const images = pickImages(story);
  const altText = story.title || 'Impact story';
  const metric = story.metric_value
    ? `<div class="metric">${esc(story.metric_value)}</div>`
    : '';
  return `
    <article class="impact-card reveal">
      ${images.length ? `<div class="impact-thumb">${renderSlideshow(images, altText)}</div>` : ''}
      ${metric}
      <h3>${esc(story.title || '')}</h3>
      <p>${esc(story.body || '')}</p>
      ${story.location ? `<p class="meta" style="margin-top:8px">📍 ${esc(story.location)}</p>` : ''}
    </article>`;
}

function renderPartnerCard(partner) {
  const logo = partner.logo_url
    ? `<img src="${esc(partner.logo_url)}" alt="${esc(partner.name)}" class="partner-logo-img">`
    : `<span aria-hidden="true">🤝</span>`;
  return `
    <div class="partner-logo reveal">
      ${logo}
      <span>${esc(partner.name)}</span>
    </div>`;
}

function renderEmpty(msgKey, container) {
  const msg = translations[currentLang][msgKey] || '';
  container.innerHTML = `<p class="meta" style="grid-column:1/-1;text-align:center;padding:24px 0">${esc(msg)}</p>`;
}

// ── API loading ──────────────────────────────────────────────────────────
async function fetchJson(path) {
  if (!API_URL) throw new Error('API URL not configured');
  const res = await fetch(API_URL + path);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

async function loadWebsiteContent() {
  const newsGrid     = document.getElementById('news-grid');
  const impactGrid   = document.getElementById('impact-grid');
  const partnersGrid = document.getElementById('partners-grid');

  if (newsGrid) {
    try {
      const posts = await fetchJson(`/api/website/posts?lang=${currentLang}`);
      if (Array.isArray(posts) && posts.length) {
        newsGrid.innerHTML = posts.map(renderNewsCard).join('');
        newsGrid.querySelectorAll('[data-slideshow]').forEach(initSlideshow);
      } else {
        renderEmpty('empty_news', newsGrid);
      }
    } catch {
      renderEmpty('empty_news', newsGrid);
    }
  }

  if (impactGrid) {
    try {
      const stories = await fetchJson(`/api/website/impact-stories?lang=${currentLang}`);
      if (Array.isArray(stories) && stories.length) {
        impactGrid.innerHTML = stories.map(renderImpactCard).join('');
        impactGrid.querySelectorAll('[data-slideshow]').forEach(initSlideshow);
      } else {
        renderEmpty('empty_impact', impactGrid);
      }
    } catch {
      renderEmpty('empty_impact', impactGrid);
    }
  }

  if (partnersGrid) {
    try {
      const partners = await fetchJson(`/api/website/partners?lang=${currentLang}`);
      if (Array.isArray(partners) && partners.length) {
        partnersGrid.innerHTML = partners.map(renderPartnerCard).join('');
      } else {
        renderEmpty('empty_partners', partnersGrid);
      }
    } catch {
      renderEmpty('empty_partners', partnersGrid);
    }
  }

  attachScrollReveal();
}

// ── Scroll reveal ────────────────────────────────────────────────────────
function attachScrollReveal() {
  const reveals = document.querySelectorAll('.reveal:not(.visible)');
  if (!reveals.length) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add('visible');
    });
  }, { threshold: 0.1, rootMargin: "0px 0px -50px 0px" });
  reveals.forEach(el => observer.observe(el));
}

// ── Service banner ───────────────────────────────────────────────────────
async function fetchAndShowBanner() {
  if (!API_URL) return;
  try {
    const res = await fetch(API_URL + '/api/status');
    if (!res.ok) return;
    const data = await res.json();
    const msg = data?.banner?.message?.trim();
    document.getElementById('service-banner')?.remove();
    if (!msg) return;
    const el = document.createElement('div');
    el.id = 'service-banner';
    el.setAttribute('role', 'status');
    el.style.cssText = [
      'background:#7a5610', 'color:#fff',
      'padding:10px 16px', 'text-align:center',
      'font:600 13px/1.4 Arial,Helvetica,sans-serif',
      'position:relative', 'z-index:200',
    ].join(';');
    el.textContent = '⚠️ ' + msg;
    document.body.prepend(el);
  } catch { /* silent */ }
}

// ── Boot ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setLanguage(currentLang);

  const toggleBtn = document.getElementById('portal-toggle');
  const menu = document.getElementById('portal-menu');
  if (toggleBtn && menu) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('show');
    });
    document.addEventListener('click', (e) => {
      if (!toggleBtn.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.remove('show');
      }
    });
  }

  updatePortalLinks();
  fetchAndShowBanner();
  attachScrollReveal();
});