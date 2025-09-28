
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

type ToastType = 'success' | 'error' | 'info'
type Toast = { id: string; type: ToastType; title?: string; message: string; duration?: number }

type ToastCtx = {
  show: (t: Omit<Toast, 'id'>) => void
  success: (msg: string, title?: string, duration?: number) => void
  error: (msg: string, title?: string, duration?: number) => void
  info: (msg: string, title?: string, duration?: number) => void
}

const Ctx = createContext<ToastCtx | null>(null)

function uid() { return Math.random().toString(36).slice(2) }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((t: Omit<Toast, 'id'>) => {
    const id = uid()
    const duration = t.duration ?? 3000
    setToasts(prev => [...prev, { ...t, id, duration }])
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), duration)
  }, [])

  const success = useCallback((message: string, title = 'تم بنجاح', duration = 3000) => show({ type: 'success', message, title, duration }), [show])
  const error   = useCallback((message: string, title = 'حدث خطأ',  duration = 4000) => show({ type: 'error', message, title, duration }), [show])
  const info    = useCallback((message: string, title = 'تنبيه',    duration = 3000) => show({ type: 'info', message, title, duration }), [show])

  const value = useMemo(() => ({ show, success, error, info }), [show, success, error, info])

  return (
    <Ctx.Provider value={value}>
      {children}
      {createPortal(
        <div className="fixed top-4 inset-x-0 flex justify-center z-[1000] pointer-events-none">
          <div className="flex flex-col gap-2 w-full max-w-md px-4">
            {toasts.map(t => (
              <div key={t.id}
                   className={`pointer-events-auto rounded-2xl shadow-lg border p-3 bg-white/95 backdrop-blur-sm
                   ${t.type === 'success' ? 'border-emerald-300' : t.type === 'error' ? 'border-rose-300' : 'border-sky-300'}`}>
                {t.title && <div className="font-semibold text-sm">{t.title}</div>}
                <div className="text-sm">{t.message}</div>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </Ctx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
