"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Count = { label: string; count: number };
type DashboardData = {
  periodDays: number;
  summary: { events: number; sessions: number };
  events: Count[];
  sections: Count[];
  funnel: Count[];
  daily: Array<{ day: string; events: number; sessions: number }>;
  usage: { day: string; reservedTokens: number; actualTokens: number; requests: number };
  settings: { modelCallsEnabled: boolean; userDailyTokenBudget: number; siteDailyTokenBudget: number };
};

const FUNNEL = ["page_view", "upload_completed", "pipeline_run", "answer_generated", "comparison_viewed"];

export function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/admin/analytics", { cache: "no-store" });
      const body = await response.json() as DashboardData & { error?: string };
      if (!response.ok) throw new Error(body.error || "Dashboard data could not be loaded.");
      setData(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Dashboard data could not be loaded.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchDashboard()
      .then((body) => { if (active) setData(body); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Dashboard data could not be loaded."); });
    return () => { active = false; };
  }, []);

  async function saveSettings(next: DashboardData["settings"]) {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/analytics", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await response.json() as { error?: string; settings?: DashboardData["settings"] };
      if (!response.ok || !body.settings) throw new Error(body.error || "Settings could not be saved.");
      setData((current) => current ? { ...current, settings: body.settings! } : current);
      setNotice("Controls saved. They apply to the next AI request.");
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <main className="admin-shell"><section className="admin-access"><p>OWNER DASHBOARD</p><h1>This room is locked.</h1><span>{error}</span><small>Open this page while signed into the owner account.</small><Link href="/">← Back to RAG FOR ALL</Link></section></main>;
  if (!data) return <main className="admin-shell"><p className="admin-loading">Loading the product pulse…</p></main>;

  const funnel = new Map(data.funnel.map((item) => [item.label, item.count]));
  const used = Math.max(data.usage.actualTokens, data.usage.reservedTokens);
  const usagePercent = Math.min(100, (used / data.settings.siteDailyTokenBudget) * 100);
  const maxSection = Math.max(1, ...data.sections.map((item) => item.count));
  const maxDaily = Math.max(1, ...data.daily.map((item) => item.events));

  return <main className="admin-shell">
    <header className="admin-header"><div><p>RAG FOR ALL · OWNER ONLY</p><h1>Product pulse</h1><span>Anonymous behavior, budget health, and one emergency brake.</span></div><Link href="/">Open the product ↗</Link></header>

    <section className="admin-control-grid">
      <article className="admin-control-card"><div><p>AI MODEL ACCESS</p><h2>{data.settings.modelCallsEnabled ? "Live" : "Paused"}</h2><span>{data.settings.modelCallsEnabled ? "Visitors can call Embeddings and the LLM." : "The visual pipeline still works; paid AI calls do not."}</span></div><button className={data.settings.modelCallsEnabled ? "switch on" : "switch"} disabled={saving} onClick={() => void saveSettings({ ...data.settings, modelCallsEnabled: !data.settings.modelCallsEnabled })} aria-label="Toggle AI model access"><i /></button></article>
      <article className="admin-control-card"><div><p>TODAY&apos;S SHARED TOKEN USE</p><h2>{formatNumber(used)} <small>/ {formatNumber(data.settings.siteDailyTokenBudget)}</small></h2><span>{data.usage.requests} model requests · UTC day</span></div><div className="admin-meter"><i style={{ width: `${usagePercent}%` }} /></div></article>
    </section>

    <BudgetEditor settings={data.settings} saving={saving} onSave={saveSettings} />
    {notice && <p className="admin-notice" role="status">{notice}</p>}

    <section className="admin-stat-grid"><article><span>ANONYMOUS SESSIONS · 30D</span><strong>{formatNumber(data.summary.sessions)}</strong></article><article><span>TRACKED ACTIONS · 30D</span><strong>{formatNumber(data.summary.events)}</strong></article><article><span>AI REQUESTS · TODAY</span><strong>{formatNumber(data.usage.requests)}</strong></article></section>

    <section className="admin-panels">
      <article className="admin-panel"><header><div><p>LEARNING FUNNEL</p><h2>Where people make it to</h2></div><span>Unique sessions · 30 days</span></header><div className="admin-funnel">{FUNNEL.map((name, index) => { const count = funnel.get(name) ?? 0; const base = funnel.get("page_view") || 1; return <div key={name}><span>{String(index + 1).padStart(2, "0")}</span><strong>{labelize(name)}</strong><i style={{ width: `${Math.max(3, count / base * 100)}%` }} /><b>{formatNumber(count)}</b><small>{index === 0 ? "entry" : `${Math.round(count / base * 100)}% of visitors`}</small></div>; })}</div></article>
      <article className="admin-panel"><header><div><p>SECTION INTEREST</p><h2>What people inspect</h2></div><span>Views + step clicks</span></header><div className="admin-bars">{data.sections.length ? data.sections.map((item) => <div key={item.label}><span>{labelize(item.label)}</span><i><b style={{ width: `${item.count / maxSection * 100}%` }} /></i><strong>{formatNumber(item.count)}</strong></div>) : <em>No section events yet.</em>}</div></article>
    </section>

    <section className="admin-panel admin-trend"><header><div><p>DAILY SIGNAL</p><h2>Last 14 days</h2></div><span>Actions per day</span></header><div className="admin-spark">{data.daily.length ? data.daily.map((item) => <div key={item.day} title={`${item.day}: ${item.events} actions, ${item.sessions} sessions`}><i style={{ height: `${Math.max(4, item.events / maxDaily * 100)}%` }} /><small>{item.day.slice(5)}</small></div>) : <em>No activity yet.</em>}</div></section>
    <footer className="admin-footer"><span>No document text, questions, answers, filenames, emails, or raw IP addresses are stored in analytics.</span><button onClick={() => void load()}>Refresh data</button></footer>
  </main>;
}

function BudgetEditor({ settings, saving, onSave }: { settings: DashboardData["settings"]; saving: boolean; onSave: (settings: DashboardData["settings"]) => Promise<void> }) {
  const [userBudget, setUserBudget] = useState(String(settings.userDailyTokenBudget));
  const [siteBudget, setSiteBudget] = useState(String(settings.siteDailyTokenBudget));
  const candidate = useMemo(() => ({ ...settings, userDailyTokenBudget: Number(userBudget), siteDailyTokenBudget: Number(siteBudget) }), [settings, userBudget, siteBudget]);
  return <section className="admin-budget"><div><p>DAILY HARD GUARDRAILS</p><span>Change these without redeploying. Limits reset at 00:00 UTC.</span></div><label>Per anonymous session<input inputMode="numeric" value={userBudget} onChange={(event) => setUserBudget(event.target.value)} /></label><label>Whole site<input inputMode="numeric" value={siteBudget} onChange={(event) => setSiteBudget(event.target.value)} /></label><button disabled={saving || !Number.isSafeInteger(candidate.userDailyTokenBudget) || !Number.isSafeInteger(candidate.siteDailyTokenBudget)} onClick={() => void onSave(candidate)}>{saving ? "Saving…" : "Save limits"}</button></section>;
}

function formatNumber(value: number) { return new Intl.NumberFormat("en-US", { notation: value >= 100_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value); }
function labelize(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }

async function fetchDashboard() {
  const response = await fetch("/api/admin/analytics", { cache: "no-store" });
  const body = await response.json() as DashboardData & { error?: string };
  if (!response.ok) throw new Error(body.error || "Dashboard data could not be loaded.");
  return body;
}
