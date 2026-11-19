import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** 原生模态层管理焦点边界，关闭时把焦点还给打开它的按钮。 */
export function ModalDialog({ label, className, onClose, children }: {
  label: string;
  className: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      role="dialog"
      aria-label={label}
      aria-modal="true"
      className={className}
      style={{ margin: 0, width: '100%', height: '100%', maxWidth: 'none', maxHeight: 'none', color: 'inherit' }}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => {
        // 按住打开面板的按键时，后续重复事件不应顺带触发面板内的按钮。
        if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
      }}
    >
      {children}
    </dialog>
  );
}
