// Translation Dictionary
const translations = {
  en: {
    top_identity: "Public Identity & Transparency",
    top_partner: "Partner With Us →",
    nav_about: "About",
    nav_programmes: "Programmes",
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
    about_title: "Our Programmes & Focus Areas",
    about_sub: "Kabonix Foundation is dedicated to climate resilience and the sustainable blue economy. We work hand-in-hand with communities to create lasting impact.",
    card_climate_title: "Climate Action",
    card_climate_desc: "Implementing projects that mitigate climate change and build resilient ecosystems.",
    card_climate_link: "Explore Programmes →",
    card_blue_title: "Blue Economy",
    card_blue_desc: "Promoting sustainable use of ocean resources for economic growth and improved livelihoods.",
    card_blue_link: "Explore Programmes →",
    card_gov_title: "Governance & Transparency",
    card_gov_desc: "Ensuring accountability to our donors, partners, and the communities we serve.",
    card_gov_link: "View Our Impact →",
    impact_kicker: "Impact Stories",
    impact_title: "Results Highlights",
    impact_sub: "Real numbers. Real change. See how your support translates into measurable impact.",
    impact_1_title: "Households Empowered",
    impact_1_desc: "Tracked across community and livelihood improvement programmes.",
    impact_2_title: "CO₂e Tonnes Reduced",
    impact_2_desc: "Carbon and ecosystem impact measured through monitored project reporting.",
    impact_3_title: "Project Sites",
    impact_3_desc: "Mapped and managed through integrated site-level monitoring workflows.",
    news_kicker: "News & Events",
    news_title: "Latest Updates & Publications",
    news_sub: "Stay informed about our latest projects, upcoming events, and published reports.",
    news_tag_1: "Press Release",
    news_1_title: "Kabonix Launches New Blue Economy Initiative",
    news_1_date: "📅 October 2026",
    news_tag_2: "Upcoming Event",
    news_2_title: "Annual Donor & Partner Appreciation Gala",
    news_2_date: "📅 November 15, 2026",
    news_tag_3: "Publication",
    news_3_title: "2025 Annual Impact & Transparency Report",
    news_3_date: "📄 Download PDF",
    partners_kicker: "Partners & Donors",
    partners_title: "Recognition & Collaboration",
    partners_sub: "We are grateful for the support of our partners and donors who make our work possible.",
    partner_1: "🌍 Global Climate Fund",
    partner_2: "🏛️ Ministry of Environment",
    partner_3: "🌊 Blue Ocean Alliance",
    partner_4: "🤝 Community Trust",
    cta_title: "Partner with Kabonix Foundation.",
    cta_sub: "Contact us to discuss how we can work together for a sustainable future.",
    cta_btn: "Contact Us",
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
    programmes_back: "← Back",
    programmes_title: "Our Programme Areas",
    programmes_sub: "Programmes the Kabonix Foundation works on.",
    programmes_blue_title: "Blue Economy & Climate",
    programmes_blue_desc: "Blue carbon, mangrove restoration, sustainable fisheries and aquaculture.",
    programmes_carbon_title: "Carbon & Environmental Data",
    programmes_carbon_desc: "Carbon project registry, GIS plot mapping, MRV workflows and carbon accounting.",
    programmes_agri_title: "Climate-smart Agriculture",
    programmes_agri_desc: "Supporting smallholder farmers with climate-adaptive practices and soil health monitoring.",
    language_label: "Language"
  },
  sw: {
    top_identity: "Utambulisho wa Umma na Uwazi",
    top_partner: "Shirikiana Nasi →",
    nav_about: "Kuhusu",
    nav_programmes: "Programu",
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
    about_title: "Programu Zetu na Maeneo ya Kipaumbele",
    about_sub: "Kabonix Foundation imejitolea kwa ustahimilivu wa hali ya hewa na uchumi endelevu wa bluu. Tunafanya kazi bega kwa bega na jamii kuunda athari ya kudumu.",
    card_climate_title: "Hatua za Hali ya Hewa",
    card_climate_desc: "Kutekeleza miradi inayopunguza mabadiliko ya hali ya hewa na kujenga mifumo ikolojia imara.",
    card_climate_link: "Chunguza Programu →",
    card_blue_title: "Uchumi wa Bluu",
    card_blue_desc: "Kukuza matumizi endelevu ya rasilimali za bahari kwa ukuaji wa uchumi na maisha bora.",
    card_blue_link: "Chunguza Programu →",
    card_gov_title: "Utawala na Uwazi",
    card_gov_desc: "Kuhakikisha uwajibikaji kwa wafadhili wetu, washirika, na jamii tunazohudumia.",
    card_gov_link: "Tazama Athari Zetu →",
    impact_kicker: "Hadithi za Athari",
    impact_title: "Mambo Muhimu ya Matokeo",
    impact_sub: "Nambari halisi. Mabadiliko halisi. Tazama jinsi msaada wako unavyogeuka kuwa athari inayoweza kupimwa.",
    impact_1_title: "Kaya Zilizowezeshwa",
    impact_1_desc: "Inafuatiliwa katika programu za uboreshaji wa jamii na maisha.",
    impact_2_title: "Tani za CO₂e Zilizopunguzwa",
    impact_2_desc: "Athari za kaboni na mifumo ikolojia hupimwa kupitia ripoti za miradi inayofuatiliwa.",
    impact_3_title: "Maeneo ya Miradi",
    impact_3_desc: "Yamechorwa na kusimamiwa kupitia mitiririko jumuishi ya ufuatiliaji wa maeneo.",
    news_kicker: "Habari na Matukio",
    news_title: "Habari na Machapisho ya Hivi Karibuni",
    news_sub: "Kaa na habari kuhusu miradi yetu ya hivi karibuni, matukio yajayo, na ripoti zilizochapishwa.",
    news_tag_1: "Tangazo la Vyombo vya Habari",
    news_1_title: "Kabonix Yazindua Mpango Mpya wa Uchumi wa Bluu",
    news_1_date: "📅 Oktoba 2026",
    news_tag_2: "Tukio Linalokuja",
    news_2_title: "Gala ya Kila Mwaka ya Kuwathamini Wafadhili na Washirika",
    news_2_date: "📅 Novemba 15, 2026",
    news_tag_3: "Chapisho",
    news_3_title: "Ripoti ya Athari na Uwazi ya Mwaka 2025",
    news_3_date: "📄 Pakua PDF",
    partners_kicker: "Washirika na Wafadhili",
    partners_title: "Utambuzi na Ushirikiano",
    partners_sub: "Tunashukuru kwa msaada wa washirika na wafadhili wetu ambao hufanya kazi yetu iwezekane.",
    partner_1: "🌍 Mfuko wa Kimataifa wa Hali ya Hewa",
    partner_2: "🏛️ Wizara ya Mazingira",
    partner_3: "🌊 Muungano wa Bahari ya Bluu",
    partner_4: "🤝 Trust ya Jamii",
    cta_title: "Shirikiana na Kabonix Foundation.",
    cta_sub: "Wasiliana nasi ili kujadili jinsi tunaweza kufanya kazi pamoja kwa mustakabali endelevu.",
    cta_btn: "Wasiliana Nasi",
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
    programmes_back: "← Rudi",
    programmes_title: "Maeneo ya Programu Zetu",
    programmes_sub: "Programu ambazo Kabonix Foundation inatekeleza.",
    programmes_blue_title: "Uchumi wa Bluu na Hali ya Hewa",
    programmes_blue_desc: "Kaboni ya bluu, urejeshaji wa mikoko, uvuvi endelevu na ufugaji wa viumbe vya majini.",
    programmes_carbon_title: "Data za Kaboni na Mazingira",
    programmes_carbon_desc: "Usajili wa miradi ya kaboni, uchoraji wa maeneo kwa GIS, mitiririko ya MRV na uhasibu wa kaboni.",
    programmes_agri_title: "Kilimo Kinachozingatia Hali ya Hewa",
    programmes_agri_desc: "Kuwasaidia wakulima wadogo kwa mbinu zinazokabiliana na mabadiliko ya hali ya hewa na ufuatiliaji wa afya ya udongo.",
    language_label: "Lugha"
  }
};

