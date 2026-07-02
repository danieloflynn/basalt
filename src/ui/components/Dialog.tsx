import { useEffect, useRef, useState } from 'react';

export function Dialog({
  title,
  placeholder,
  initialValue = '',
  confirmLabel,
  danger = false,
  message,
  onConfirm,
  onCancel,
}: {
  title: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel: string;
  danger?: boolean;
  /** When set, renders a confirm dialog with no input. */
  message?: string;
  onConfirm: (value: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 60);
    return () => clearTimeout(t);
  }, []);

  const confirm = () => void onConfirm(value);

  return (
    <>
      <div className="scrim" onClick={onCancel} />
      <div className="dialog" role="dialog" aria-label={title}>
        <h2 className="dialog__title">{title}</h2>
        {message ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-md)', lineHeight: 1.5 }}>
            {message}
          </p>
        ) : (
          <input
            ref={inputRef}
            className="dialog__input"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirm();
              if (e.key === 'Escape') onCancel();
            }}
          />
        )}
        <div className="dialog__actions">
          <button className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            style={danger ? { background: 'var(--danger)', color: '#fff' } : undefined}
            onClick={confirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  );
}
