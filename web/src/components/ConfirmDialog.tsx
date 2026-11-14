import { useEffect, useRef } from 'react';

/** Native <dialog>: focus trap, Esc to close and screen-reader semantics for free. */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal?.();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      aria-describedby="confirm-body"
      onCancel={props.onCancel}
      className="dialog"
    >
      <h2 id="confirm-title">{props.title}</h2>
      <div id="confirm-body">{props.children}</div>
      <div className="row end">
        <button type="button" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={props.onConfirm}>
          {props.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