const queryLang = new URLSearchParams(window.location.search).get('lang');
let currentLang = (queryLang === 'sw' || queryLang === 'en') ? queryLang : (localStorage.getItem('kabonix_lang') || 'en');

function withLang(href, lang = currentLang) {
  try {
    const url = new URL(href, window.location.href);
    url.searchParams.set('lang', lang === 'sw' ? 'sw' : 'en');
    return url.href;
  } catch {
    const separator = href.includes('?') ? '&' : '?';
    return `${href}${separator}lang=${encodeURIComponent(lang)}`;
  }
}

function updatePortalLinks() {
  const configuredPortal = document.querySelector('meta[name="portal-url"]')?.content;
  if (!configuredPortal) return;
  document.querySelectorAll('.portal-link').forEach(link => {
    link.href = withLang(configuredPortal);
  });
}

function setLanguage(lang) {
  currentLang = (lang === 'sw') ? 'sw' : 'en';
  localStorage.setItem('kabonix_lang', currentLang);
  document.documentElement.lang = currentLang;
  const titleNode = document.querySelector('title[data-i18n]');
  if (titleNode) titleNode.textContent = translations[currentLang]?.[titleNode.dataset.i18n] || titleNode.textContent;
  const url = new URL(window.location.href);
  url.searchParams.set('lang', currentLang);
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  
  // Update toggle button states
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });

  // Update all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[lang] && translations[lang][key]) {
      // Handle placeholder attributes for inputs
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
}

document.addEventListener('DOMContentLoaded', () => {
  // Initialize language
  setLanguage(currentLang);

  // Intersection Observer for Scroll Animations
  const reveals = document.querySelectorAll('.reveal');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: "0px 0px -50px 0px"
  });

  reveals.forEach(reveal => observer.observe(reveal));

  // Portals Dropdown Logic
  const toggleBtn = document.getElementById('portal-toggle');
  const menu = document.getElementById('portal-menu');

  if (toggleBtn && menu) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('show');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!toggleBtn.contains(e.target) && !menu.contains(e.target)) {
        menu.classList.remove('show');
      }
    });
  }

  updatePortalLinks();
});