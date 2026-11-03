// MANAGE workspace: projects (create, open, duplicate, template, archive), job history and material stock.
import { useMemo, useState } from "react";
import { useToast } from "../../components/Toast";
import { useStore } from "../../lib/store";
import { newDoc } from "../geom/core";
import { errText, useT, type ProjectRow } from "../data";
import { useSession } from "../session";
import { History } from "../prod/Produce";
import { Btn, Empty, Modal, Num, Pill, Sel, Text } from "../ui";

export function Manage({ go }: { go: (w: "design" | "prepare" | "produce") => void }) {
  const T = useT(); const S = useSession(); const toast = useToast(); const { db } = useStore();
  const [q, setQ] = useState(""); const [view, setView] = useState<"active" | "templates" | "archived">("active");
  const [creating, setCreating] = useState(false); const [tab, setTab] = useState<"projects" | "history" | "materials">("projects");
  const canDesign = T.can("design");
  const list = useMemo(() => T.projects.filter((p) => (view === "archived" ? p.archived : !p.archived && (view === "templates" ? p.template : !p.template)))
    .filter((p) => !q || `${p.number} ${p.name} ${p.customer} ${p.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [T.projects, view, q]);
  const open = async (p: ProjectRow, where: "design" | "prepare" = "design") => { try { await S.open(p.id); go(where); } catch (e) { toast(errText(e), "error"); } };
  const patch = async (p: ProjectRow, v: Partial<ProjectRow>, msg: string) => { try { const { error } = await T.sb.from("trotan_projects").update(v).eq("id", p.id); if (error) throw new Error(error.message); await T.refresh("projects"); toast(msg, "ok"); } catch (e) { toast(errText(e), "error"); } };
  const duplicate = async (p: ProjectRow) => {
    try { const { doc } = await T.loadDoc(p.id); const { data, error } = await T.sb.from("trotan_projects").insert({ name: p.template ? p.name : `${p.name} (copy)`, customer: p.customer, notes: p.notes, tags: p.tags, doc }).select("id").single(); if (error) throw new Error(error.message);
      await T.refresh("projects"); await S.open((data as { id: string }).id); go("design"); } catch (e) { toast(errText(e), "error"); }
  };
  const jobsOf = (id: string) => T.jobs.filter((j) => j.project_id === id);
  return (
    <div className="t-page" data-testid="manage">
      <div className="t-head">
        <div><h1>Manage</h1><p className="t-note">Projects, finished jobs and material stock.</p></div>
        <div className="t-seg"><button type="button" className={tab === "projects" ? "on" : ""} onClick={() => setTab("projects")}>Projects</button><button type="button" className={tab === "history" ? "on" : ""} onClick={() => setTab("history")}>Job history</button><button type="button" className={tab === "materials" ? "on" : ""} onClick={() => setTab("materials")}>Materials</button></div>
        <Btn tone="primary" disabled={!canDesign} title={canDesign ? "New project" : "Your role cannot create designs"} onClick={() => setCreating(true)} testid="new-project">New project</Btn>
      </div>
      {tab === "projects" && <>
        <div className="t-row t-filters">
          <input className="t-search" placeholder="Search projects, customers, tags" value={q} onChange={(e) => setQ(e.target.value)} data-testid="project-search" />
          <div className="t-seg">{(["active", "templates", "archived"] as const).map((v) => <button key={v} type="button" className={view === v ? "on" : ""} onClick={() => setView(v)}>{{ active: "Projects", templates: "Templates", archived: "Archived" }[v]}</button>)}</div>
        </div>
        {!list.length && <Empty title={view === "templates" ? "No templates" : view === "archived" ? "Nothing archived" : "No projects yet"} hint={view === "active" ? "Create a project to start designing." : undefined} />}
        <div className="t-cards">
          {list.map((p) => {
            const js = jobsOf(p.id), mo = p.mo_job_id ? db.jobs.find((j) => j.id === p.mo_job_id) : null;
            return (
              <div key={p.id} className={`t-card ${S.project?.id === p.id ? "on" : ""}`} data-testid="project-card">
                <div className="t-card-h"><small>{p.number}</small>{p.template && <Pill tone="info">template</Pill>}{S.project?.id === p.id && <Pill tone="ok">open</Pill>}</div>
                <b>{p.name}</b>
                <small>{p.customer || "No customer"} · v{p.version} · {new Date(p.updated_at).toLocaleDateString("en-GB")}</small>
                {mo && <small>SK Factory: {mo.code} — {mo.title}</small>}
                {p.tags.length > 0 && <div className="t-tags">{p.tags.map((t) => <span key={t}>{t}</span>)}</div>}
                <small>{js.length ? `${js.length} job${js.length === 1 ? "" : "s"} · ${js.filter((j) => j.status === "done").length} done · ${js.filter((j) => j.status === "queued").length} queued` : "No jobs"}</small>
                <div className="t-row">
                  {p.template ? <Btn small tone="primary" disabled={!canDesign} onClick={() => duplicate(p)}>Use template</Btn> : <Btn small tone="primary" onClick={() => open(p)} testid="open-project">Open</Btn>}
                  {!p.template && <Btn small onClick={() => open(p, "prepare")} disabled={!T.can("prepare") && !T.can("produce")}>Prepare</Btn>}
                  <Btn small disabled={!canDesign} onClick={() => duplicate(p)}>Duplicate</Btn>
                  <Btn small disabled={!canDesign} onClick={() => patch(p, { template: !p.template }, p.template ? "No longer a template" : "Saved as a template")}>{p.template ? "Un-template" : "Make template"}</Btn>
                  <Btn small disabled={!canDesign} onClick={() => patch(p, { archived: !p.archived }, p.archived ? "Restored" : "Archived")}>{p.archived ? "Restore" : "Archive"}</Btn>
                </div>
              </div>
            );
          })}
        </div>
      </>}
      {tab === "history" && <History />}
      {tab === "materials" && <Materials />}
      {creating && <NewProject onClose={() => setCreating(false)} onDone={async (id) => { setCreating(false); await S.open(id); go("design"); }} />}
    </div>
  );
}

function NewProject({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const T = useT(); const toast = useToast(); const { db } = useStore();
  const [f, setF] = useState({ name: "", customer: "", notes: "", tags: "", w: 600, h: 400, template: "", mo: "" });
  const [busy, setBusy] = useState(false);
  const templates = T.projects.filter((p) => p.template && !p.archived);
  const create = async () => {
    if (!f.name.trim()) { toast("Give the project a name", "error"); return; }
    setBusy(true);
    try {
      const doc = f.template ? (await T.loadDoc(f.template)).doc : newDoc(f.w, f.h);
      const mo = db.jobs.find((j) => j.id === f.mo);
      const { data, error } = await T.sb.from("trotan_projects").insert({ name: f.name.trim(), customer: f.customer.trim() || mo?.customer || "", notes: f.notes, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean), mo_job_id: f.mo || null, doc }).select("id").single();
      if (error) throw new Error(error.message);
      await T.refresh("projects"); onDone((data as { id: string }).id);
    } catch (e) { toast(errText(e), "error"); } finally { setBusy(false); }
  };
  return (
    <Modal title="New project" onClose={onClose} foot={<><Btn onClick={onClose}>Cancel</Btn><Btn tone="primary" disabled={busy || !f.name.trim()} onClick={create} testid="create-project">Create</Btn></>}>
      <Text label="Name" value={f.name} onCommit={(v) => setF({ ...f, name: v })} testid="project-name" />
      <Text label="Customer" value={f.customer} onCommit={(v) => setF({ ...f, customer: v })} />
      <Text label="Tags (comma separated)" value={f.tags} onCommit={(v) => setF({ ...f, tags: v })} />
      <Sel label="Start from" value={f.template} onChange={(v) => setF({ ...f, template: v })} options={[{ value: "", label: "Blank page" }, ...templates.map((t) => ({ value: t.id, label: `Template: ${t.name}` }))]} />
      {!f.template && <div className="t-grid2"><Num label="Page width" unit="mm" value={f.w} min={1} max={5000} onCommit={(v) => setF({ ...f, w: v })} /><Num label="Page height" unit="mm" value={f.h} min={1} max={5000} onCommit={(v) => setF({ ...f, h: v })} /></div>}
      <Sel label="SK Factory job (optional)" value={f.mo} onChange={(v) => setF({ ...f, mo: v })} options={[{ value: "", label: "Not linked" }, ...db.jobs.filter((j) => j.status !== "done").slice(0, 300).map((j) => ({ value: j.id, label: `${j.code} — ${j.title}` }))]} />
      <Text label="Notes" value={f.notes} onCommit={(v) => setF({ ...f, notes: v })} multiline />
    </Modal>
  );
}

function Materials() {
  const T = useT(); const { db } = useStore();
  return (
    <div className="t-table-wrap">
      <table className="t-table">
        <thead><tr><th>Material</th><th>Thickness</th><th>Sheet</th><th>KORTANA item</th><th>In stock</th><th>Reserved</th><th>Approved settings</th></tr></thead>
        <tbody>{T.materials.filter((m) => !m.archived).map((m) => {
          const s = m.stock_item_id ? db.stock_items.find((x) => x.id === m.stock_item_id) : null;
          const res = T.reservations.filter((r) => r.stock_item_id === m.stock_item_id && r.status === "reserved").reduce((a, r) => a + Number(r.quantity), 0);
          const prohibited = T.machines.filter((x) => x.prohibited.includes(m.id));
          return <tr key={m.id}><td>{m.name}{prohibited.length > 0 && <> <Pill tone="err" title={prohibited.map((x) => x.name).join(", ")}>prohibited</Pill></>}</td><td>{m.thickness_mm ? `${m.thickness_mm} mm` : "—"}</td><td>{m.sheet_w && m.sheet_h ? `${m.sheet_w} × ${m.sheet_h} mm` : "—"}</td>
            <td>{s ? `${s.sku} ${s.name}` : <span className="t-muted">not linked</span>}</td><td>{s ? `${s.quantity} ${s.unit}` : "—"}</td><td>{s ? res : "—"}</td>
            <td>{T.profiles.filter((p) => p.material_id === m.id && p.status === "approved").map((p) => p.operation).join(", ") || <span className="t-muted">none</span>}</td></tr>;
        })}</tbody>
      </table>
    </div>
  );
}
