import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCatalog } from '../../hooks/catalogContext';
import { getInk } from '../../utils/catalog';
import { useCardLang } from '../../hooks/useCardLang';
import CardHover from '../CardPreview/CardHover';

const CARD_LINK = '#card:';

/** Card cited by the assistant: name with its ink, picture on hover, full card view on click. */
const CardMention = ({ id }) => {
  const { index } = useCatalog();
  const cardLang = useCardLang();
  const card = index?.byId.get(id);
  if (!card) return <span className="text-slate-400">[{id}]</span>;

  return (
    <CardHover
      card={card}
      className="inline-flex items-center gap-1 px-1.5 rounded-md bg-white/[0.06] ring-1 ring-inset ring-white/10 text-white font-medium hover:bg-white/[0.1] hover:ring-white/25 transition-colors"
    >
      {card.inks.map((ink) => (
        <span key={ink} className="w-1.5 h-1.5 rounded-full self-center" style={{ background: getInk(ink).color }} />
      ))}
      {cardLang.fullName(card)}
    </CardHover>
  );
};

const components = {
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  h1: ({ children }) => <h3 className="mt-4 mb-2 text-base font-bold text-white">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 mb-2 text-base font-bold text-white">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1.5 text-sm font-bold text-white">{children}</h4>,
  ul: ({ children }) => <ul className="my-2 pl-5 list-disc space-y-1 marker:text-slate-600">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 pl-5 list-decimal space-y-1 marker:text-slate-500">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  code: ({ children }) => <code className="px-1 rounded bg-white/10 text-[0.9em]">{children}</code>,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto scrollbar-thin">
      <table className="text-xs border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="px-2 py-1 text-left font-semibold text-slate-300 border-b border-white/10">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1 border-b border-white/5 align-top">{children}</td>,
  a: ({ href, children }) =>
    href?.startsWith(CARD_LINK) ? (
      <CardMention id={href.slice(CARD_LINK.length)} />
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:text-white underline underline-offset-2">
        {children}
      </a>
    ),
};

/**
 * Assistant text: Markdown, with [[12-42]] card references turned into card mentions. The cards of
 * one answer form a group: the full card view browses them with the arrow keys.
 */
const Markdown = ({ text }) => (
  <div data-preview-group className="text-sm text-slate-300 break-words">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text.replace(/\[\[\s*(\d+-\d+[a-z]?)\s*\]\]/gi, (_, id) => `[${id}](${CARD_LINK}${id})`)}
    </ReactMarkdown>
  </div>
);

export default Markdown;
