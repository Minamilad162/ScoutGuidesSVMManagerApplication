
import { Spinner } from './Spinner'

export function PageLoader({ visible = false, text = 'جاري التحميل…' }: { visible?: boolean, text?: string }) {
  if (!visible) return null
  return (
    <div className="fixed inset-0 z-[1100] bg-white/60 backdrop-blur-sm flex items-center justify-center">
      <div className="flex items-center gap-3 border rounded-2xl bg-white shadow-lg px-4 py-3">
        <Spinner className="h-6 w-6"/>
        <div className="text-sm">{text}</div>
      </div>
    </div>
  )
}
