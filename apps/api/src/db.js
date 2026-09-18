// db.js — Core Database & Migrations (Sprint 01, Step 2)
//
// Ported from the SQLite walking-skeleton to PostgreSQL + PostGIS, matching
// Section 5.2 of the architecture document. Requires the `pg` package
// (`npm install` in apps/api) and a reachable Postgres instance with the
// PostGIS extension enabled (see docs/postgres-setup.md).
//
// Connection is read from DATABASE_URL, e.g.:
//   postgresql://kabonix:ChangeMe123!@localhost:5432/kabonix_db

import pg from 'pg';

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL || 'postgresql://kabonix:ChangeMe123!@localhost:5432/kabonix_db';

export const pool = new Pool({ connectionString });

export async function seedIfEmpty({ hashPassword }) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM users');
  if (rows[0].c > 0) return;

  const roleSeed = [
    ['super_admin', 'Super Admin / IT', 'Full system control, security & configuration'],
    ['foundation_admin', 'Foundation Admin', 'Org-wide oversight, users, finance approval'],
    ['programme_director', 'Programme Director', 'Cross-programme strategy & reporting'],
    ['meal_officer', 'MEAL / Compliance Officer', 'Data quality, audit, donor compliance'],
    ['programme_manager', 'Programme Manager', 'Manage projects, budgets, teams'],
    ['field_officer', 'Field Officer', 'Collect & submit field data'],
    ['finance_admin', 'Finance & Admin Staff', 'Budgets, procurement, HR records'],
  ];

  const roleIds = {};
  for (const [key, name, description] of roleSeed) {
    await pool.query(
      'INSERT INTO roles (key, name, description) VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING',
      [key, name, description]
    );
    const { rows: rr } = await pool.query('SELECT id FROM roles WHERE key = $1', [key]);
    roleIds[key] = rr[0].id;
  }

  async function grant(roleKey, module, level) {
    await pool.query(
      'INSERT INTO permissions (role_id, module, level) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [roleIds[roleKey], module, level]
    );
  }

  const modules = ['admin', 'data_collection', 'programme_mgmt', 'community', 'blue_economy', 'carbon', 'ai_intelligence', 'website'];
  const levels = ['view', 'create', 'edit', 'approve', 'export'];
  for (const m of modules) for (const l of levels) await grant('super_admin', m, l);

  for (const l of ['view', 'create', 'edit']) await grant('field_officer', 'data_collection', l);

  for (const l of ['view', 'create', 'edit', 'approve']) await grant('programme_manager', 'programme_mgmt', l);
  await grant('programme_manager', 'data_collection', 'view');

  for (const l of ['view', 'export']) {
    await grant('meal_officer', 'data_collection', l);
    await grant('meal_officer', 'programme_mgmt', l);
  }
  await grant('meal_officer', 'data_collection', 'approve');

  for (const l of ['view', 'create', 'edit', 'approve']) await grant('foundation_admin', 'admin', l);

  const { hash, salt } = hashPassword('ChangeMe123!');
  const insertUser = async (name, email) => {
    // Seeded accounts are pre-verified (they didn't go through the registration
    // flow) and start with MFA off — each user turns it on for themselves.
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, password_salt, email_verified_at)
       VALUES ($1, $2, $3, $4, now()) RETURNING id`,
      [name, email, hash, salt]
    );
    return rows[0].id;
  };
  const adminId = await insertUser('Kabonix Super Admin', 'admin@kabonix.org');
  const fieldId = await insertUser('Amina Field Officer', 'amina@kabonix.org');

  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [adminId, roleIds.super_admin]);
  await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [fieldId, roleIds.field_officer]);

  await pool.query(
    'INSERT INTO me_forms (key, title, description, schema_json) VALUES ($1, $2, $3, $4)',
    [
      'household_baseline',
      'Household Baseline Survey',
      'Basic beneficiary registration and baseline indicator capture, offline-first (Section 3, Data Collection & M&E module).',
      JSON.stringify([
        { id: 'beneficiary_name', label: 'Beneficiary full name', type: 'text', required: true },
        { id: 'village', label: 'Village', type: 'text', required: true },
        { id: 'programme_area', label: 'Programme area', type: 'select', options: ['Blue Economy', 'Climate-smart Agriculture', 'Renewable Energy', 'Youth & Women Entrepreneurship'], required: true },
        { id: 'household_size', label: 'Household size', type: 'number', required: true },
        { id: 'gps_lat', label: 'GPS latitude', type: 'number', required: false },
        { id: 'gps_lng', label: 'GPS longitude', type: 'number', required: false },
        { id: 'notes', label: 'Notes', type: 'textarea', required: false },
      ]),
    ]
  );

  // ---- Website seed content ----
  const postSeed = [
    {
      type: 'news', slug: 'kabonix-launches-digital-platform', published: true,
      title_en: 'Kabonix Foundation Launches Digital Ecosystem Platform',
      title_sw: 'Kabonix Foundation Inazindua Mfumo wa Dijitali wa Ikolojia',
      summary_en: 'The Kabonix Foundation today unveiled its new integrated digital platform to collect, manage and act on climate, blue-economy and community-development data.',
      summary_sw: 'Kabonix Foundation leo imefungua mfumo mpya wa dijitali iliyounganishwa wa kukusanya, kusimamia na kutenda kwa data ya hali ya hewa, uchumi wa bluu na maendeleo ya jamii.',
      body_en: 'The platform brings together field data collection, programme management, carbon MRV and community engagement into a single professionally-operated system. It supports bilingual workflows in English and Kiswahili and operates fully offline for remote coastal and rural sites.',
      body_sw: 'Mfumo huu unaunganisha ukusanyaji wa data ya shamba, usimamizi wa programu, MRV ya kaboni na ushirikiano wa jamii katika mfumo mmoja unaoendeshwa kwa ufundi. Unasaidia mtiririko wa kazi katika lugha mbili — Kiingereza na Kiswahili — na unafanya kazi bila mtandao katika maeneo ya pwani na vijijini.',
    },
    {
      type: 'news', slug: 'mangrove-restoration-milestone', published: true,
      title_en: '1,200 Hectares of Mangrove Restored Along the Tanzanian Coast',
      title_sw: 'Hekta 1,200 za Mikoko Zimerejeshwa Pwani ya Tanzania',
      summary_en: 'Field teams have verified the successful restoration of over 1,200 hectares of mangrove habitat across three coastal districts, sequestering an estimated 48,000 tonnes of CO₂-equivalent.',
      summary_sw: 'Timu za shamba zimethibitisha urejeshaji wa mafanikio wa zaidi ya hekta 1,200 za makazi ya mikoko katika wilaya tatu za pwani, ikihifadhi tani 48,000 za CO₂-sawa.',
      body_en: 'The restoration work, carried out in partnership with local fishing communities in Kilwa, Lindi and Mtwara, represents the largest single mangrove intervention in the Foundation\'s history. GIS plot boundaries have been submitted for third-party MRV verification.',
      body_sw: 'Kazi ya urejeshaji, iliyofanywa kwa ushirikiano na jamii za uvuvi wa pwani huko Kilwa, Lindi na Mtwara, inawakilisha uingiliaji mkubwa zaidi wa mikoko katika historia ya Mfuko.',
    },
    {
      type: 'event', slug: 'blue-economy-forum-2026', published: true,
      title_en: 'Tanzania Blue Economy Forum 2026',
      title_sw: 'Jukwaa la Uchumi wa Bluu la Tanzania 2026',
      summary_en: 'Kabonix Foundation will present findings from its coastal programme area at the annual Blue Economy Forum in Dar es Salaam, bringing together government, NGOs and private-sector partners.',
      summary_sw: 'Kabonix Foundation itawasilisha matokeo kutoka eneo lake la programu ya pwani katika Jukwaa la kila mwaka la Uchumi wa Bluu huko Dar es Salaam.',
      body_en: 'The Forum brings together over 200 practitioners, policymakers and investors to share evidence and align on national blue-economy priorities. Kabonix will present the integrated MRV data collected across its mangrove, fisheries and aquaculture sites.',
      body_sw: 'Jukwaa hilo linaunganisha wataalamu, watunga sera na wawekezaji zaidi ya 200 kushiriki ushahidi na kuelewana kuhusu vipaumbele vya kitaifa vya uchumi wa bluu.',
      event_date: '2026-11-14', event_venue: 'Julius Nyerere International Convention Centre, Dar es Salaam',
    },
    {
      type: 'publication', slug: 'blue-carbon-baseline-report-2025', published: true,
      title_en: 'Blue Carbon Baseline Assessment — Tanzania Coastal Zone 2025',
      title_sw: 'Tathmini ya Msingi ya Kaboni ya Bluu — Ukanda wa Pwani wa Tanzania 2025',
      summary_en: 'A comprehensive baseline assessment of blue carbon stocks across Kabonix programme sites, prepared for submission to the Tanzania Carbon Registry and Article 6 counterpart arrangements.',
      summary_sw: 'Tathmini ya kina ya msingi ya hifadhi za kaboni ya bluu katika maeneo ya programu ya Kabonix, iliyoandaliwa kwa ajili ya uwasilishaji kwa Usajili wa Kaboni wa Tanzania.',
      body_en: 'This report presents the results of systematic field measurement and satellite-verified GIS boundary mapping across 28 project sites covering mangrove, seagrass and coastal wetland ecosystems.',
      body_sw: 'Ripoti hii inawasilisha matokeo ya upimaji wa utaratibu wa shamba na uwekaji ramani wa mipaka ya GIS iliyothibitishwa na setilaiti katika tovuti 28 za mradi.',
      doc_url: '#',
    },
  ];

  for (const p of postSeed) {
    await pool.query(
      `INSERT INTO posts (type,slug,title_en,title_sw,summary_en,summary_sw,body_en,body_sw,event_date,event_venue,doc_url,published,published_at,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,CASE WHEN $12 THEN now() ELSE NULL END,$13)
       ON CONFLICT (slug) DO NOTHING`,
      [p.type,p.slug,p.title_en,p.title_sw,p.summary_en,p.summary_sw,p.body_en||'',p.body_sw||'',
       p.event_date||null,p.event_venue||null,p.doc_url||null,p.published,adminId]
    );
  }

  const storySeed = [
    {
      slug:'amina-cooperative', programme:'Youth & Women Entrepreneurship', location:'Bagamoyo, Pwani Region',
      metric_label:'Women trained', metric_value:'340', published: true,
      title_en:'340 Women Entrepreneurs Trained in Coastal Aquaculture',
      title_sw:'Wajasiriamali 340 wa Kike Wamefunzwa katika Ufugaji wa Viumbe vya Baharini',
      body_en:'Through the Foundation\'s women\'s cooperative programme in Bagamoyo, 340 women received business-skills and aquaculture training, establishing 12 new cooperatives now generating sustainable income from seaweed and shellfish farming.',
      body_sw:'Kupitia programu ya ushirika wa wanawake ya Mfuko huko Bagamoyo, wanawake 340 walipata mafunzo ya ujuzi wa biashara na ufugaji wa viumbe vya baharini, wakianzisha ushirika 12 mpya ambao sasa unazalisha kipato endelevu.',
    },
    {
      slug:'kilwa-mangrove-carbon', programme:'Blue Economy', location:'Kilwa Masoko, Lindi Region',
      metric_label:'CO₂-eq sequestered (tonnes)', metric_value:'48,000', published: true,
      title_en:'Kilwa Mangrove Carbon Project Achieves Verification Milestone',
      title_sw:'Mradi wa Kaboni ya Mikoko wa Kilwa Unafikia Hatua ya Uthibitisho',
      body_en:'The Kilwa Mangrove Carbon Project has completed its first full MRV cycle, with 48,000 tonnes of CO₂-equivalent verified by an accredited third-party auditor and submitted to the Tanzania Carbon Registry for credit issuance.',
      body_sw:'Mradi wa Kaboni ya Mikoko wa Kilwa umekamilisha mzunguko wake wa kwanza kamili wa MRV, na tani 48,000 za CO₂-sawa zimethibitishwa na mkaguzi huru aliyeidhinishwa.',
    },
    {
      slug:'youth-renewable-energy', programme:'Renewable Energy', location:'Dodoma Region',
      metric_label:'Households with solar access', metric_value:'1,850', published: true,
      title_en:'Youth-Led Solar Initiative Brings Power to 1,850 Rural Households',
      title_sw:'Mpango wa Nishati ya Jua Unaoongozwa na Vijana Unaleta Umeme kwa Kaya 1,850 Vijijini',
      body_en:'Young engineers trained under the Kabonix green-entrepreneurship programme have installed solar home systems for 1,850 households across remote villages in Dodoma Region, creating 60 permanent local jobs in installation and maintenance.',
      body_sw:'Wahandisi vijana waliofunzwa chini ya programu ya ujasiriamali wa kijani wa Kabonix wameweka mifumo ya nishati ya jua ya nyumbani kwa kaya 1,850 katika vijiji vya mbali huko Dodoma.',
    },
  ];
  for (const s of storySeed) {
    await pool.query(
      `INSERT INTO impact_stories (slug,title_en,title_sw,body_en,body_sw,programme,location,metric_label,metric_value,published,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (slug) DO NOTHING`,
      [s.slug,s.title_en,s.title_sw,s.body_en,s.body_sw,s.programme,s.location,s.metric_label,s.metric_value,s.published,adminId]
    );
  }

  const partnerSeed = [
    { name:'UNDP Tanzania', type:'partner', display_order:1, description_en:'United Nations Development Programme — joint Blue Economy and climate adaptation programming.', description_sw:'Mpango wa Maendeleo wa Umoja wa Mataifa — programu za pamoja za Uchumi wa Bluu na kukabiliana na hali ya hewa.' },
    { name:'Government of Tanzania — MNRT', type:'government', display_order:2, description_en:'Ministry of Natural Resources and Tourism — national partner for coastal and forest carbon programmes.', description_sw:'Wizara ya Maliasili na Utalii — mshirika wa kitaifa wa mipango ya kaboni ya pwani na misitu.' },
    { name:'Blue Carbon Initiative', type:'partner', display_order:3, description_en:'Technical and standards partner for mangrove MRV methodology and carbon credit issuance.', description_sw:'Mshirika wa kiufundi na viwango kwa mbinu ya MRV ya mikoko na utoaji wa mikopo ya kaboni.' },
    { name:'East Africa Green Fund', type:'donor', display_order:4, description_en:'Primary funding partner for the youth renewable energy and women\'s entrepreneurship programmes.', description_sw:'Mshirika mkuu wa ufadhili wa programu za nishati jadidifu ya vijana na ujasiriamali wa wanawake.' },
  ];
  for (const p of partnerSeed) {
    await pool.query(
      `INSERT INTO partners (name,type,display_order,description_en,description_sw) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [p.name,p.type,p.display_order,p.description_en,p.description_sw]
    );
  }

  // Seed notification preferences for both accounts
  for (const uid of [adminId, fieldId]) {
    await pool.query(
      'INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
      [uid]
    );
  }

  console.log('Seeded database with roles, permissions, 2 users, 1 M&E form, and website content.');
  console.log('Login: admin@kabonix.org / amina@kabonix.org  —  password: ChangeMe123!');
}
