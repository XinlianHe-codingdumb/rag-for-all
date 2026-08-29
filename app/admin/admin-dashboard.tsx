"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Count = { label: string; count: number };
type DashboardData = {
  periodDays: number;
  summary: { events: number; sessions: number };
  events: Count[];
  steps: Count[];
  pages: Count[];
  llmCalls: Count[];
  funnel: Count[];
  daily: Array<{ day: string; events: number; sessions: number; stepOpens: number; llmCalls: number }>;
  usage: { day: string; reservedTokens: number; actualTokens: number; requests: number };
  settings: { modelCallsEnabled: boolean; userDailyTokenBudget: number; siteDailyTokenBudget: number };
};

const FUNNEL = ["page_view", "upload_completed", "stage_run", "answer_generated", "comparison_viewed"];
const RANGES = [1, 7, 30] as const;

export function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [detail, setDetail] = useState<"steps" | "llm">("steps");
  const [selectedLabel, setSelectedLabel] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async (nextRange = range) => {
    setError("");
    try {
      const response = await fetch(`/api/admin/analytics?range=${nextRange}`, { cache: "no-store" });
      const body = await response.json() as DashboardData & { error?: string };
      if (!response.ok) throw new Error(body.error || "Dashboard data could not be loaded.");
      setData(body);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Dashboard data could not be loaded.");
    }
  }, [range]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(range); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, range]);

  async function saveSettings(next: DashboardData["settings"]) {
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/admin/analytics", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const body = await response.json() as { error?: string; settings?: DashboardData["settings"] };
      if (!response.ok || !body.settings) throw new Error(body.error || "Settings could not be saved.");
      setData((current) => current ? { ...current, settings: body.settings! } : current);
      setNotice("Controls saved. They apply to the next AI request.");
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : "Settings could not be saved.");
    } finally { setSaving(false); }
  }

  if (error) return <main className="admin-shell"><section className="admin-access"><p>OWNER DASHBOARD</p><h1>This room is locked.</h1><span>{error}</span><small>Open this page while signed into the owner account.</small><Link href="/">← Back to RAG FOR ALL</Link></section></main>;
  if (!data) return <main className="admin-shell"><p className="admin-loading">Loading the product pulse…</p></main>;

  const funnel = new Map(data.funnel.map((item) => [item.label, item.count]));
  const used = Math.max(data.usage.actualTokens, data.usage.reservedTokens);
  const usagePercent = Math.min(100, (used / data.settings.siteDailyTokenBudget) * 100);
  const activeRows = detail === "steps" ? data.steps : data.llmCalls;
  const maxRows = Math.max(1, ...activeRows.map((item) => item.count));
  const maxDaily = Math.max(1, ...data.daily.map((item) => detail === "steps" ? item.stepOpens : item.llmCalls));
  const totalStepOpens = data.steps.reduce((sum, item) => sum + item.count, 0);
  const totalLlmCalls = data.llmCalls.reduce((sum, item) => sum + item.count, 0);

  return <main className="admin-shell">
    <header className="admin-header"><div><p>RAG FOR ALL · OWNER ONLY</p><h1>Product pulse</h1><span>Anonymous behavior, model-call health, and controls you can change without redeploying.</span></div><Link href="/">Open the product ↗</Link></header>
    <section className="admin-range" aria-label="Analytics time range">{RANGES.map((item) => <button key={item} className={range === item ? "selected" : ""} onClick={() => { setRange(item); setSelectedLabel(""); }}>{item === 1 ? "24 hours" : `${item} days`}</button>)}</section>

    <section className="admin-control-grid">
      <article className="admin-control-card"><div><p>AI MODEL ACCESS</p><h2>{data.settings.modelCallsEnabled ? "Live" : "Paused"}</h2><span>{data.settings.modelCallsEnabled ? "Visitors can call Embeddings and the LLM." : "The visual pipeline still works; paid AI calls do not."}</span></div><button className={data.settings.modelCallsEnabled ? "switch on" : "switch"} disabled={saving} onClick={() => void saveSettings({ ...data.settings, modelCallsEnabled: !data.settings.modelCallsEnabled })} aria-label="Toggle AI model access"><i /></button></article>
      <article className="admin-control-card"><div><p>TODAY&apos;S SHARED TOKEN USE</p><h2>{formatNumber(used)} <small>/ {formatNumber(data.settings.siteDailyTokenBudget)}</small></h2><span>{data.usage.requests} provider requests · UTC day</span></div><div className="admin-meter"><i style={{ width: `${usagePercent}%` }} /></div></article>
    </section>
    <BudgetEditor settings={data.settings} saving={saving} onSave={saveSettings} />
    {notice && <p className="admin-notice" role="status">{notice}</p>}

    <section className="admin-stat-grid"><article><span>ANONYMOUS SESSIONS · {range}D</span><strong>{formatNumber(data.summary.sessions)}</strong></article><article><span>STEP OPENS · {range}D</span><strong>{formatNumber(totalStepOpens)}</strong></article><article><span>LLM CALLS · {range}D</span><strong>{formatNumber(totalLlmCalls)}</strong></article></section>

    <section className="admin-panels">
      <article className="admin-panel"><header><div><p>LEARNING FUNNEL</p><h2>Where people make it to</h2></div><span>Unique sessions · {range} days</span></header><div className="admin-funnel">{FUNNEL.map((name, index) => { const count = funnel.get(name) ?? 0; const base = funnel.get("page_view") || 1; return <div key={name}><span>{String(index + 1).padStart(2, "0")}</span><strong>{labelize(name)}</strong><i style={{ width: `${Math.max(3, count / base * 100)}%` }} /><b>{formatNumber(count)}</b><small>{index === 0 ? "entry" : `${Math.round(count / base * 100)}% of visitors`}</small></div>; })}</div></article>
      <article className="admin-panel"><header><div><p>PAGE VIEWS</p><h2>Where sessions begin</h2></div><span>{range} days</span></header><div className="admin-bars">{data.pages.length ? data.pages.map((item) => <div key={item.label}><span>{item.label}</span><i><b style={{ width: `${item.count / Math.max(1, ...data.pages.map((page) => page.count)) * 100}%` }} /></i><strong>{formatNumber(item.count)}</strong></div>) : <em>No page views yet.</em>}</div></article>
    </section>

    <section className="admin-panel admin-detail-panel"><header><div><p>INTERACTIVE DETAIL</p><h2>{detail === "steps" ? "Which learning steps people open" : "Which paid model calls are happening"}</h2></div><div className="admin-tabs"><button className={detail === "steps" ? "selected" : ""} onClick={() => { setDetail("steps"); setSelectedLabel(""); }}>Step opens</button><button className={detail === "llm" ? "selected" : ""} onClick={() => { setDetail("llm"); setSelectedLabel(""); }}>LLM calls</button></div></header><div className="admin-bars selectable">{activeRows.length ? activeRows.map((item) => <button key={item.label} className={selectedLabel === item.label ? "selected" : ""} onClick={() => setSelectedLabel(item.label)}><span>{labelize(item.label.replace(" · ", " "))}</span><i><b style={{ width: `${item.count / maxRows * 100}%` }} /></i><strong>{formatNumber(item.count)}</strong></button>) : <em>{detail === "steps" ? "No step opens yet." : "No tracked LLM calls yet."}</em>}</div>{selectedLabel && <p className="admin-selection">Selected: <strong>{labelize(selectedLabel.replace(" · ", " "))}</strong> · {formatNumber(activeRows.find((item) => item.label === selectedLabel)?.count ?? 0)} events in the selected period.</p>}</section>

    <section className="admin-panel admin-trend"><header><div><p>DAILY SIGNAL</p><h2>{detail === "steps" ? "Step opens over time" : "LLM calls over time"}</h2></div><span>Click the tabs above to switch the chart</span></header><div className="admin-spark">{data.daily.length ? data.daily.map((item) => { const value = detail === "steps" ? item.stepOpens : item.llmCalls; return <div key={item.day} title={`${item.day}: ${value} ${detail === "steps" ? "step opens" : "LLM calls"}`}><i style={{ height: `${Math.max(4, value / maxDaily * 100)}%` }} /><small>{item.day.slice(5)}</small></div>; }) : <em>No activity yet.</em>}</div></section>
    <footer className="admin-footer"><span>Analytics stores no document text, questions, answers, filenames, emails, or raw IP addresses. LLM metrics contain only the operation type and outcome.</span><button onClick={() => void load(range)}>Refresh data</button></footer>
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
