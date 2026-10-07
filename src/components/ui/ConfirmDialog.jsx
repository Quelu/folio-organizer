import Modal from './Modal';

const ConfirmDialog = ({ isOpen, onClose, onConfirm, title, message, confirmLabel = 'Confirmer', danger }) => (
  <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
    <div className="px-6 pb-6 pt-2">
      <p className="text-sm text-slate-400 leading-relaxed">{message}</p>
      <div className="flex gap-3 mt-6">
        <button onClick={onClose} className="btn-secondary flex-1">
          Annuler
        </button>
        <button
          autoFocus
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={`flex-1 ${danger ? 'btn-danger' : 'btn-primary'}`}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </Modal>
);

export default ConfirmDialog;
