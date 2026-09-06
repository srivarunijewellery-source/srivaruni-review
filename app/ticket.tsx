"use client";
import Link from "next/link";
import { useState } from "react";
import type { Plan } from "@/lib/hypotheses";

export default function Ticket({ variable, priority, budget, views, plan, planKey, footer }: { variable: string; priority: number; budget: string; views: string; plan: Plan; planKey: string; footer: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = [
    `A/B TEST: ${variable}`,
    plan.why,
    ``,
    `VARIANT A: ${plan.a.label}${plan.a.reel ? ` (reel: ${plan.a.reel.name})` : ""}`,
    ...plan.a.steps.map((s, i) => `  ${i + 1}. ${s}`),
    ``,
    `VARIANT B: ${plan.b.label}${plan.b.reel ? ` (reel: ${plan.b.reel.name})` : ""}`,
    ...plan.b.steps.map((s, i) => `  ${i + 1}. ${s}`),
    ``,
    `CAPTION: ${plan.caption}`,
    `READ: ${plan.metric.replace("_", " ")} per impression after ${views} views each. Budget about ${budget}.`,
    ...footer,
  ].join("\n");
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {} };
  const Arm = ({ side, arm }: { side: "A" | "B"; arm: Plan["a"] }) => (
    <div className="arm">
      <div className="armhead"><span className="armside">{side}</span><b>{arm.label}</b></div>
      {arm.reel && <Link href={`/reel/${arm.reel.id}`} className="armreel">{arm.reel.thumb ? <img src={arm.reel.thumb} alt="" /> : <span className="thumb" />}<span>{arm.reel.name}</span></Link>}
      <ol>{arm.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
    </div>
  );
  return (
    <article className="ticket">
      <header>
        <div><span className={`tag ${plan.kind === "shoot" ? "meets" : plan.kind === "pair" ? "boosted" : "raises"}`}>{plan.kind === "edit" ? "Edit one reel" : plan.kind === "pair" ? "Two existing reels" : "Needs a shoot"}</span><h3>{variable}</h3></div>
        <div className="ticketmeta"><span><b>{priority}</b> priority</span><span><b>{budget}</b> budget</span><span><b>{views}</b> views per arm</span></div>
      </header>
      <p className="why">{plan.why}</p>
      <div className="arms"><Arm side="A" arm={plan.a} /><Arm side="B" arm={plan.b} /></div>
      <div className="ticketfoot">
        <div className="small"><b>Caption.</b> {plan.caption}{plan.alternates.length > 0 && <> · <span className="muted">Alternates: {plan.alternates.map((x, i) => <span key={x.id}>{i > 0 && ", "}<Link href={`/reel/${x.id}`}>{x.name}</Link></span>)}</span></>}</div>
        <div className="ticketactions">
          <button type="button" className="ghost small" onClick={copy}>{copied ? "Copied" : "Copy ticket for editor"}</button>
          <Link className="btn small" href={`/experiments?plan=${planKey}#plan`}>Log this test</Link>
        </div>
      </div>
    </article>
  );
}
