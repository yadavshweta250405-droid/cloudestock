import { h, fmt, mount, badge, table, formModal, toast, modal } from '../ui/dom.js';
import { api } from '../api.js';
import { ROLES, ROLE_LABELS, DEPARTMENTS } from '/shared/constants.js';
import { pageHead, btn, tabs, load, attempt } from './common.js';

// Multi-tenant initial seeded client companies
const DEFAULT_COMPANIES = [
  {
    id: 'cmp-01',
    code: 'CMP-APX-01',
    name: 'Apex Pharma Logistics',
    director: 'David Park',
    directorEmail: 'david.park@pharma.com',
    plan: 'Enterprise Cold-Chain',
    ambientPallets: 14,
    coldPallets: 8,
    activeWorkers: 6,
    managers: [
      { name: 'Priya Nair', dept: 'Receiving', email: 'priya.nair@pharma.com' },
      { name: 'Elena Petrova', dept: 'Inventory', email: 'elena.petrova@pharma.com' },
      { name: 'Aisha Khan', dept: 'Cold Storage', email: 'aisha.khan@pharma.com' }
    ]
  },
  {
    id: 'cmp-02',
    code: 'CMP-FST-02',
    name: 'FreshHarvest Cold Chain',
    director: 'Sarah Connor',
    directorEmail: 's.connor@freshharvest.io',
    plan: 'Riverside Hub Cold Storage',
    ambientPallets: 4,
    coldPallets: 12,
    activeWorkers: 4,
    managers: [
      { name: 'Klaus Fischer', dept: 'Cold Storage', email: 'klaus@freshharvest.io' },
      { name: 'Marco Silva', dept: 'Shipping', email: 'marco@freshharvest.io' }
    ]
  },
  {
    id: 'cmp-03',
    code: 'CMP-MET-03',
    name: 'Metro Retail Hub',
    director: 'Michael Chang',
    directorEmail: 'm.chang@metroretail.com',
    plan: 'High-Bay Ambient Storage',
    ambientPallets: 22,
    coldPallets: 0,
    activeWorkers: 5,
    managers: [
      { name: 'Robert Chen', dept: 'Inventory', email: 'robert@metroretail.com' }
    ]
  }
];

function getStoredCompanies() {
  try {
    const raw = localStorage.getItem('waretrack_client_companies');
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.error('Failed reading client companies:', err);
  }
  return DEFAULT_COMPANIES;
}

function saveCompanies(list) {
  try {
    localStorage.setItem('waretrack_client_companies', JSON.stringify(list));
  } catch (err) {
    console.error('Failed writing client companies:', err);
  }
}

