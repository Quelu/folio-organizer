import { useEffect, useState } from 'react';
import { Download, ClipboardCopy, Loader2 } from 'lucide-react';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { useCardLang } from '../../hooks/useCardLang';
import { renderDeckImage } from '../../utils/deckImage';
import { normalizeName } from '../../utils/catalog';

const fileName = (deck) => `${normalizeName(deck.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck'}.png`;

/** The picture, drawn when the modal opens (mounted only while open). */
const DeckImage = ({ deck, analysis }) => {
  const notify = useToast();
  const cardLang = useCardLang();
  const [image, setImage] = useState(null); // { blob, url }
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url = null;
    let cancelled = false;
    renderDeckImage({
      deck,
      analysis,
      imageOf: (card) => cardLang.image(card, 'large'),
      nameOf: (entry) => cardLang.fullName(entry.card, entry.name),
    })
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setImage({ blob, url });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // Drawn once per opening: later deck edits need a new export
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': image.blob })]);
      notify({ tone: 'success', message: 'Image copiée : colle-la dans Discord ou ailleurs' });
    } catch {
      notify({ tone: 'error', message: "Ce navigateur ne peut pas copier d'image : télécharge-la" });
    }
  };

  if (failed) return <p className="text-sm text-rose-300 py-8 text-center">L'image n'a pas pu être créée.</p>;
  if (!image) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
        <Loader2 size={16} className="animate-spin" />
        Dessin du deck…
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <img src={image.url} alt={`Deck ${deck.name}`} className="w-full rounded-lg ring-1 ring-white/10" />
      <div className="flex gap-2 justify-end">
        <button onClick={copy} className="btn-secondary px-3 py-1.5">
          <ClipboardCopy size={15} />
          Copier l'image
        </button>
        <a href={image.url} download={fileName(deck)} className="btn-primary px-3 py-1.5">
          <Download size={15} />
          Télécharger
        </a>
      </div>
    </div>
  );
};

/** A deck as a PNG picture to share or print. */
const DeckImageModal = ({ isOpen, onClose, deck, analysis }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Image du deck" size="lg">
    <div className="px-6 pb-6 pt-2">{isOpen && <DeckImage deck={deck} analysis={analysis} />}</div>
  </Modal>
);

export default DeckImageModal;
