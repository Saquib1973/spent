const { supabaseUrl, supabasePublishableKey } = window.SPENT_CONFIG;
const sb = window.supabase.createClient(supabaseUrl, supabasePublishableKey);

const $ = (id) => document.getElementById(id);
// Chart colours come from the CSS tokens, so they follow light/dark mode.
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const C = { ink: css('--ink'), lime: css('--accent'), green: '#22C55E', red: css('--red'), grid: css('--line'), muted: css('--ink-3') };
let days = 30;
let currency = 'USD';
const charts = {};

const money = (n, opts = {}) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2, ...opts }).format(n ?? 0);

Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
Chart.defaults.color = C.muted;
Chart.defaults.plugins.legend.display = false;
Chart.defaults.plugins.tooltip.backgroundColor = css('--pop');
Chart.defaults.plugins.tooltip.titleColor = C.muted;
Chart.defaults.plugins.tooltip.bodyColor = C.ink;
Chart.defaults.plugins.tooltip.borderColor = C.grid;
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 10;

function draw(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart($(id), { ...config, options: { responsive: true, maintainAspectRatio: false, ...config.options } });
}

const moneyAxis = { grid: { color: C.grid }, border: { display: false }, ticks: { callback: (v) => money(v, { maximumFractionDigits: 0 }) } };
const plainAxis = { grid: { display: false }, border: { display: false } };

// ---------- Auth ----------
async function showForSession(session) {
  $('auth').classList.toggle('hidden', !!session);
  $('dash').classList.toggle('hidden', !session);
  $('signout').classList.toggle('hidden', !session);
  if (session) {
    const name = session.user.user_metadata?.full_name || session.user.email.split('@')[0];
    $('hello').textContent = `Hello, ${name}!`;
    await load();
  }
}

$('auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $('auth-err').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
  if (error) $('auth-err').textContent = error.message;
});

$('signup').addEventListener('click', async () => {
  const f = new FormData($('auth-form'));
  if (!f.get('email') || String(f.get('password')).length < 6) {
    $('auth-err').textContent = 'Enter an email and a password of at least 6 characters.';
    return;
  }
  const { data, error } = await sb.auth.signUp({ email: f.get('email'), password: f.get('password') });
  $('auth-err').textContent = error ? error.message : data.session ? '' : 'Check your inbox to confirm your email, then sign in.';
});

$('signout').addEventListener('click', () => sb.auth.signOut());

$('range').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  days = Number(btn.dataset.days);
  [...$('range').children].forEach((b) => b.classList.toggle('on', b === btn));
  load();
});

sb.auth.onAuthStateChange((_event, session) => showForSession(session));

