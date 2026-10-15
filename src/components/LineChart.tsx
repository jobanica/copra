// Lightweight dependency-free line/area chart (pure SVG, responsive).

export interface ChartPoint {
  label: string;
  value: number;
}

export function LineChart({
  points,
  height = 200,
  valueFormat,
}: {
  points: ChartPoint[];
  height?: number;
  valueFormat?: (n: number) => string;
}) {
  const w = 640;
  const h = height;
  const pad = { l: 10, r: 10, t: 16, b: 24 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const values = points.map((p) => p.value);
  const maxV = Math.max(1, ...values);
  const minV = Math.min(0, ...values);
  const span = maxV - minV || 1;
  const n = points.length;

  const x = (i: number) => pad.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - ((v - minV) / span) * innerH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${(pad.t + innerH).toFixed(1)} L${x(0).toFixed(1)},${(pad.t + innerH).toFixed(1)} Z`;

  // Up to 3 horizontal gridlines.
  const grid = [0, 0.5, 1].map((t) => pad.t + innerH - t * innerH);
  // Sparse x labels (~5).
  const labelEvery = Math.max(1, Math.round(n / 5));
  const last = points[n - 1];

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-auto w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Trend chart"
    >
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#16a34a" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#16a34a" stopOpacity="0" />
        </linearGradient>
      </defs>

      {grid.map((gy, i) => (
        <line key={i} x1={pad.l} y1={gy} x2={w - pad.r} y2={gy} stroke="#eef2f5" strokeWidth="1" />
      ))}

      <path d={area} fill="url(#chartFill)" />
      <path d={line} fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

      {n > 0 && (
        <>
          <circle cx={x(n - 1)} cy={y(last.value)} r="4" fill="#16a34a" />
          <circle cx={x(n - 1)} cy={y(last.value)} r="8" fill="#16a34a" fillOpacity="0.15" />
        </>
      )}

      {points.map((p, i) =>
        i % labelEvery === 0 || i === n - 1 ? (
          <text key={i} x={x(i)} y={h - 6} textAnchor="middle" fontSize="11" fill="#9ca3af">
            {p.label}
          </text>
        ) : null,
      )}

      {valueFormat && n > 0 && (
        <text x={x(n - 1)} y={Math.max(14, y(last.value) - 12)} textAnchor="end" fontSize="12" fontWeight="600" fill="#166534">
          {valueFormat(last.value)}
        </text>
      )}
    </svg>
  );
}
