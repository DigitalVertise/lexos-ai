import { cx } from "../ui";

/** Tiny dependency-free area sparkline. Uses currentColor so callers pick the tone. */
export function Sparkline({ values, className, label }: { values: number[]; className?: string; label?: string }) {
  const w = 120;
  const h = 36;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, h - 3 - (v / max) * (h - 8)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  const flat = values.every((v) => v === 0);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cx("h-9 w-full", className)} role="img" aria-label={label ?? "Activity over the last days"}>
      <defs>
        <linearGradient id="dv-spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {flat ? (
        <line x1="0" x2={w} y1={h - 3} y2={h - 3} stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      ) : (
        <>
          <path d={area} fill="url(#dv-spark)" />
          <path d={line} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
}

/** Horizontal usage bar; shifts to warn/bad as the limit approaches. */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const tone = pct >= 100 ? "bg-bad" : pct >= 85 ? "bg-warn" : "bg-accent";
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={cx("dv-grow h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
    </div>
  );
}
