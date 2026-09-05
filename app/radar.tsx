import { DIMS, type Scores } from "@/lib/dimensions";

// Pure SVG radar: reel (gold) over the bar (dashed plum). No library, renders on the server.
export default function Radar({ scores, bar, size = 280, labels = true }: { scores: Scores; bar?: Scores; size?: number; labels?: boolean }) {
  const n = DIMS.length, cx = size / 2, cy = size / 2, R = size / 2 - (labels ? 38 : 8);
  const pt = (i: number, v: number) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; const r = (R * v) / 100; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const poly = (s: Scores) => DIMS.map((d, i) => pt(i, s[d.key]).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size, display: "block" }} role="img" aria-label="Dimension radar">
      {[25, 50, 75, 100].map((g) => <polygon key={g} points={DIMS.map((_, i) => pt(i, g).join(",")).join(" ")} fill="none" stroke="var(--line)" strokeWidth={g === 100 ? 1.2 : 0.7} />)}
      {DIMS.map((_, i) => { const [x, y] = pt(i, 100); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--line)" strokeWidth="0.7" />; })}
      {bar && <polygon points={poly(bar)} fill="rgba(124,92,196,0.10)" stroke="var(--plum)" strokeWidth="1.5" strokeDasharray="5 4" />}
      <polygon points={poly(scores)} fill="rgba(200,150,46,0.22)" stroke="var(--gold)" strokeWidth="2" />
      {DIMS.map((d, i) => { const [x, y] = pt(i, scores[d.key]); return <circle key={d.key} cx={x} cy={y} r="3" fill="var(--gold)" />; })}
      {labels && DIMS.map((d, i) => { const [x, y] = pt(i, 122); return <text key={d.key} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="10.5" fill="var(--muted)" fontWeight="600">{d.label}</text>; })}
    </svg>
  );
}
