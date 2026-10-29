/** A tiny price curve without axes, green when it ends higher, red when lower. */
const Sparkline = ({ values, width = 96, height = 28, className = '' }) => {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * width).toFixed(1)},${(height - 2 - ((v - min) / range) * (height - 4)).toFixed(1)}`)
    .join(' ');
  const last = values[values.length - 1];
  const tone = last > values[0] ? 'stroke-emerald-300' : last < values[0] ? 'stroke-rose-300' : 'stroke-slate-400';
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} aria-hidden="true">
      <polyline points={points} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" className={tone} />
    </svg>
  );
};

export default Sparkline;
