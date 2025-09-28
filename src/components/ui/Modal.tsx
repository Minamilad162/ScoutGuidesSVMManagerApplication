
import { createPortal } from 'react-dom'

export function Modal({ open, title, children, onClose }:
  { open: boolean, title?: string, children?: React.ReactNode, onClose: () => void }) {
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[1200]">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose}/>
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border p-5">
          {title && <div className="text-lg font-bold mb-2">{title}</div>}
          <div className="text-sm">{children}</div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="px-4 py-2 rounded-xl border cursor-pointer" onClick={onClose}>إغلاق</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
