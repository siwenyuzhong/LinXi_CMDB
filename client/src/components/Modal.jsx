import React, {useEffect} from 'react';

export default function Modal(
    {
        open,
        onClose,
        title,
        children,
        type = 'default',    // default | success | error | confirm
        width = 480,
        footer,
        closable = true,
        closeOnOverlay = false,
        icon: customIcon = null,
    }) {
    useEffect(() => {
        if (!open) return;
        const handleEsc = (e) => {
            if (e.key === 'Escape' && closable) onClose?.();
        };
        window.addEventListener('keydown', handleEsc);
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', handleEsc);
            document.body.style.overflow = '';
        };
    }, [open, onClose, closable]);

    if (!open) return null;

    const icons = {
        default: {icon: <i className="bi bi-terminal"/>, color: '#6366f1'},
        success: {icon: '✅', color: '#22c55e'},
        error: {icon: <i className="bi bi-x-lg"/>, color: '#ef4444'},
        confirm: {icon: '⚠️', color: '#f59e0b'},
    };

    const {icon, color} = customIcon ? {icon: customIcon, color: '#6366f1'} : icons[type] || icons.default;

    return (
        <div className="modal-overlay">
            <div
                className={`modal-box modal-${type}`}
                style={{maxWidth: width}}
            >
                {/* Header */}
                <div className="modal-header">
                    <div className="modal-title-group">
                        <span className="modal-icon">{icon}</span>
                        <h3 className="modal-title">{title}</h3>
                    </div>
                    {closable && (
                        <button className="modal-close" onClick={onClose}>✕</button>
                    )}
                </div>

                {/* Accent bar */}
                <div className="modal-accent"/>

                {/* Body */}
                <div className="modal-body">
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div className="modal-footer">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}