export async function render(root, app) {
  let activeTab = 'companies';
  const content = h('div');

  const userForm = async (u) => {
    const emps = (await api.get('/employees')).items;
    formModal({
      title: u ? `Edit ${u.name}` : 'New user',
      submitLabel: u ? 'Save' : 'Create user',
      initial: u || {},
      fields: [
        { name: 'name', label: 'Name', required: true, half: true },
        { name: 'email', label: 'Email', type: 'email', required: true, half: true },
        { name: 'role', label: 'Role', type: 'select', required: true, half: true, options: Object.values(ROLES).map((r) => ({ value: r, label: ROLE_LABELS[r] })) },
        { name: 'employeeId', label: 'Linked employee', type: 'select', numeric: true, nullEmpty: true, half: true, options: [{ value: '', label: 'None' }, ...emps.map((e) => ({ value: e.id, label: `${e.code} · ${e.name}` }))], help: 'Needed for employees to work on their own tasks.' },
        { name: 'password', label: u ? 'New password (leave empty to keep)' : 'Password', type: 'password', required: !u, help: 'At least 8 characters with a letter and a number.' }
      ].concat(u ? [{ name: 'active', label: 'Account active', type: 'checkbox' }] : []),
      onSubmit: async (v, m) => {
        if (u && !v.password) delete v.password;
        u ? await api.patch(`/users/${u.id}`, v) : await api.post('/users', v);
        m.close();
        toast(u ? 'User updated' : 'User created', '', 'success');
        refresh();
      }
    });
  };

  const showCredentialsModal = (title, details) => {
    modal({
      title,
      content: h('div', { style: { padding: '8px 0' } },
        h('p', { class: 'muted', style: { marginBottom: '14px' } }, 'Hand this onboarding credentials card to the client or employee. No public signup needed:'),
        h('div', { style: { background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.6' } },
          Object.entries(details).map(([k, v]) => h('div', null, h('span', { class: 'muted' }, `${k}: `), h('b', null, String(v))))
        ),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' } },
          btn('Copy Credentials Packet', () => {
            const text = Object.entries(details).map(([k, v]) => `${k}: ${v}`).join('\n');
            navigator.clipboard?.writeText(text);
            toast('Credentials copied to clipboard', '', 'success');
          }, { kind: 'primary', ic: 'copy' })
        )
      )
    });
  };

  const provisionCompanyModal = () => {
    formModal({
      title: 'Provision Client Company & Director ID (Tier 1 -> Tier 2)',
      submitLabel: 'Provision Company & Credentials',
      fields: [
        { name: 'name', label: 'Company Name', required: true, placeholder: 'e.g. BioMed Logistics Pvt Ltd' },
        { name: 'plan', label: 'Storage Plan', type: 'select', required: true, options: [
          { value: 'Enterprise Dual-Hub (Ambient + Cold)', label: 'Enterprise Dual-Hub (Ambient + Cold)' },
          { value: 'Riverside Hub Cold Chain Only', label: 'Riverside Hub Cold Chain Only' },
          { value: 'WareTrack Ambient High-Bay Only', label: 'WareTrack Ambient High-Bay Only' }
        ], value: 'Enterprise Dual-Hub (Ambient + Cold)' },
        { name: 'director', label: 'Client Director Name', required: true, half: true, placeholder: 'e.g. Rajesh Kumar' },
        { name: 'directorEmail', label: 'Director Email (Login ID)', type: 'email', required: true, half: true, placeholder: 'e.g. rajesh@biomed.com' },
        { name: 'password', label: 'Director Master Password', type: 'password', required: true, value: 'Director@2026', help: 'Provide this password to the client company director.' }
      ],
      onSubmit: async (v, m) => {
        const companies = getStoredCompanies();
        const code = `CMP-${v.name.slice(0, 3).toUpperCase()}-${String(companies.length + 1).padStart(2, '0')}`;
        const newCmp = {
          id: `cmp-${Date.now()}`,
          code,
          name: v.name,
          director: v.director,
          directorEmail: v.directorEmail,
          plan: v.plan,
          ambientPallets: 8,
          coldPallets: 6,
          activeWorkers: 2,
          managers: []
        };
        companies.unshift(newCmp);
        saveCompanies(companies);

        // Also create a user account for the director if not existing
        try {
          await api.post('/users', {
            name: v.director,
            email: v.directorEmail,
            role: ROLES.WAREHOUSE_MANAGER,
            password: v.password
          });
        } catch (e) {
          console.warn('Director user registration note:', e.message);
        }

        m.close();
        toast('Client Company Provisioned', `${v.name} is now active.`, 'success');
        refresh();

        showCredentialsModal(`Client Handover Packet: ${v.name}`, {
          'Client Company': v.name,
          'Company Code': code,
          'Storage Plan': v.plan,
          'Director Login ID': v.directorEmail,
          'Initial Password': v.password,
          'Access Portal': window.location.origin + '/#/',
          'Privileges': 'Director Tier (Can create department managers and manage stock)'
        });
      }
    });
  };

  const provisionManagerModal = (company) => {
    formModal({
      title: `Provision Department Manager for ${company.name} (Tier 2 -> Tier 3)`,
      submitLabel: 'Create Manager ID',
      fields: [
        { name: 'name', label: 'Manager Name', required: true, half: true, placeholder: 'e.g. Anil Sharma' },
        { name: 'dept', label: 'Assigned Department', type: 'select', required: true, half: true, options: DEPARTMENTS.filter(d => d !== 'Management').map(d => ({ value: d, label: d })), value: 'Receiving' },
        { name: 'email', label: 'Manager Email (Login ID)', type: 'email', required: true, half: true, placeholder: 'e.g. anil.receiving@company.com' },
        { name: 'password', label: 'Manager Password', type: 'password', required: true, value: 'Manager@2026' }
      ],
      onSubmit: async (v, m) => {
        const companies = getStoredCompanies();
        const target = companies.find(c => c.id === company.id);
        if (target) {
          if (!target.managers) target.managers = [];
          target.managers.push({ name: v.name, dept: v.dept, email: v.email });
          saveCompanies(companies);
        }

        try {
          await api.post('/users', {
            name: v.name,
            email: v.email,
            role: ROLES.INVENTORY_MANAGER,
            password: v.password
          });
        } catch (e) {
          console.warn('Manager user creation note:', e.message);
        }

        m.close();
        toast('Department Manager Provisioned', `${v.name} assigned to ${v.dept}`, 'success');
        refresh();

        showCredentialsModal(`Manager Credentials: ${v.name}`, {
          'Company': company.name,
          'Department': v.dept,
          'Manager Name': v.name,
          'Login Email': v.email,
          'Temporary Password': v.password,
          'Privileges': `${v.dept} operations, task assignment & ground worker badge issuance`
        });
      }
    });
  };

  const issueWorkerBadgeModal = (company) => {
    formModal({
      title: `Issue Ground Worker Badge & PIN for ${company.name} (Tier 3)`,
      submitLabel: 'Issue Badge & Spawn in 3D',
      fields: [
        { name: 'name', label: 'Worker Full Name', required: true, half: true, placeholder: 'e.g. Vikram Singh' },
        { name: 'department', label: 'Department', type: 'select', required: true, half: true, options: DEPARTMENTS.filter(d => d !== 'Management').map(d => ({ value: d, label: d })), value: 'Picking' },
        { name: 'jobTitle', label: 'Job Role / Equipment', half: true, placeholder: 'e.g. Pallet Truck Operator' },
        { name: 'pin', label: 'Handheld Scanner PIN (4-Digits)', half: true, required: true, value: String(Math.floor(1000 + Math.random() * 9000)) }
      ],
      onSubmit: async (v, m) => {
        let createdEmp = null;
        try {
          createdEmp = await api.post('/employees', {
            name: v.name,
            department: v.department,
            jobTitle: v.jobTitle || 'Ground Worker'
          });
        } catch (err) {
          console.warn('Worker post note:', err.message);
        }

        const companies = getStoredCompanies();
        const target = companies.find(c => c.id === company.id);
        if (target) {
          target.activeWorkers = (target.activeWorkers || 0) + 1;
          saveCompanies(companies);
        }

        m.close();
        toast('Worker Spawned in 3D', `${v.name} is walking out of the office to ${v.department}.`, 'success');
        refresh();

        showCredentialsModal(`Ground Worker Badge: ${v.name}`, {
          'Company': company.name,
          'Worker Name': v.name,
          'Badge ID': createdEmp?.code || `EMP-${Math.floor(100 + Math.random() * 899)}`,
          'Assigned Department': v.department,
          'Handheld Terminal PIN': v.pin,
          '3D Live Status': 'Spawned at Office Door & Active on Floor'
        });
      }
    });
  };

  async function paintTab() {
    if (activeTab === 'companies') {
      const companies = getStoredCompanies();
      return h('div', null,
        h('div', { class: 'card', style: { marginBottom: '16px', background: 'linear-gradient(135deg, rgba(47,91,214,0.06), rgba(16,185,129,0.04))', border: '1px solid rgba(47,91,214,0.18)', padding: '16px' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' } },
            h('div', null,
              h('div', { style: { fontSize: '16px', fontWeight: 700 } }, 'Multi-Tenant Client Companies & Delegated Access'),
              h('div', { class: 'muted', style: { fontSize: '13px', marginTop: '4px' } }, 'You (Platform Owner) provision Director credentials. Directors create Department Managers, who then issue worker badges.')
            ),
            btn('Provision Client Company & Director', provisionCompanyModal, { kind: 'primary', ic: 'plus' })
          )
        ),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' } },
          companies.map(c => h('div', { class: 'card', style: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', border: '1px solid var(--border)' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
              h('div', null,
                h('span', { class: 'mono muted', style: { fontSize: '11px', letterSpacing: '0.05em' } }, c.code),
                h('div', { style: { fontSize: '16px', fontWeight: 700, marginTop: '2px' } }, c.name),
                h('div', { style: { fontSize: '12px', color: '#0284c7', marginTop: '2px' } }, c.plan)
              ),
              badge('Active Subscriber', 'green')
            ),
            h('div', { style: { background: 'var(--panel)', padding: '10px 12px', borderRadius: '6px', fontSize: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } },
              h('div', null, h('div', { class: 'muted' }, 'Client Director:'), h('b', null, c.director)),
              h('div', null, h('div', { class: 'muted' }, 'Director Email:'), h('span', { class: 'mono' }, c.directorEmail)),
              h('div', null, h('div', { class: 'muted' }, 'Storage Quota:'), h('span', null, `${c.ambientPallets} Amb / ${c.coldPallets} Cold`)),
              h('div', null, h('div', { class: 'muted' }, '3D Workers:'), h('b', { style: { color: '#10b981' } }, `${c.activeWorkers} on floor`))
            ),
            h('div', null,
              h('div', { style: { fontSize: '12px', fontWeight: 600, marginBottom: '6px' } }, `Department Managers (${c.managers?.length || 0}):`),
              c.managers && c.managers.length > 0
                ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                    c.managers.map(m => h('span', { class: 'badge', style: { fontSize: '11px', padding: '3px 8px' } }, `${m.name} (${m.dept})`))
                  )
                : h('span', { class: 'muted', style: { fontSize: '12px' } }, 'No department managers provisioned yet.')
            ),
            h('div', { style: { display: 'flex', gap: '8px', marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' } },
              btn('+ Dept Manager', () => provisionManagerModal(c), { sm: true, ic: 'user' }),
              btn('+ Issue Worker Badge', () => issueWorkerBadgeModal(c), { sm: true, kind: 'primary', ic: 'id' }),
              btn('Credentials Packet', () => showCredentialsModal(`Credentials: ${c.name}`, {
                'Company': c.name,
                'Code': c.code,
                'Director': c.director,
                'Login Email': c.directorEmail,
                'Portal URL': window.location.origin + '/#/',
                'Active Workers': `${c.activeWorkers} spawned in 3D`
              }), { sm: true, ic: 'share' })
            )
          ))
        )
      );
    }

    if (activeTab === 'hierarchy') {
      return h('div', null,
        h('div', { class: 'card', style: { padding: '20px', lineHeight: '1.6' } },
          h('h3', { style: { margin: '0 0 12px 0' } }, 'Private 3-Tier Cascading ID/Password Provisioning Workflow'),
          h('p', { class: 'muted', style: { marginBottom: '20px' } },
            'No random or unverified public signup. Security, storage billing, and compliance require strict cryptographic and role-based provisioning from the platform owner down to ground staff.'
          ),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' } },
            h('div', { style: { border: '1px solid #3b82f6', borderRadius: '8px', padding: '16px', background: 'rgba(59,130,246,0.04)' } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } },
                badge('Tier 1', 'blue'),
                h('b', { style: { fontSize: '15px' } }, 'Master Platform Owner (You)')
              ),
              h('p', { style: { fontSize: '13px', margin: '0 0 8px 0' } }, 'You own WareTrack WH-01 and Riverside Hub WH-02. When a company signs a contract:'),
              h('ul', { style: { fontSize: '12px', paddingLeft: '18px', margin: 0 } },
                h('li', null, 'Provision Client Company record & storage quota'),
                h('li', null, 'Create Director ID and initial temporary password'),
                h('li', null, 'Hand over secure access packet to Client Company Director')
              )
            ),
            h('div', { style: { border: '1px solid #10b981', borderRadius: '8px', padding: '16px', background: 'rgba(16,185,129,0.04)' } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } },
                badge('Tier 2', 'green'),
                h('b', { style: { fontSize: '15px' } }, 'Client Company Director')
              ),
              h('p', { style: { fontSize: '13px', margin: '0 0 8px 0' } }, 'Director logs in to their isolated dashboard:'),
              h('ul', { style: { fontSize: '12px', paddingLeft: '18px', margin: 0 } },
                h('li', null, 'Views their company pallet storage, invoices, and fleet'),
                h('li', null, 'Provisions Department Managers (Receiving, Cold Hub, Shipping, Inventory)'),
                h('li', null, 'Issues role credentials to department leads')
              )
            ),
            h('div', { style: { border: '1px solid #f59e0b', borderRadius: '8px', padding: '16px', background: 'rgba(245,158,11,0.04)' } },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } },
                badge('Tier 3', 'amber'),
                h('b', { style: { fontSize: '15px' } }, 'Department Managers & Ground Workers')
              ),
              h('p', { style: { fontSize: '13px', margin: '0 0 8px 0' } }, 'Department Managers manage day-to-day warehouse operations:'),
              h('ul', { style: { fontSize: '12px', paddingLeft: '18px', margin: 0 } },
                h('li', null, 'Issue Worker Badge IDs and 4-digit handheld terminal PINs'),
                h('li', null, 'Newly added workers immediately spawn in 3D at the office door'),
                h('li', null, 'Assign tasks (picking, receiving, cold chain transfer, loading)')
              )
            )
          )
        )
      );
    }

    // Default 'users' tab
    const users = (await api.get('/users')).items;
    return table({
      rows: users,
      columns: [
        { label: 'Name', render: (u) => h('b', null, u.name) },
        { label: 'Email', key: 'email' },
        { label: 'Role', render: (u) => badge(ROLE_LABELS[u.role], 'blue') },
        { label: 'Status', render: (u) => badge(u.active ? 'active' : 'disabled', u.active ? 'green' : 'red') },
        { label: 'Last sign-in', render: (u) => fmt.ago(u.lastLoginAt) },
        { label: '', actions: true, render: (u) => btn('Edit', () => userForm(u), { sm: true, ic: 'edit' }) }
      ]
    });
  }

  const refresh = async () => {
    try {
      mount(content, await paintTab());
    } catch (e) {
      mount(content, h('div', { class: 'card empty' }, e.message));
    }
  };

  const paintAll = () => {
    mount(
      root,
      pageHead(
        'Multi-Tenant Access & Role Management',
        '3-Tier ID/Password Provisioning (Platform Owner -> Company Director -> Department Managers -> Ground Workers)',
        activeTab === 'users' ? btn('New user', () => userForm(null), { kind: 'primary', ic: 'plus' }) : null
      ),
      tabs(
        [
          ['companies', 'Client Companies & Subscriptions'],
          ['users', 'System User Accounts'],
          ['hierarchy', '3-Tier ID Delegation Hierarchy']
        ],
        activeTab,
        (t) => {
          activeTab = t;
          paintAll();
          refresh();
        }
      ),
      h('div', { style: { height: '14px' } }),
      content
    );
  };

  paintAll();
  await load(content, paintTab);
  void attempt;
  return { refresh };
}
