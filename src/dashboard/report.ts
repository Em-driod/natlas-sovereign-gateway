import type { AuditLog } from "../audit/audit-log.js";

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const n = (x: number) => x.toLocaleString("en-NG");

const PII_LABELS: Record<string, string> = {
  BVN: "Bank Verification Numbers", NIN: "National Identification Numbers", PHONE: "Phone numbers",
  EMAIL: "Email addresses", CARD: "Payment cards", ACCOUNT: "Bank account numbers (NUBAN)",
  GPS: "GPS coordinates (coarsened)", ADDRESS: "Street addresses (coarsened)", NAME: "Person names", ID: "Other 11-digit identifiers",
};

/** Printable NDPA compliance report built from the hash-chained audit trail. */
export function complianceReportHtml(audit: AuditLog, host: string): string {
  const s = audit.summarize();
  const v = audit.verify();
  const totalPii = Object.values(s.redactions).reduce((a, b) => a + b, 0);
  const blocked = s.outcomes.blocked_injection ?? 0;
  const generated = new Date();
  const reportId = `NSG-${generated.toISOString().slice(0, 10).replace(/-/g, "")}-${s.lastHash.slice(0, 8) || "empty"}`;
  const fmtDate = (iso: string) => (iso ? new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "–");

  const piiRows = Object.entries(s.redactions)
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => `<tr><td>${esc(PII_LABELS[k] ?? k)}</td><td class="mono">${esc(k)}</td><td class="num">${n(c)}</td></tr>`)
    .join("") || `<tr><td colspan="3" class="muted">No personal data was submitted in this period.</td></tr>`;

  const ruleRows = Object.entries(s.injectionRules)
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => `<tr><td class="mono">${esc(k)}</td><td class="num">${n(c)}</td></tr>`)
    .join("") || `<tr><td colspan="2" class="muted">No attacks were blocked in this period.</td></tr>`;

  const outcomeRows = Object.entries(s.outcomes)
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => `<tr><td>${esc(k.replace(/_/g, " "))}</td><td class="num">${n(c)}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NDPA Compliance Report · ${esc(reportId)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root { --ink:#0f1a14; --muted:#5b6b62; --line:#e4eae6; --green:#008751; --green-50:#eaf6ef; --red:#c2410c; --bg:#fff; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f5f7f6; color:var(--ink); font:14px/1.55 Inter, system-ui, sans-serif; }
  .page { max-width: 820px; margin: 32px auto; background: var(--bg); border: 1px solid var(--line); border-radius: 14px; padding: 48px 56px; }
  .top { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; border-bottom: 2px solid var(--green); padding-bottom: 20px; }
  .brand { display:flex; gap:10px; align-items:center; font-weight:600; }
  .logo { width:28px; height:28px; border-radius:7px; background:var(--green); color:#fff; display:grid; place-items:center; font-weight:700; font-size:14px; }
  h1 { font-size: 24px; margin: 22px 0 4px; letter-spacing:-.01em; }
  h2 { font-size: 15px; margin: 32px 0 10px; }
  .muted { color: var(--muted); }
  .meta { text-align:right; font-size:12px; color:var(--muted); }
  .mono { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12px; }
  .kpis { display:grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: 24px; }
  .kpi { border:1px solid var(--line); border-radius:10px; padding:14px; }
  .kpi b { display:block; font-size:22px; font-variant-numeric: tabular-nums; }
  .kpi span { font-size:12px; color:var(--muted); }
  table { width:100%; border-collapse: collapse; }
  td, th { padding: 8px 4px; border-bottom: 1px solid var(--line); text-align:left; }
  th { font-size:12px; color:var(--muted); font-weight:500; }
  .num { text-align:right; font-variant-numeric: tabular-nums; }
  .seal { display:flex; gap:14px; align-items:center; border:1px solid ${v.ok ? "#bfe3cf" : "#f3c1a8"}; background:${v.ok ? "var(--green-50)" : "#fff4ed"}; border-radius:10px; padding:14px 16px; margin-top:24px; }
  .seal .dot { width:34px; height:34px; border-radius:50%; background:${v.ok ? "var(--green)" : "var(--red)"}; color:#fff; display:grid; place-items:center; font-weight:700; flex:none; }
  .two { display:grid; grid-template-columns: 1fr 1fr; gap: 28px; }
  .principle td:first-child { font-weight:500; width: 34%; }
  .foot { margin-top: 36px; padding-top: 16px; border-top:1px solid var(--line); font-size:12px; color:var(--muted); display:flex; justify-content:space-between; gap:16px; }
  .actions { max-width:820px; margin: 0 auto; display:flex; justify-content:flex-end; gap:8px; padding: 0 0 8px; }
  .btn { font: 500 13px Inter, sans-serif; border:1px solid var(--line); background:#fff; padding:8px 14px; border-radius:8px; cursor:pointer; color:var(--ink); text-decoration:none; }
  .btn.primary { background: var(--green); color:#fff; border-color: var(--green); }
  @media (max-width: 720px) { .page { padding: 28px 20px; margin: 12px; } .kpis { grid-template-columns: 1fr 1fr; } .two { grid-template-columns: 1fr; } }
  @media print { body { background:#fff; } .page { border:none; margin:0; padding: 0; max-width:none; } .actions { display:none; } }
</style></head>
<body>
<div class="actions" style="margin-top:20px"><a class="btn" href="/">← Dashboard</a><button class="btn primary" onclick="print()">Download PDF</button></div>
<div class="page">
  <div class="top">
    <div class="brand"><div class="logo">N</div>N-ATLAS Sovereign Gateway</div>
    <div class="meta">Report <span class="mono">${esc(reportId)}</span><br>Generated ${esc(fmtDate(generated.toISOString()))}<br>${esc(host)}</div>
  </div>

  <h1>Data protection compliance report</h1>
  <div class="muted">Prepared for review under the Nigeria Data Protection Act 2023 (NDPC), with security notes for NITDA and CBN. Period: ${esc(fmtDate(s.from))} to ${esc(fmtDate(s.to))}.</div>

  <div class="kpis">
    <div class="kpi"><b>${n(s.records)}</b><span>requests processed</span></div>
    <div class="kpi"><b>${n(totalPii)}</b><span>personal data items withheld from the model</span></div>
    <div class="kpi"><b>${n(blocked)}</b><span>attacks blocked</span></div>
    <div class="kpi"><b>${n(s.zeroRetentionRequests)}</b><span>zero-retention requests</span></div>
  </div>

  <div class="seal">
    <div class="dot">${v.ok ? "✓" : "!"}</div>
    <div><b>${v.ok ? "Audit trail verified intact" : `Audit trail integrity failure at record #${v.brokenAt}`}</b><br>
    <span class="muted">${n(v.records)} records, each chained to the previous by SHA-256. Final hash <span class="mono">${esc(s.lastHash.slice(0, 32) || "–")}…</span></span></div>
  </div>

  <h2>1 · Personal data withheld from the model</h2>
  <div class="muted" style="margin-bottom:8px">${n(s.requestsWithPii)} of ${n(s.records)} requests contained Nigerian personal data. Every item below was replaced with a token before reaching N-ATLAS and restored only in the response to the caller.</div>
  <table><thead><tr><th>Category</th><th>Token</th><th class="num">Items</th></tr></thead><tbody>${piiRows}</tbody></table>

  <div class="two">
    <div>
      <h2>2 · Security events</h2>
      <table><thead><tr><th>Blocked by rule</th><th class="num">Count</th></tr></thead><tbody>${ruleRows}</tbody></table>
    </div>
    <div>
      <h2>3 · Request outcomes</h2>
      <table><thead><tr><th>Outcome</th><th class="num">Count</th></tr></thead><tbody>${outcomeRows || `<tr><td colspan="2" class="muted">No requests yet.</td></tr>`}</tbody></table>
    </div>
  </div>

  <h2>4 · Controls against NDPA 2023 principles</h2>
  <table class="principle"><tbody>
    <tr><td>Data minimisation</td><td>Prompts are redacted before inference. GPS and addresses are coarsened to district level, so the model receives only what it needs.</td></tr>
    <tr><td>Storage limitation</td><td>The token vault exists only for the duration of each request. Cached answers are stored redacted and expire. ${n(s.zeroRetentionRequests)} requests ran under zero retention and were never stored.</td></tr>
    <tr><td>Integrity &amp; confidentiality</td><td>Hashed API keys, per-tenant rate limits and budgets, prompt-injection filtering (${n(blocked)} blocked), and network shielding: client IPs and internal headers never reach the model.</td></tr>
    <tr><td>Accountability</td><td>A tamper-evident audit trail with no message content, covering ${n(s.tenants.length)} tenant(s), verifiable at <span class="mono">/admin/audit/verify</span>.</td></tr>
    <tr><td>Data sovereignty</td><td>The gateway and N-ATLAS can run entirely on Nigerian infrastructure, so personal data need not leave the country.</td></tr>
  </tbody></table>

  <div class="foot">
    <span>Generated automatically from the gateway's audit chain. It contains counts only, never prompts or answers. This report supports compliance review and is not legal advice.</span>
    <span class="mono">${esc(reportId)}</span>
  </div>
</div>
</body></html>`;
}
