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
    'catalog_materials', 'payment_settings', 'team_profiles', 'quotation_catalog',
    'client_checklist_items', 'floor_plans'
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

  // Uploads a file (e.g. an offline quotation PDF/Excel) to Supabase Storage
  // and returns its public URL. `bucket` must already exist with an anon
  // insert policy (see schema.sql — 'quotation-files' is set up by default).
  async function uploadFile(bucket, file) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
    const { error } = await supa.storage.from(bucket).upload(path, file);
    if (error) { console.error('[YOSOGO] file upload failed', error.message); throw error; }
    const { data } = supa.storage.from(bucket).getPublicUrl(path);
    return { url: data.publicUrl, name: file.name };
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
  function createTeamMember({ name, email, phone, roles, city }) { return workerFetch('/api/team/create', { name, email, phone, roles, city }); }
  function updateTeamMember({ id, name, email, phone, roles, city }) { return workerFetch('/api/team/update', { id, name, email, phone, roles, city }); }
  function resetTeamPassword(id, password) { return workerFetch('/api/team/reset-password', { id, password }); }
  function toggleTeamMember(id) { return workerFetch('/api/team/toggle', { id }); }
  function analyzeFloorPlan(floor_plan_id) { return workerFetch('/api/floorplan/analyze', { floor_plan_id }); }

  // Renders a print-ready HTML quotation document (matches the letterhead
  // format in Settings) — used by both the Admin and CRM portals to
  // download/print a quotation built with the calculator. Opens in a new
  // tab; the person uses the browser's Print dialog → "Save as PDF" to
  // download it, or prints it directly to send.
  function renderQuotationHTML(quotation, lead, settings, isPreview) {
    settings = settings || {};
    const items = quotation.items || [];
    const created = new Date(quotation.created_at);
    const validUpto = new Date(created.getTime() + 21 * 86400000);
    const fmtDate = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }).replace(/\//g, '-');
    const quoteNo = 'Q-' + quotation.id.slice(0, 8).toUpperCase();

    // Group items by category (room), ordered to match the Client
    // Requirement Checklist's room order — categories not in that canonical
    // list (custom/legacy ones) fall in afterward, in the order they first
    // appeared in this quotation.
    const CANONICAL_ROOM_ORDER = ['Foyer/Entrance','Living Room','Dining','Kitchen','Crockery Unit','Pooja Unit','Master Bedroom','Bedroom 2','Bedroom 3 / Kids Room','Study/Home Office','Bathroom','Balcony/Utility','Home Theatre'];
    const grouped = {};
    const firstSeenOrder = [];
    items.forEach(it => {
      const cat = it.category || 'Other';
      if (!grouped[cat]) { grouped[cat] = []; firstSeenOrder.push(cat); }
      grouped[cat].push(it);
    });
    const categoryOrder = firstSeenOrder.slice().sort((a, b) => {
      const ia = CANONICAL_ROOM_ORDER.indexOf(a), ib = CANONICAL_ROOM_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return firstSeenOrder.indexOf(a) - firstSeenOrder.indexOf(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });

    let rowNum = 0;
    const rows = categoryOrder.map(cat => {
      const catItems = grouped[cat];
      const catTotal = catItems.reduce((s, it) => s + Number(it.amount || 0), 0);
      const itemRows = catItems.map(it => {
        rowNum++;
        return `
      <tr>
        <td class="no">${rowNum}</td>
        <td class="item"><b>${it.item || ''}</b>${it.material_spec ? `<div class="desc">${it.material_spec}</div>` : ''}${it.note ? `<div class="item-note">Note: ${it.note}</div>` : ''}</td>
        <td class="num">${it.length || ''}</td>
        <td class="num">${it.height || ''}</td>
        <td class="num">${it.unit_type === 'lump' ? 'Lum' : (it.qty ? Number(it.qty).toFixed(1) : '')}</td>
        <td class="num">${it.rate || ''}</td>
        <td class="num total">${Number(it.amount || 0).toLocaleString('en-IN')}</td>
      </tr>`;
      }).join('');
      return `
      <tr class="cat-header"><td colspan="7">${cat.toUpperCase()}</td></tr>
      ${itemRows}
      <tr class="cat-subtotal"><td colspan="6" style="text-align:right;">${cat} Total</td><td class="num">₹${catTotal.toLocaleString('en-IN')}</td></tr>`;
    }).join('');

    const termsList = (settings.quotation_terms || '').split('\n').filter(Boolean)
      .map(line => `<li>${line.replace(/^\d+\.\s*/, '')}</li>`).join('');
    const paymentList = (settings.payment_terms_text || '').split('\n').filter(Boolean)
      .map(line => `<li>${line}</li>`).join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Quotation — ${lead ? lead.name : ''}</title>
<style>
  @page { margin: 18mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #241A12; margin: 0; font-size: 12.5px; line-height: 1.45; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; background: #EFEAE0; padding: 16px 18px; border: 1px solid #d8cfba; }
  .header img { height: 46px; }
  .header .title { font-size: 22px; font-weight: 700; letter-spacing: 2px; align-self: center; }
  .header .company { text-align: right; font-size: 11px; line-height: 1.5; }
  .header .company b { font-size: 12.5px; }
  .metabar { display: flex; justify-content: space-between; background: #F6F2E9; border: 1px solid #d8cfba; border-top: none; padding: 8px 18px; font-size: 11.5px; }
  .client { padding: 10px 18px; border: 1px solid #d8cfba; border-top: none; font-size: 12.5px; }
  table { width: 100%; border-collapse: collapse; margin-top: 0; }
  th { background: #EFEAE0; border: 1px solid #d8cfba; padding: 6px 8px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; text-align: left; }
  td { border: 1px solid #e5ddc8; padding: 7px 8px; vertical-align: top; font-size: 11.5px; }
  td.no { text-align: center; width: 28px; color: #6E5F84; }
  td.num { text-align: right; white-space: nowrap; }
  td.total { font-weight: 700; }
  .desc { color: #7a6f5c; font-size: 10px; margin-top: 2px; }
  .item-note { color: #8A5B0B; font-size: 10px; margin-top: 2px; font-style: italic; }
  .cat-header td { background: #E4DAC4; border: 1px solid #d8cfba; font-weight: 700; font-size: 11px; letter-spacing: .05em; padding: 6px 8px; }
  .cat-subtotal td { border: none; border-bottom: 1px solid #e5ddc8; font-size: 11px; color: #6E5F84; padding: 4px 8px 10px; }
  .subtotal td { border: none; padding-top: 8px; font-size: 12px; }
  .grandtotal td { border: none; border-top: 2px solid #241A12; font-weight: 700; font-size: 13.5px; padding-top: 8px; }
  .section-title { font-weight: 700; margin: 18px 0 6px; font-size: 12.5px; }
  ol, ul { margin: 0; padding-left: 18px; }
  li { margin-bottom: 4px; font-size: 10.5px; }
  .gst-note { margin-top: 14px; font-size: 10.5px; font-style: italic; color: #6E5F84; }
  .preview-banner { background: #A3352B; color: #fff; text-align: center; padding: 8px; font-size: 12px; font-weight: 700; letter-spacing: .04em; margin-bottom: 10px; border-radius: 6px; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
  ${isPreview ? `<div class="preview-banner">⚠ PREVIEW ONLY — NOT YET SENT TO CUSTOMER</div>` : ''}
  <div class="header">
    <img src="logo.png" alt="Logo"/>
    <div class="title">QUOTATION</div>
    <div class="company">
      <b>${settings.company_name || 'Your Company Name'}</b><br/>
      ${settings.gstin ? `GSTIN ${settings.gstin}<br/>` : ''}
      ${(settings.company_address || '').split(',').join(',<br/>')}
    </div>
  </div>
  <div class="metabar">
    <span>Quotation No. ${quoteNo}</span>
    <span>Quotation Date: ${fmtDate(created)}</span>
    <span>Valid date upto: ${fmtDate(validUpto)}</span>
  </div>
  <div class="client"><b>Client</b><br/>${lead ? lead.name : ''}</div>
  <table>
    <thead><tr><th>No</th><th>Items</th><th>Length</th><th>Height</th><th>Qty/sqft</th><th>Rate</th><th>Total</th></tr></thead>
    <tbody>
      ${rows}
      <tr class="subtotal"><td colspan="6" style="text-align:right;">SUBTOTAL</td><td class="num">₹${Number(quotation.subtotal_amount ?? quotation.total_amount ?? 0).toLocaleString('en-IN')}</td></tr>
      ${quotation.discount_percent ? `<tr class="subtotal"><td colspan="6" style="text-align:right;">DISCOUNT (${quotation.discount_percent}%)</td><td class="num">−₹${(Number(quotation.subtotal_amount||0) - Number(quotation.total_amount||0)).toLocaleString('en-IN')}</td></tr>` : ''}
      <tr class="grandtotal"><td colspan="6" style="text-align:right;">TOTAL</td><td class="num">₹${Number(quotation.total_amount || 0).toLocaleString('en-IN')}</td></tr>
    </tbody>
  </table>
  ${quotation.notes ? `<div class="section-title">Quotation Notes</div><p style="font-size:11px;white-space:pre-line;margin:0 0 8px;">${quotation.notes}</p>` : ''}
  ${termsList ? `<div class="section-title">Terms &amp; Conditions</div><ol>${termsList}</ol>` : ''}
  ${paymentList ? `<div class="section-title">Payment Terms</div><ul>${paymentList}</ul>` : ''}
  <div class="gst-note">Note: All rates are exclusive of GST @ 18%, which will be charged extra as applicable.</div>
  <div class="no-print" style="margin-top:24px;text-align:center;">
    <button onclick="window.print()" style="padding:10px 20px;font-size:14px;cursor:pointer;">🖨️ Print / Save as PDF</button>
  </div>
</body></html>`;
  }

  return {
    init, ready, onChange, refresh,
    all, find, insert, update, remove, uploadFile,
    createProjectFromLead, DEFAULT_STAGES,
    login, customerLogin, setCustomerPin,
    createTeamMember, updateTeamMember, resetTeamPassword, toggleTeamMember, analyzeFloorPlan,
    renderQuotationHTML
  };
})();
