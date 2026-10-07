import { getCounts, getExportedCounts } from './cards';

/**
 * Generates the rows to export to Dreamborn (only non-exported quantities), one per variant.
 * @param {object} binder
 * @returns {{ cardNumber: number, variant: 'normal'|'foil', toExport: number }[]}
 */
export const getDreambornExportRows = (binder) =>
  Object.entries(binder.cards)
    .flatMap(([num, data]) => {
      const owned = getCounts(data);
      const exported = getExportedCounts(data);
      return ['normal', 'foil'].map((variant) => ({
        cardNumber: parseInt(num, 10),
        variant,
        toExport: owned[variant] - exported[variant],
      }));
    })
    .filter((r) => r.toExport > 0)
    .sort((a, b) => a.cardNumber - b.cardNumber || a.variant.localeCompare(b.variant));

/**
 * Builds the CSV string in Dreamborn format.
 * @param {object} binder
 * @returns {string}
 */
export const generateDreambornCsv = (binder) => {
  const rows = getDreambornExportRows(binder);
  const lines = ['Set Number,Card Number,Variant,Count'];
  for (const row of rows) {
    lines.push(`${binder.setCode},${row.cardNumber},${row.variant},${row.toExport}`);
  }
  return lines.join('\n');
};

/**
 * Triggers a browser download of the given CSV string.
 * @param {string} csv
 * @param {string} filename
 */
export const downloadCsv = (csv, filename) => {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};
