// i18n.js — shared language state and UI translation for the Kabonix portal.
// The public website and the staff portal are deployed as separate origins, so
// portal links carry ?lang=en|sw while localStorage keeps the choice locally.
(() => {
  const STORAGE_KEY = 'kabonix_lang';
  const valid = lang => lang === 'sw' ? 'sw' : 'en';
  const queryLang = new URLSearchParams(location.search).get('lang');
  let currentLang = valid(queryLang || (() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'en'; } catch { return 'en'; }
  })());

  const originals = new WeakMap();
  const attributeOriginals = new WeakMap();

  const sw = {
    // Shared portal shell / authentication
    'Dashboard':'Dashibodi',
    'Loading…':'Inapakia…',
    'Loading...':'Inapakia…',
    'Digital Ecosystem Platform':'Jukwaa la Ikolojia ya Kidijitali',
    'Staff & field officer portal. Collect, manage and act on programme data.':'Lango la wafanyakazi na maafisa wa uwanjani. Kusanya, simamia na chukua hatua kwa data za programu.',
    'Blue Economy':'Uchumi wa Bluu',
    'Carbon':'Kaboni',
    'Renewable Energy':'Nishati Jadidifu',
    'Youth & Women':'Vijana na Wanawake',
    'Two-factor authentication':'Uthibitishaji wa hatua mbili',
    'Enter the 6-digit code from your authenticator app.':'Ingiza msimbo wa tarakimu 6 kutoka kwenye programu yako ya uthibitishaji.',
    'Authentication code':'Msimbo wa uthibitishaji',
    'Verify':'Thibitisha',
    '← Back to sign in':'← Rudi kwenye kuingia',
    'Sign in':'Ingia',
    'Foundation staff and field officers only.':'Kwa wafanyakazi wa Foundation na maafisa wa uwanjani pekee.',
    'Email':'Barua pepe',
    'Password':'Nenosiri',
    'Forgot your password?':'Umesahau nenosiri lako?',
    'Seeded accounts:':'Akaunti za awali:',
    'Super Admin':'Msimamizi Mkuu',
    'Field Officer':'Afisa wa Uwanjani',
    'Sign out':'Toka',
    'AI Intelligence':'Akili Bandia na Ujasusi wa Data',
    'Foundation Admin':'Msimamizi wa Foundation',

    // Dashboard
    'Active staff':'Wafanyakazi wanaofanya kazi',
    'Submissions':'Uwasilishaji',
    'Audit events (24h)':'Matukio ya ukaguzi (saa 24)',
    'New enquiries':'Maswali mapya',
    'Your access':'Ufikiaji wako',
    'No roles assigned':'Hakuna majukumu yaliyotolewa',
    'Quick actions':'Vitendo vya haraka',
    'Submit M&E form':'Wasilisha fomu ya M&E',
    'Invite staff member':'Alika mfanyakazi',
    'View contact messages':'Tazama ujumbe wa mawasiliano',
    'View audit log':'Tazama kumbukumbu ya ukaguzi',
    'Public website ↗':'Tovuti ya umma ↗',

    // Navigation / pages
    'M&E Collection':'Ukusanyaji wa M&E',
    'Staff & Users':'Wafanyakazi na Watumiaji',
    'Roles & Permissions':'Majukumu na Ruhusa',
    'System Config':'Mipangilio ya Mfumo',
    'Contact Messages':'Ujumbe wa Mawasiliano',
    'Audit Log':'Kumbukumbu ya Ukaguzi',
    'My Profile':'Wasifu Wangu',

    // Users
    'Manage team members, roles and account status.':'Simamia wanachama wa timu, majukumu na hali za akaunti.',
    'accounts':'akaunti',
    'active':'zinazotumika',
    'Invite new staff member':'Alika mfanyakazi mpya',
    'Full name':'Jina kamili',
    'Initial role':'Jukumu la awali',
    'No role yet':'Bado hakuna jukumu',
    'Send invite':'Tuma mwaliko',
    'Name':'Jina',
    'Roles':'Majukumu',
    'Status':'Hali',
    'MFA':'MFA',
    'Last active':'Mara ya mwisho kutumika',
    'Actions':'Vitendo',
    'none':'hakuna',
    'Active':'Inatumika',
    'Inactive':'Haifanyi kazi',
    'On':'Imewashwa',
    'Off':'Imezimwa',
    'Assign':'Weka',
    'Deactivate':'Zima',
    'Reactivate':'Washa tena',
    'Delete':'Futa',

    // Roles
    'Create new role':'Unda jukumu jipya',
    'Key (lowercase, underscores)':'Ufunguo (herufi ndogo, mistari ya chini)',
    'Display name':'Jina la kuonyesha',
    'Description':'Maelezo',
    'Optional':'Si lazima',
    'Create role':'Unda jukumu',
    'Module':'Moduli',
    'Save permissions':'Hifadhi ruhusa',

    // Config
    'Platform-wide settings managed by Foundation admin — no developer required.':'Mipangilio ya jukwaa lote inayosimamiwa na msimamizi wa Foundation — hakuna msanidi anayehitajika.',
    'Platform settings':'Mipangilio ya jukwaa',
    'My notification preferences':'Mapendeleo yangu ya arifa',
    'These apply to your account only.':'Haya yanahusu akaunti yako pekee.',
    'Email notifications':'Arifa za barua pepe',
    'SMS notifications':'Arifa za SMS',
    'WhatsApp notifications':'Arifa za WhatsApp',
    'In-app notifications':'Arifa ndani ya programu',
    'Save preferences':'Hifadhi mapendeleo',
    'Migration status':'Hali ya uhamishaji',
    'Applied SQL migrations tracked in':'Uhamishaji wa SQL uliotekelezwa unafuatiliwa kwenye',
    'migrations applied':'uhamishaji umetekelezwa',
    'Could not load.':'Imeshindikana kupakia.',

    // Audit
    'Full record of who changed what, and when.':'Rekodi kamili ya nani alibadilisha nini na lini.',
    'Every create, edit, delete, login and permission-denied event is recorded here.':'Kila tukio la kuunda, kuhariri, kufuta, kuingia na kukataliwa kwa ruhusa linarekodiwa hapa.',
    'Action':'Kitendo',
    'All actions':'Vitendo vyote',
    'Entity type':'Aina ya kitu',
    'From':'Kuanzia',
    'To':'Hadi',
    'Apply filters':'Tumia vichujio',
    'Refresh':'Onyesha upya',
    'Timestamp':'Muda',
    'User':'Mtumiaji',
    'Entity':'Kitu',
    'Detail':'Maelezo',
    'No records match the current filters.':'Hakuna rekodi zinazolingana na vichujio vya sasa.',
    'events':'matukio',

    // M&E
    'Household Baseline Survey and field data submission.':'Utafiti wa Msingi wa Kaya na uwasilishaji wa data za uwanjani.',
    'M&E Data Collection':'Ukusanyaji wa Data za M&E',
    'No forms available.':'Hakuna fomu zinazopatikana.',
    'Submit survey':'Wasilisha utafiti',
    'Your role can view submissions but not create new ones.':'Jukumu lako linaweza kutazama uwasilishaji lakini haliwezi kuunda mpya.',
    'Recent submissions':'Uwasilishaji wa hivi karibuni',
    'No submissions yet.':'Bado hakuna uwasilishaji.',
    'Beneficiary':'Mnufaika',
    'Village':'Kijiji',
    'Programme':'Programu',
    'Submitted by':'Imewasilishwa na',
    'When':'Lini',
    'History':'Historia',
    'Submission #':'Uwasilishaji #',
    'Select…':'Chagua…',
    'Submit':'Wasilisha',
    'Notes':'Maelezo',
    'Beneficiary full name':'Jina kamili la mnufaika',
    'Programme area':'Eneo la programu',
    'Household size':'Ukubwa wa kaya',
    'GPS latitude':'Latitudo ya GPS',
    'GPS longitude':'Longitudo ya GPS',
    'Renewable Energy':'Nishati Jadidifu',
    'Climate-smart Agriculture':'Kilimo kinachozingatia hali ya hewa',
    'Youth & Women Entrepreneurship':'Ujasiriamali wa Vijana na Wanawake',

    // Messages
    'Website enquiry inbox.':'Kikasha cha maswali kutoka kwenye tovuti.',
    'From':'Kutoka',
    'Organisation':'Shirika',
    'Subject':'Mada',
    'Received':'Imepokelewa',
    'new':'mpya',
    'read':'imesomwa',
    'replied':'imejibiwa',
    'archived':'imehifadhiwa',

    // Profile / MFA
    'Account settings and two-factor authentication.':'Mipangilio ya akaunti na uthibitishaji wa hatua mbili.',
    'Account details':'Maelezo ya akaunti',
    'Email verified':'Barua pepe imethibitishwa',
    'Yes':'Ndiyo',
    'Not verified':'Haijathibitishwa',
    'Enabled':'Imewezeshwa',
    'Disabled':'Imezimwa',
    'Two-factor authentication':'Uthibitishaji wa hatua mbili',
    'MFA is active. Enter your current code to disable it.':'MFA imewashwa. Ingiza msimbo wako wa sasa ili kuizima.',
    'Current authentication code':'Msimbo wa sasa wa uthibitishaji',
    'Disable MFA':'Zima MFA',
    'Scan the QR code (or copy the key) into your authenticator app, then enter the 6-digit code to confirm.':'Changanua msimbo wa QR (au nakili ufunguo) kwenye programu yako ya uthibitishaji, kisha ingiza msimbo wa tarakimu 6 kuthibitisha.',
    'Set up MFA':'Sanidi MFA',
    'Scan with your authenticator app, or enter the key manually:':'Changanua kwa programu yako ya uthibitishaji, au ingiza ufunguo wewe mwenyewe:',
    'Enter the 6-digit code to confirm':'Ingiza msimbo wa tarakimu 6 kuthibitisha',
    'Enable MFA':'Washa MFA',

    // Password reset / verification
    'Verifying your email':'Inathibitisha barua pepe yako',
    'One moment…':'Subiri kidogo…',
    'Set a new password':'Weka nenosiri jipya',
    'Choose something at least 8 characters long.':'Chagua nenosiri lenye angalau herufi 8.',
    'New password':'Nenosiri jipya',
    'Confirm new password':'Thibitisha nenosiri jipya',
    'Update password':'Sasisha nenosiri',
    'Password must be at least 8 characters.':'Nenosiri lazima liwe na angalau herufi 8.',
    'Passwords do not match.':'Manenosiri hayalingani.',
    'Your email address':'Anwani yako ya barua pepe',
    "If that email exists, a reset link has been sent.":'Ikiwa barua pepe hiyo ipo, kiungo cha kuweka upya kimetumwa.',
    'Reset your password':'Weka upya nenosiri lako',
    "Enter your email address and we'll send a reset link.":'Ingiza anwani yako ya barua pepe na tutakutumia kiungo cha kuweka upya.',
    'Send reset link':'Tuma kiungo cha kuweka upya',

    // AI workspace
    'AI & Data Intelligence':'Akili Bandia na Ujasusi wa Data',
    "Turn the platform's accumulated data into faster answers and early warnings.":'Geuza data iliyokusanywa kwenye jukwaa kuwa majibu ya haraka na tahadhari za mapema.',
    'Staff assistant':'Msaidizi wa wafanyakazi',
    'Ask about programme data, draft reports, or request an operational summary.':'Uliza kuhusu data za programu, andaa rasimu za ripoti, au omba muhtasari wa uendeshaji.',
    '● Ready':'● Tayari',
    'Your question':'Swali lako',
    "e.g. Summarise this month's field submissions and flag anything unusual.":'mf. Fupisha uwasilishaji wa data za uwanjani wa mwezi huu na onyesha chochote kisicho cha kawaida.',
    'Ask assistant':'Uliza msaidizi',
    'Responses will appear here.':'Majibu yataonekana hapa.',
    'Intelligence centre':'Kituo cha ujasusi wa data',
    'Environmental & programme analysis':'Uchambuzi wa mazingira na programu',
    'Compare trends across submissions, sites, and programme areas.':'Linganisha mwenendo wa uwasilishaji, maeneo ya miradi na maeneo ya programu.',
    'Data-quality checks':'Ukaguzi wa ubora wa data',
    'Detect missing, inconsistent, or unexpected field values.':'Tambua thamani za sehemu zilizokosekana, zisizolingana au zisizotarajiwa.',
    'Field advisory recommendations':'Mapendekezo ya ushauri wa uwanjani',
    'Surface practical follow-up actions for programme teams.':'Onyesha hatua za vitendo za ufuatiliaji kwa timu za programu.',
    'Early-warning summary':'Muhtasari wa tahadhari za mapema',
    'Signals generated from currently available portal data.':'Viashiria vilivyotengenezwa kutoka data zinazopatikana sasa kwenye lango.',
    'Submission coverage':'Ufunikaji wa uwasilishaji',
    'No critical coverage issue detected in the current workspace.':'Hakuna tatizo kubwa la ufunikaji lililogunduliwa kwenye eneo hili la kazi.',
    'Review queue':'Foleni ya mapitio',
    'Use data-quality checks before approving recent submissions.':'Tumia ukaguzi wa ubora wa data kabla ya kuidhinisha uwasilishaji wa hivi karibuni.',
    'Next action':'Hatua inayofuata',
    'Ask the assistant to draft a programme update for stakeholders.':'Muombe msaidizi aandike rasimu ya sasisho la programu kwa wadau.',
    'Analysing your request…':'Inachambua ombi lako…',
    'Assistant':'Msaidizi',
    'Assistant preview':'Hakiki ya msaidizi',
    'No answer was returned.':'Hakuna jibu lililorudishwa.',
    'API unavailable':'API haipatikani',

    // Generic feedback / permissions
    'Invitation sent — check the API console for the dev email link.':'Mwaliko umetumwa — angalia console ya API kwa kiungo cha barua pepe cha maendeleo.',
    'Role updated.':'Jukumu limesasishwa.',
    'Role created.':'Jukumu limeundwa.',
    'User deactivated.':'Mtumiaji amezimwa.',
    'User reactivated.':'Mtumiaji amewashwa tena.',
    'User deleted.':'Mtumiaji amefutwa.',
    'Notification preferences saved.':'Mapendeleo ya arifa yamehifadhiwa.',
    'Submission recorded.':'Uwasilishaji umehifadhiwa.',
    'Submission deleted.':'Uwasilishaji umefutwa.',
    'MFA disabled.':'MFA imezimwa.',
    'MFA enabled!':'MFA imewashwa!',
    'You don\'t have permission to view this section. Contact your Foundation Admin to request access.':'Huna ruhusa ya kuona sehemu hii. Wasiliana na Msimamizi wa Foundation kuomba ufikiaji.',
  };

  const patternTranslations = [
    [/^Welcome back, (.+)\. (.+)\.$/, (_m, name, date) => `Karibu tena, ${name}. ${date}.`],
    [/^([0-9]+) accounts · ([0-9]+) active$/, (_m, total, active) => `${total} akaunti · ${active} zinazotumika`],
    [/^([0-9]+) roles · tick cells to grant a permission · click Save to apply$/, (_m, n) => `${n} majukumu · weka alama kwenye visanduku kutoa ruhusa · bofya Hifadhi kutekeleza`],
    [/^([0-9]+) new · ([0-9]+) total$/, (_m, n, total) => `${n} mpya · ${total} jumla`],
    [/^([0-9]+) of ([0-9]+) events$/, (_m, shown, total) => `${shown} kati ya ${total} matukio`],
    [/^✓ ([0-9]+) migrations applied$/, (_m, n) => `✓ Uhamishaji ${n} umetekelezwa`],
    [/^([0-9]+) migrations applied$/, (_m, n) => `Uhamishaji ${n} umetekelezwa`],
    [/^Permissions saved \(([0-9]+) granted\)\.$/, (_m, n) => `Ruhusa zimehifadhiwa (${n} zimetolewa).`],
    [/^Marked as (.+)\.$/, (_m, s) => `Imewekwa kuwa ${({read:'imesomwa', replied:'imejibiwa', archived:'imehifadhiwa', new:'mpya'})[s] || s}.`],
    [/^(.+) saved\.$/, (_m, key) => `${key} imehifadhiwa.`],
    [/^Request received: (.+)$/, (_m, q) => `Ombi limepokelewa: ${q}`],
    [/^Platform: Postgres \+ PostGIS · Migrations applied: (.+) · Public website ↗$/, (_m, n) => `Jukwaa: Postgres + PostGIS · Uhamishaji uliotekelezwa: ${n} · Tovuti ya umma ↗`],
    [/^Submission recorded \(confirmed as new\)\.$/, () => 'Uwasilishaji umehifadhiwa (umethibitishwa kuwa mpya).'],
    [/^No role yet$/, () => 'Bado hakuna jukumu'],
  ];

  function getOriginalText(node) {
    if (!originals.has(node)) originals.set(node, node.nodeValue || '');
    return originals.get(node);
  }

  function translateText(value) {
    if (currentLang === 'en') return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    if (sw[trimmed]) return value.replace(trimmed, sw[trimmed]);
    for (const [pattern, replacer] of patternTranslations) {
      const m = trimmed.match(pattern);
      if (m) return value.replace(trimmed, replacer(...m));
    }
    return value;
  }

  function translateAttributes(el) {
    const attributes = ['placeholder', 'aria-label', 'title'];
    if (!attributeOriginals.has(el)) attributeOriginals.set(el, {});
    const originalsForEl = attributeOriginals.get(el);
    for (const attr of attributes) {
      if (!el.hasAttribute(attr)) continue;
      if (!(attr in originalsForEl)) originalsForEl[attr] = el.getAttribute(attr);
      const original = originalsForEl[attr];
      const translated = translateText(original);
      if (el.getAttribute(attr) !== translated) el.setAttribute(attr, translated);
    }
  }

  function translateDocument() {
    document.documentElement.lang = currentLang;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const node of textNodes) {
      const original = getOriginalText(node);
      const translated = translateText(original);
      if (node.nodeValue !== translated) node.nodeValue = translated;
    }

    document.querySelectorAll('[placeholder],[aria-label],[title]').forEach(translateAttributes);

    const switcher = document.getElementById('kbx-language-switcher');
    if (switcher) {
      switcher.querySelectorAll('[data-kbx-lang]').forEach(btn => btn.classList.toggle('active', btn.dataset.kbxLang === currentLang));
      const label = switcher.querySelector('.kbx-language-label');
      if (label) label.textContent = currentLang === 'sw' ? 'Lugha' : 'Language';
    }

    const websiteUrl = document.querySelector('meta[name="website-url"]')?.content;
    if (websiteUrl) {
      document.querySelectorAll('.sb-brand-link').forEach(link => {
        link.href = withLang(websiteUrl, currentLang);
      });
    }

    try { localStorage.setItem(STORAGE_KEY, currentLang); } catch {}
  }

  function withLang(href, lang) {
    try {
      const absolute = new URL(href, location.href);
      absolute.searchParams.set('lang', valid(lang));
      return absolute.href;
    } catch {
      const sep = href.includes('?') ? '&' : '?';
      return `${href}${sep}lang=${encodeURIComponent(valid(lang))}`;
    }
  }

  function installSwitcher() {
    if (document.getElementById('kbx-language-switcher')) return;
    const el = document.createElement('div');
    el.id = 'kbx-language-switcher';
    el.innerHTML = `
      <span class="kbx-language-label">Language</span>
      <button type="button" data-kbx-lang="en" aria-label="English">EN</button>
      <button type="button" data-kbx-lang="sw" aria-label="Kiswahili">SW</button>`;
    el.querySelectorAll('[data-kbx-lang]').forEach(btn => {
      btn.addEventListener('click', () => setLanguage(btn.dataset.kbxLang));
    });
    document.body.appendChild(el);
  }

  function setLanguage(lang) {
    currentLang = valid(lang);
    try { localStorage.setItem(STORAGE_KEY, currentLang); } catch {}
    const url = new URL(location.href);
    url.searchParams.set('lang', currentLang);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    translateDocument();
    window.dispatchEvent(new CustomEvent('kabonix:languagechange', { detail: { lang: currentLang } }));
  }

  window.KabonixI18n = Object.freeze({
    get lang() { return currentLang; },
    setLanguage,
    t(value) { return currentLang === 'sw' ? translateText(String(value)) : String(value); },
    locale() { return currentLang === 'sw' ? 'sw-TZ' : 'en-GB'; },
    withLang,
  });

  // Translate alerts/confirms too, because these messages are not DOM nodes.
  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  window.alert = message => nativeAlert(window.KabonixI18n.t(String(message)));
  window.confirm = message => nativeConfirm(window.KabonixI18n.t(String(message)));

  const observeTarget = document.body;
  const observer = new MutationObserver(() => {
    installSwitcher();
    translateDocument();
  });
  // Observe structural DOM changes only. Watching characterData here creates a
  // feedback loop because translateDocument() itself changes text nodes; on a
  // large portal this can trigger repeated full-document scans and lock the UI.
  observer.observe(observeTarget, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { installSwitcher(); translateDocument(); }, { once: true });
  } else {
    installSwitcher();
    translateDocument();
  }
})();
