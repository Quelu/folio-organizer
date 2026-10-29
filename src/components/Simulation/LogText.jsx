import CardName from './CardName';

/** A log sentence, its card names showing their card on hover (cards: logCards). */
const LogText = ({ text, cards }) =>
  cards.pattern
    ? text.split(cards.pattern).map((part, i) => (i % 2 ? <CardName key={i} card={cards.byName.get(part)} className="text-slate-100" /> : part))
    : text;

export default LogText;
