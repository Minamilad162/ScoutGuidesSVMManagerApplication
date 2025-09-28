import { useState } from 'react'
// ✅ نستورد الصور كأصول (relative imports) بدل BASE_URL أو public paths
import map1 from '../assets/field-maps/field-map-1.jpeg'
import map2 from '../assets/field-maps/field-map-2.jpeg'

type Props = {
  className?: string
  height?: string   // Tailwind height e.g. 'h-72 md:h-96'
  sticky?: boolean  // يبقيها ثابتة فوق الصفحة عند السكول
}

export default function FieldMaps({ className = '', height = 'h-72 md:h-96', sticky = true }: Props) {
  const maps = [
    { src: map1, title: 'خريطة الأرض (يسار)' },
    { src: map2, title: 'خريطة الأرض (يمين)' },
  ]
  const [viewer, setViewer] = useState<string | null>(null)

  return (
    <div className={className}>
      <div className={(sticky ? 'sticky top-0 z-10 ' : '') + 'bg-white/70 backdrop-blur p-3 rounded-2xl border'}>
        <div className="grid md:grid-cols-2 gap-3">
          {maps.map((m, i) => (
            <figure key={i} className={`rounded-2xl border overflow-hidden bg-white ${height} flex flex-col`}>
              <div className="px-3 py-2 text-sm text-gray-700">{m.title}</div>
              <button
                type="button"
                className="flex-1 overflow-hidden"
                onClick={() => setViewer(m.src)}
                title="اضغط للتكبير"
              >
                <img
                  src={m.src}
                  alt={m.title}
                  className="w-full h-full object-contain hover:opacity-95 transition"
                  loading="lazy"
                />
              </button>
            </figure>
          ))}
        </div>
        <div className="text-xs text-gray-500 mt-2">اضغط على أي صورة للتكبير — الأرقام كما بالخريطة.</div>
      </div>

      {viewer && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setViewer(null)}>
          <img src={viewer} alt="Field map" className="max-w-[95vw] max-h-[90vh] object-contain rounded-xl shadow-2xl" />
        </div>
      )}
    </div>
  )
}