// ---------- Data ----------
async function load() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  const res = await fetch(`/api/analytics?days=${days}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
  const a = await res.json();
  if (!res.ok) {
    $('recent').innerHTML = `<div class="empty">${a.error ?? 'Could not load analytics'}</div>`;
    return;
  }
  render(a);
}

function pill(el, value, { invert = false, suffix = '' } = {}) {
  if (value == null) { el.textContent = 'no prior data'; el.className = 'pill'; return; }
  const good = invert ? value <= 0 : value >= 0;
  el.className = `pill ${good ? 'up' : 'down'}`;
  el.style.color = good ? C.green : C.red;
  el.textContent = `${value >= 0 ? '▲' : '▼'} ${Math.abs(value).toFixed(1)}%${suffix}`;
}

function render(a) {
  currency = a.currency;
  const t = a.totals;
  $('balance').textContent = money(t.balance);
  $('net').textContent = `${t.net >= 0 ? '+' : ''}${money(t.net)} net`;
  $('net').style.color = t.net >= 0 ? '#4ade80' : '#ff8a8a';
  $('spent').textContent = money(t.spent);
  $('range-label').textContent = `Last ${a.range.days} days`;
  pill($('change'), t.changeVsPrevious, { invert: true, suffix: ' vs prev' });
  $('earned').textContent = money(t.earned);
  $('avg').textContent = money(t.avgPerDay);
  $('savings').textContent = t.savingsRate == null ? '—' : `${t.savingsRate.toFixed(0)}%`;
  $('count').textContent = t.transactions;

  const { monthly: budget, spentThisMonth } = a.budget;
  const pct = budget ? Math.min(100, (spentThisMonth / budget) * 100) : 0;
  $('budget-left').textContent = money(Math.max(0, budget - spentThisMonth));
  $('budget-bar').style.width = `${pct}%`;
  $('budget-bar').style.background = pct > 90 ? '#ff6b6b' : '#22c55e';
  $('budget-note').textContent = `${money(spentThisMonth)} of ${money(budget)} used this month`;

  // Trend: bucket by week when range is long so the line stays readable.
  const series = a.range.days > 90 ? groupWeekly(a.daily) : a.daily;
  const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  draw('trend', {
    type: 'line',
    data: {
      labels: series.map((d) => fmtDay(d.date)),
      datasets: [
        { label: 'Spent', data: series.map((d) => d.expense), borderColor: C.lime, backgroundColor: 'rgba(37,99,235,.08)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2.5 },
        { label: 'Earned', data: series.map((d) => d.income), borderColor: C.green, tension: 0.4, pointRadius: 0, borderWidth: 2, borderDash: [5, 4] },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${money(c.raw)}` } } },
      scales: { x: { ...plainAxis, ticks: { maxTicksLimit: 8 } }, y: moneyAxis },
    },
  });

  const cats = a.byCategory.slice(0, 6);
  draw('cats', {
    type: 'doughnut',
    data: { labels: cats.map((c) => c.name), datasets: [{ data: cats.map((c) => c.total), backgroundColor: cats.map((c) => c.color), borderWidth: 3, borderColor: '#fff', borderRadius: 6 }] },
    options: { cutout: '68%', plugins: { tooltip: { callbacks: { label: (c) => ` ${money(c.raw)}` } } } },
  });
  $('cat-legend').innerHTML = cats.length
    ? cats.map((c) => `<li><i style="background:${c.color}"></i><span>${escapeHtml(c.name)}</span><span>${money(c.total)}</span></li>`).join('')
    : '<li>No expenses in this range</li>';

  draw('monthly', {
    type: 'bar',
    data: {
      labels: a.monthly.map((m) => new Date(m.month + '-01').toLocaleDateString(undefined, { month: 'short' })),
      datasets: [
        { label: 'Spent', data: a.monthly.map((m) => m.expense), backgroundColor: C.ink, borderRadius: 8, maxBarThickness: 22 },
        { label: 'Earned', data: a.monthly.map((m) => m.income), backgroundColor: C.green, borderRadius: 8, maxBarThickness: 22 },
      ],
    },
    options: { plugins: { legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10 } } }, scales: { x: plainAxis, y: moneyAxis } },
  });

  const maxDay = Math.max(...a.weekday);
  draw('weekday', {
    type: 'bar',
    data: {
      labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      datasets: [{ data: a.weekday, backgroundColor: a.weekday.map((v) => (v === maxDay && v > 0 ? C.lime : 'rgba(127,127,127,.28)')), borderRadius: 10, maxBarThickness: 34 }],
    },
    options: { plugins: { tooltip: { callbacks: { label: (c) => ` ${money(c.raw)}` } } }, scales: { x: plainAxis, y: moneyAxis } },
  });

  draw('merchants', {
    type: 'bar',
    data: { labels: a.topMerchants.map((m) => m.name), datasets: [{ data: a.topMerchants.map((m) => m.total), backgroundColor: C.ink, borderRadius: 8, maxBarThickness: 20 }] },
    options: { indexAxis: 'y', plugins: { tooltip: { callbacks: { label: (c) => ` ${money(c.raw)}` } } }, scales: { x: moneyAxis, y: plainAxis } },
  });

  $('recent').innerHTML = a.recent.length
    ? a.recent.map((tx) => `
        <div class="tx">
          <div class="dot" style="background:${tx.category?.color ?? '#E5E7EB'}">${escapeHtml((tx.category?.name ?? '?')[0])}</div>
          <div class="meta"><b>${escapeHtml(tx.merchant || tx.category?.name || 'Transaction')}</b><small>${escapeHtml(tx.category?.name ?? '')} · ${new Date(tx.occurred_at).toLocaleDateString()}</small></div>
          <div class="amt" style="color:${tx.kind === 'income' ? C.green : C.ink}">${tx.kind === 'income' ? '+' : '−'}${money(tx.amount)}</div>
        </div>`).join('')
    : '<div class="empty">No transactions yet — add some in the app.</div>';
}

function groupWeekly(daily) {
  const out = [];
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7);
    out.push({ date: chunk[0].date, expense: chunk.reduce((s, d) => s + d.expense, 0), income: chunk.reduce((s, d) => s + d.income, 0) });
  }
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
