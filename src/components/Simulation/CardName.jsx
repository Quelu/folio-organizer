import { useCatalog } from '../../hooks/catalogContext';
import CardHover from '../CardPreview/CardHover';

/** Name of a simulated card (utils/simulation/deck.js): its picture on hover, its full view on click. */
const CardName = ({ card, className = '' }) => {
  const { index } = useCatalog();
  const printing = index?.byId.get(card.id);
  if (!printing) return <span className={className}>{card.name}</span>;
  return (
    <CardHover
      card={printing}
      className={`text-left outline-none decoration-dotted underline-offset-2 hover:text-white hover:underline focus-visible:text-white focus-visible:underline ${className}`}
    >
      {card.name}
    </CardHover>
  );
};

export default CardName;
