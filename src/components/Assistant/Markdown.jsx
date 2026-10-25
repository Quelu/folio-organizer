import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCatalog } from '../../hooks/catalogContext';
import { getInk } from '../../utils/catalog';
import { useCardLang } from '../../hooks/useCardLang';

const CARD_LINK = '#card:';

/** Card cited by the assistant: name with its ink, picture on hover. */
const CardMention = ({ id }) => {
  const { index } = useCatalog();
  const cardLang = useCardLang();
  const card = index?.byId.get(id);
  const image = cardLang.image(card, 'normal');
  if (!card) return <span className="text-slate-400">[{id}]</span>;
  return (
    <span className="group relative inline-flex items-baseline">
      <span className="inline-flex items-center gap-1 px-1.5 rounded-md bg-white/[0.06] ring-1 ring-inset ring-white/10 text-white font-medium cursor-default">
        {card.inks.map((ink) => (
          <span key={ink} className="w-1.5 h-1.5 rounded-full self-center" style={{ background: getInk(ink).color }} />
        ))}
        {cardLang.fullName(card)}
      </span>
      {image && (
        <span className="pointer-events-none absolute left-0 bottom-full mb-2 z-30 w-44 opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150">
          <img src={image} alt={cardLang.fullName(card)} className="w-full rounded-lg shadow-2xl shadow-black/70 ring-1 ring-white/20" />
        </span>
      )}
    </span>
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

/** Assistant text: Markdown, with [[12-42]] card references turned into card mentions. */
const Markdown = ({ text }) => (
  <div className="text-sm text-slate-300 break-words">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text.replace(/\[\[\s*(\d+-\d+[a-z]?)\s*\]\]/gi, (_, id) => `[${id}](${CARD_LINK}${id})`)}
    </ReactMarkdown>
  </div>
);

export default Markdown;
