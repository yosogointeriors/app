/* ============================================================================
   YOSOGO shared data layer — Supabase + Cloudflare Worker edition
   ----------------------------------------------------------------------------
   PUBLIC_TABLES are read directly from Supabase using the anon key (governed
   by the RLS policies in schema.sql) and kept in an in-memory cache with
   realtime sync, so YS.all()/YS.find() stay synchronous everywhere in the UI
   code — none of the render functions in the 4 portals needed to change.

   ACCOUNT DATA (admin_accounts, team_accounts, customer_accounts) is never
   fetched by the browser. Login, OTP, and new-customer provisioning all go
   through the Cloudflare Worker, which holds the Supabase service_role key
   as a secret and is the only thing allowed to read/write those tables
   (see schema.sql's RLS policies and worker/src/index.js).
   ============================================================================ */
const YS = (function () {
  const cfg = window.YOSOGO_CONFIG || {};
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR-PROJECT-REF')) {
    console.warn('[YOSOGO] config.js is still using placeholder values — set SUPABASE_URL / SUPABASE_ANON_KEY / WORKER_URL before deploying.');
  }
  const supa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const PUBLIC_TABLES = [
    'leads', 'lead_notes',
    'projects', 'project_stages', 'stage_photos',
    'design_files', 'quotations',
    'payment_milestones', 'payments',
    'catalog_materials', 'payment_settings', 'team_profiles'
  ];

  const DEFAULT_STAGES = [
    'Site Measurement', 'Design Finalization', 'Booking & Advance',
    'Material Procurement', 'Production (Factory)', 'Quality Check',
    'Delivery to Site', 'Installation', 'Final Handover'
  ];

  const _cache = {};
  PUBLIC_TABLES.forEach(t => { _cache[t] = []; });

  let _readyResolve;
  const _readyPromise = new Promise(res => { _readyResolve = res; });
  let _onChange = () => {};

  async function init() {
    await Promise.all(PUBLIC_TABLES.map(async (table) => {
      const { data, error } = await supa.from(table).select('*');
      if (error) { console.error('[YOSOGO] load failed for', table, error.message); return; }
      _cache[table] = data || [];
    }));

    // Realtime: keep every open portal/tab in sync as data changes anywhere.
    PUBLIC_TABLES.forEach(table => {
      supa.channel('public:' + table)
        .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
          const list = _cache[table];
          if (payload.eventType === 'INSERT') {
            if (!list.find(r => r.id === payload.new.id)) list.push(payload.new);
          } else if (payload.eventType === 'UPDATE') {
            const i = list.findIndex(r => r.id === payload.new.id);
            if (i > -1) list[i] = payload.new; else list.push(payload.new);
          } else if (payload.eventType === 'DELETE') {
            _cache[table] = list.filter(r => r.id !== payload.old.id);
          }
          _onChange();
        })
        .subscribe();
    });

    _readyResolve();
  }

  function ready() { return _readyPromise; }
  function onChange(fn) { _onChange = fn; }

  // Force a re-fetch of one table — useful right after a Worker call writes
  // to a table the browser can't write to directly (e.g. team_profiles),
  // so the UI doesn't have to wait on the realtime event to catch up.
  async function refresh(table) {
    const { data, error } = await supa.from(table).select('*');
    if (error) { console.error('[YOSOGO] refresh failed for', table, error.message); return; }
    _cache[table] = data || [];
  }

  function all(table) { return (_cache[table] || []).slice(); }
  function find(table, id) { return (_cache[table] || []).find(r => r.id === id) || null; }

  async function insert(table, row) {
    const { data, error } = await supa.from(table).insert(row).select().single();
    if (error) { console.error('[YOSOGO] insert failed on', table, error.message); throw error; }
    if (!_cache[table].find(r => r.id === data.id)) _cache[table].push(data);
    return data;
  }

  async function update(table, id, patch) {
    const { data, error } = await supa.from(table).update(patch).eq('id', id).select().single();
    if (error) { console.error('[YOSOGO] update failed on', table, error.message); throw error; }
    const i = _cache[table].findIndex(r => r.id === id);
    if (i > -1) _cache[table][i] = data; else _cache[table].push(data);
    return data;
  }

  async function remove(table, id) {
    const { error } = await supa.from(table).delete().eq('id', id);
    if (error) { console.error('[YOSOGO] delete failed on', table, error.message); throw error; }
    _cache[table] = _cache[table].filter(r => r.id !== id);
  }

  // Called when a lead is marked "booked" — creates the project, seeds its
  // 9 stages, and asks the Worker to provision the customer's portal login.
  async function createProjectFromLead(lead, extra) {
    extra = extra || {};
    const project = await insert('projects', Object.assign({
      lead_id: lead.id,
      project_name: (lead.name || 'Customer') + ' — ' + (lead.bhk || '') + ' ' + (lead.project_type || ''),
      project_type: lead.project_type,
      city: lead.city,
      address: '',
      designer_id: lead.assigned_to || null,
      site_manager_id: null,
      partner_id: lead.partner_id || null,
      total_value: 0,
      current_stage_order: 1,
      status: 'active',
      start_date: new Date().toISOString().slice(0, 10)
    }, extra));

    await Promise.all(DEFAULT_STAGES.map((name, i) => insert('project_stages', {
      project_id: project.id, stage_order: i + 1, stage_name: name,
      status: i === 0 ? 'in_progress' : 'pending', planned_date: null, completed_date: null, remarks: ''
    })));

    if (lead.phone) {
      try {
        const { pin } = await setCustomerPin({ project_id: project.id, name: lead.name, phone: lead.phone });
        project._generatedPin = pin; // transient, not persisted — for the caller to show/share once
      }
      catch (e) { console.warn('[YOSOGO] customer portal login could not be auto-created — you can generate a PIN manually from the project.', e); }
    }
    return project;
  }

  // ── Worker-backed calls: anything touching passwords, OTP, or secrets ──────
  async function workerFetch(path, body) {
    if (!cfg.WORKER_URL || cfg.WORKER_URL.includes('YOUR-SUBDOMAIN')) {
      throw new Error('WORKER_URL is not configured in config.js yet.');
    }
    const res = await fetch(cfg.WORKER_URL.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }

  // type: 'admin' | 'team'
  function login(type, email, password) { return workerFetch('/api/login', { type, email, password }); }
  function customerLogin(phone, pin) { return workerFetch('/api/customer/login', { phone, pin }); }
  function setCustomerPin({ project_id, name, phone, pin }) { return workerFetch('/api/customer/set-pin', { project_id, name, phone, pin }); }
  function createTeamMember({ name, email, phone, role, city }) { return workerFetch('/api/team/create', { name, email, phone, role, city }); }
  function updateTeamMember({ id, name, email, phone, role, city }) { return workerFetch('/api/team/update', { id, name, email, phone, role, city }); }
  function resetTeamPassword(id, password) { return workerFetch('/api/team/reset-password', { id, password }); }
  function toggleTeamMember(id) { return workerFetch('/api/team/toggle', { id }); }

  return {
    init, ready, onChange, refresh,
    all, find, insert, update, remove,
    createProjectFromLead, DEFAULT_STAGES,
    login, customerLogin, setCustomerPin,
    createTeamMember, updateTeamMember, resetTeamPassword, toggleTeamMember
  };
})();
