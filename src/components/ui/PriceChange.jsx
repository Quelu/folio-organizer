import { changeTone, formatRatio } from './changeFormat';

/** A price change with its arrow, green up and red down. */
const PriceChange = ({ ratio, suffix, className = '' }) =>
  ratio == null ? null : (
    <span className={`tabular-nums whitespace-nowrap ${changeTone(ratio)} ${className}`}>
      {Math.abs(ratio) >= 0.001 && (ratio > 0 ? '▲ ' : '▼ ')}
      {formatRatio(ratio)}
      {suffix && <span className="text-slate-500"> · {suffix}</span>}
    </span>
  );

export default PriceChange;
