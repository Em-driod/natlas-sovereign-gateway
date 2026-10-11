import type { Tenant } from "../security/tenants.js";

export interface Feedback {
  ts: string;
  tenantId: string;
  name: string;
  rating: number;
  useCase: string;
  worked: string;
  improve: string;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const date = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "–");
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

/** Real-world validation page: external testers, their measured usage, and their feedback. */
export function betaEvidenceHtml(o: { testers: Tenant[]; feedback: Feedback[]; requestsByTenant: Record<string, number>; admin: boolean; host: string }): string {
  const byTenant = new Map<string, Feedback[]>();
  for (const f of o.feedback) byTenant.set(f.tenantId, [...(byTenant.get(f.tenantId) ?? []), f]);
  const visible = (t: Tenant) => o.admin || t.listPublicly;
  const label = (t: Tenant) => (visible(t) ? esc(t.name) + (t.org ? ` <span class="muted">· ${esc(t.org)}</span>` : "") : `<span class="muted">Tester ${esc(t.id.slice(-6))}</span>`);
  const active = o.testers.filter((t) => (o.requestsByTenant[t.id] ?? 0) > 0);
  const totalReq = o.testers.reduce((a, t) => a + (o.requestsByTenant[t.id] ?? 0), 0);
  const rated = o.feedback.filter((f) => f.tenantId !== "anonymous" || o.admin);
  const avg = rated.length ? (rated.reduce((a, f) => a + f.rating, 0) / rated.length).toFixed(1) : "–";

  const rows = o.testers
    .sort((a, b) => (o.requestsByTenant[b.id] ?? 0) - (o.requestsByTenant[a.id] ?? 0))
    .map((t) => {
      const fb = byTenant.get(t.id) ?? [];
      const best = fb[fb.length - 1];
      return `<tr><td>${label(t)}${o.admin && t.contact ? `<div class="muted small">${esc(t.contact)}</div>` : ""}</td><td>${esc(date(t.createdAt))}</td><td class="num">${o.requestsByTenant[t.id] ?? 0}</td><td>${best ? `<span class="stars">${stars(best.rating)}</span>` : '<span class="muted">–</span>'}</td></tr>`;
    })
    .join("") || `<tr><td colspan="4" class="muted">No testers yet. Share the Developers tab to invite them.</td></tr>`;

  const quotes = o.feedback
    .slice()
    .reverse()
    .map((f) => {
      const t = o.testers.find((x) => x.id === f.tenantId);
      const who = t ? label(t) : `<span class="muted">${o.admin ? esc(f.name) : "Anonymous tester"}</span>`;
      return `<div class="quote"><div class="row"><span class="stars">${stars(f.rating)}</span><span class="muted small">${esc(date(f.ts))}</span></div>
        ${f.useCase ? `<div class="small muted">Use case: ${esc(f.useCase)}</div>` : ""}
        ${f.worked ? `<p><b>What worked:</b> ${esc(f.worked)}</p>` : ""}
        ${f.improve ? `<p><b>What to improve:</b> ${esc(f.improve)}</p>` : ""}
        <div class="small">${who}</div></div>`;
    })
    .join("") || `<p class="muted">No feedback yet.</p>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Beta Evidence · N-ATLAS Gateway</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { --ink:#0f1a14; --muted:#6b7a71; --line:#e6ebe8; --green:#008751; --green-50:#ebf6f0; }
  * { box-sizing:border-box; } body { margin:0; background:#f6f8f7; color:var(--ink); font:14.5px/1.55 Inter, system-ui, sans-serif; }
  .page { max-width: 880px; margin: 28px auto; background:#fff; border:1px solid var(--line); border-radius:14px; padding: 40px 48px; }
  .brand { display:flex; gap:10px; align-items:center; font-weight:600; } .logo { width:28px; height:28px; border-radius:7px; background:var(--green); color:#fff; display:grid; place-items:center; font-weight:700; }
  h1 { font-size:24px; margin:22px 0 4px; letter-spacing:-.01em; } h2 { font-size:15px; margin:28px 0 10px; }
  .muted { color:var(--muted); } .small { font-size:12.5px; }
  .kpis { display:grid; grid-template-columns: repeat(4,1fr); gap:12px; margin-top:20px; } .kpi { border:1px solid var(--line); border-radius:10px; padding:14px; } .kpi b { display:block; font-size:24px; } .kpi span { font-size:12px; color:var(--muted); }
  table { width:100%; border-collapse:collapse; } td, th { padding:9px 6px; border-bottom:1px solid var(--line); text-align:left; } th { font-size:12px; color:var(--muted); font-weight:500; } .num { text-align:right; font-variant-numeric: tabular-nums; }
  .stars { color: var(--green); letter-spacing: 1px; } .quote { border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin-bottom:10px; } .quote p { margin:6px 0; }
  .row { display:flex; justify-content:space-between; gap:12px; align-items:center; }
  .note { background:var(--green-50); border-radius:10px; padding:12px 14px; margin-top:20px; font-size:13.5px; }
  a { color: var(--green); }
  @media (max-width:720px) { .page { margin:12px; padding:24px 18px; } .kpis { grid-template-columns: 1fr 1fr; } }
</style></head><body><div class="page">
  <div class="row"><div class="brand"><div class="logo">N</div>N-ATLAS Sovereign Gateway</div><a href="/">← Dashboard</a></div>
  <h1>Real-world validation</h1>
  <div class="muted">External developers who signed up for a sandbox key, what they actually ran through the gateway (from the audit trail), and what they told us.</div>
  <div class="kpis">
    <div class="kpi"><b>${o.testers.length}</b><span>testers with sandbox keys</span></div>
    <div class="kpi"><b>${active.length}</b><span>made at least one request</span></div>
    <div class="kpi"><b>${totalReq}</b><span>requests by testers</span></div>
    <div class="kpi"><b>${avg}</b><span>average rating (of 5)</span></div>
  </div>
  <h2>Testers</h2>
  <table><thead><tr><th>Tester</th><th>Joined</th><th class="num">Requests</th><th>Rating</th></tr></thead><tbody>${rows}</tbody></table>
  <h2>Feedback</h2>
  ${quotes}
  <div class="note">Usage counts come from the hash-chained audit trail, not self-reporting. Testers appear by name only if they chose to be listed. Personal data typed into feedback is redacted before it is stored.</div>
</div></body></html>`;
}
