// Aggregates a user's transactions into the numbers the web dashboard charts.

const DAY = 24 * 60 * 60 * 1000;
const dayKey = (d) => d.toISOString().slice(0, 10);
const monthKey = (d) => d.toISOString().slice(0, 7);

export function buildAnalytics({ transactions, categories, profile, days }) {
  const now = new Date();
  const start = new Date(now.getTime() - (days - 1) * DAY);
  start.setUTCHours(0, 0, 0, 0);
  const prevStart = new Date(start.getTime() - days * DAY);

  const catById = new Map(categories.map((c) => [c.id, c]));
  const inRange = transactions.filter((t) => new Date(t.occurred_at) >= start);
  const inPrev = transactions.filter((t) => {
    const d = new Date(t.occurred_at);
    return d >= prevStart && d < start;
  });

  const sum = (rows, kind) => rows.filter((t) => t.kind === kind).reduce((a, t) => a + Number(t.amount), 0);
  const spent = sum(inRange, 'expense');
  const earned = sum(inRange, 'income');
  const prevSpent = sum(inPrev, 'expense');

  // Daily series for the selected range
  const daily = new Map();
  for (let i = 0; i < days; i++) daily.set(dayKey(new Date(start.getTime() + i * DAY)), { expense: 0, income: 0 });
  for (const t of inRange) {
    const bucket = daily.get(dayKey(new Date(t.occurred_at)));
    if (bucket) bucket[t.kind] += Number(t.amount);
  }

  // Last 6 months, regardless of range
  const monthly = new Map();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    monthly.set(monthKey(d), { expense: 0, income: 0 });
  }
  for (const t of transactions) {
    const bucket = monthly.get(monthKey(new Date(t.occurred_at)));
    if (bucket) bucket[t.kind] += Number(t.amount);
  }

  const byCategory = new Map();
  for (const t of inRange.filter((t) => t.kind === 'expense')) {
    const cat = catById.get(t.category_id) ?? { name: 'Uncategorised', color: '#94A3B8' };
    const row = byCategory.get(cat.name) ?? { name: cat.name, color: cat.color, total: 0, count: 0 };
    row.total += Number(t.amount);
    row.count += 1;
    byCategory.set(cat.name, row);
  }

  const byMerchant = new Map();
  for (const t of inRange.filter((t) => t.kind === 'expense')) {
    const key = t.merchant || 'Unknown';
    byMerchant.set(key, (byMerchant.get(key) ?? 0) + Number(t.amount));
  }

  // Weekday pattern (Mon..Sun)
  const weekday = Array(7).fill(0);
  for (const t of inRange.filter((t) => t.kind === 'expense')) {
    weekday[(new Date(t.occurred_at).getUTCDay() + 6) % 7] += Number(t.amount);
  }

  const balance =
    Number(profile?.opening_balance ?? 0) + sum(transactions, 'income') - sum(transactions, 'expense');
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthSpent = sum(
    transactions.filter((t) => new Date(t.occurred_at) >= monthStart),
    'expense',
  );

  return {
    range: { days, start: start.toISOString(), end: now.toISOString() },
    currency: profile?.currency ?? 'USD',
    totals: {
      balance: round(balance),
      spent: round(spent),
      earned: round(earned),
      net: round(earned - spent),
      avgPerDay: round(spent / days),
      changeVsPrevious: prevSpent ? round(((spent - prevSpent) / prevSpent) * 100) : null,
      savingsRate: earned ? round(((earned - spent) / earned) * 100) : null,
      transactions: inRange.length,
    },
    budget: {
      monthly: Number(profile?.monthly_budget ?? 0),
      spentThisMonth: round(monthSpent),
    },
    daily: [...daily].map(([date, v]) => ({ date, expense: round(v.expense), income: round(v.income) })),
    monthly: [...monthly].map(([month, v]) => ({ month, expense: round(v.expense), income: round(v.income) })),
    byCategory: [...byCategory.values()].map((c) => ({ ...c, total: round(c.total) })).sort((a, b) => b.total - a.total),
    topMerchants: [...byMerchant]
      .map(([name, total]) => ({ name, total: round(total) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5),
    weekday: weekday.map(round),
    recent: [...transactions]
      .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
      .slice(0, 8)
      .map((t) => ({ ...t, category: catById.get(t.category_id) ?? null })),
  };
}

const round = (n) => Math.round(n * 100) / 100;
