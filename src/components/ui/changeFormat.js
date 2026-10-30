const percent = new Intl.NumberFormat('fr-BE', { style: 'percent', maximumFractionDigits: 1 });

/** A change as a fraction, unsigned (the arrow or the color tells the way): « 3,1 % ». */
export const formatRatio = (ratio) => percent.format(Math.abs(ratio));

/** Tone of a change: up, down, or flat under a tenth of a percent. */
export const changeTone = (ratio) =>
  ratio == null || Math.abs(ratio) < 0.001 ? 'text-slate-400' : ratio > 0 ? 'text-emerald-300' : 'text-rose-300';
