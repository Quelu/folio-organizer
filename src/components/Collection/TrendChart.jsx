import { useEffect, useId, useRef, useState } from 'react';

const HEIGHT = 220;
const PAD = { top: 18, right: 68, bottom: 26, left: 4 };

const shortDate = (day, withYear = false) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', ...(withYear && { year: 'numeric' }) });

/**
 * A value curve over time. Days sit at their date, so days Folio was not opened leave a gap in
 * time rather than a jump; hovering shows a day's value.
 * @param {{ day: string, value: number }[]} points at least two, oldest first
 * @param {{ day: string, label: string }[]} markers dashed lines, the chapter releases
 */
const TrendChart = ({ points, markers = [], format }) => {
  const ref = useRef(null);
  const gradientId = useId();
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const first = Date.parse(points[0].day);
  const span = Date.parse(points[points.length - 1].day) - first || 1;
  const values = points.map((p) => p.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  // Some air above and below, more when the curve is flat
  const margin = (high - low) * 0.15 || high * 0.02 || 1;
  const min = Math.max(0, low - margin);
  const max = high + margin;
  const innerWidth = Math.max(0, width - PAD.left - PAD.right);
  const innerHeight = HEIGHT - PAD.top - PAD.bottom;
  const bottom = PAD.top + innerHeight;
  const x = (day) => PAD.left + ((Date.parse(day) - first) / span) * innerWidth;
  const y = (value) => PAD.top + (1 - (value - min) / (max - min)) * innerHeight;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points[points.length - 1].day).toFixed(1)},${bottom} L${x(points[0].day).toFixed(1)},${bottom} Z`;
  const withYear = span > 300 * 24 * 60 * 60 * 1000;
  const labels = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : [0, points.length - 1];

  const onMove = (e) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let nearest = points[0];
    for (const p of points) if (Math.abs(x(p.day) - px) < Math.abs(x(nearest.day) - px)) nearest = p;
    setHover(nearest);
  };

  return (
    <div ref={ref} className="relative select-none">
      {width > 0 && (
        <svg width={width} height={HEIGHT} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="block touch-pan-y">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(129 140 248)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="rgb(129 140 248)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[high, (high + low) / 2, low].map((value, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={PAD.left + innerWidth} y1={y(value)} y2={y(value)} className="stroke-white/5" />
              <text x={PAD.left + innerWidth + 8} y={y(value) + 3} className="fill-slate-500 text-[10px] tabular-nums">
                {format(value)}
              </text>
            </g>
          ))}
          {markers.map((m) => (
            <g key={m.day + m.label}>
              <line x1={x(m.day)} x2={x(m.day)} y1={PAD.top - 6} y2={bottom} className="stroke-amber-300/50" strokeDasharray="3 3" />
              <text x={x(m.day) + 4} y={PAD.top + 2} className="fill-amber-300/80 text-[10px]">
                {m.label}
              </text>
            </g>
          ))}
          <path d={area} fill={`url(#${gradientId})`} />
          <path d={line} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="stroke-indigo-400" />
          {points.length <= 31 &&
            points.map((p) => <circle key={p.day} cx={x(p.day)} cy={y(p.value)} r="2" className="fill-indigo-300" />)}
          {labels.map((i, k) => (
            <text
              key={i}
              x={x(points[i].day)}
              y={HEIGHT - 6}
              textAnchor={k === 0 ? 'start' : k === labels.length - 1 ? 'end' : 'middle'}
              className="fill-slate-500 text-[10px]"
            >
              {shortDate(points[i].day, withYear)}
            </text>
          ))}
          {hover && (
            <g>
              <line x1={x(hover.day)} x2={x(hover.day)} y1={PAD.top} y2={bottom} className="stroke-white/20" />
              <circle cx={x(hover.day)} cy={y(hover.value)} r="4" className="fill-indigo-300 stroke-slate-950" strokeWidth="2" />
            </g>
          )}
        </svg>
      )}
      {hover && (
        <div
          className="absolute top-0 -translate-x-1/2 px-2 py-1 rounded-md bg-slate-900 ring-1 ring-white/10 text-xs whitespace-nowrap pointer-events-none"
          style={{ left: Math.min(Math.max(x(hover.day), 50), Math.max(50, width - 50)) }}
        >
          <span className="text-slate-400">{shortDate(hover.day, true)}</span> <b className="text-white tabular-nums">{format(hover.value)}</b>
        </div>
      )}
    </div>
  );
};

export default TrendChart;
