import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ui/Toaster'
import { PageLoader } from '../components/ui/PageLoader'
import { LoadingButton } from '../components/ui/LoadingButton'

type EventRow = {
  id: string
  title: string
  content: string | null
  starts_at: string
  location: string | null
  created_at: string
}

export default function AdminEvents() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  // form
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [when, setWhen] = useState('')       // datetime-local
  const [location, setLocation] = useState('')

  const [rows, setRows] = useState<EventRow[]>([])

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      // افتراضي: الآن + 3 أيام الساعة 18:00
      const now = new Date()
      now.setDate(now.getDate() + 3)
      now.setHours(18, 0, 0, 0)
      const pad = (n:number)=>String(n).padStart(2,'0')
      setWhen(`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`)

      await refresh()
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally {
      setLoading(false)
    }
  }

  async function refresh() {
    const { data, error } = await supabase
      .from('events')
      .select('id,title,content,starts_at,location,created_at')
      .is('soft_deleted_at', null)
      .order('starts_at', { ascending: false })
    if (error) return toast.error(error.message || 'تعذر تحميل الفعاليات')
    setRows((data as any) ?? [])
  }

  async function save() {
    if (!title.trim()) return toast.error('أدخل عنوان الفعالية')
    if (!when) return toast.error('اختر الموعد')

    setSaving(true)
    try {
      const starts_at = new Date(when).toISOString()
      const { error } = await supabase.from('events').insert({
        title: title.trim(),
        content: content.trim() || null,
        starts_at,
        location: location.trim() || null
      })
      if (error) throw error

      toast.success('تم إنشاء الفعالية وإرسال الإشعار للجميع')
      setTitle(''); setContent(''); setLocation('')
      await refresh()
    } catch (e:any) {
      toast.error(e.message || 'تعذر إنشاء الفعالية')
    } finally {
      setSaving(false)
    }
  }

  async function softDelete(id: string) {
    setDeleting(id)
    try {
      const { error } = await supabase
        .from('events')
        .update({ soft_deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      toast.success('تم حذف الفعالية')
      await refresh()
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحذف')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">إنشاء فعالية (إشعار لجميع المستخدمين)</h1>

      <section className="card space-y-3">
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-sm">العنوان</label>
            <input className="border rounded-xl p-2 w-full" value={title} onChange={e=>setTitle(e.target.value)} placeholder="مثال: اجتماع السبت" />
          </div>
          <div>
            <label className="text-sm">الموعد</label>
            <input type="datetime-local" className="border rounded-xl p-2 w-full" value={when} onChange={e=>setWhen(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm">المكان</label>
            <input className="border rounded-xl p-2 w-full" value={location} onChange={e=>setLocation(e.target.value)} placeholder="مثال: مقر الكشافة" />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm">التفاصيل</label>
            <textarea className="border rounded-xl p-2 w-full min-h-[100px]" value={content} onChange={e=>setContent(e.target.value)} placeholder="تفاصيل إضافية..." />
          </div>
        </div>

        <div className="text-end">
          <LoadingButton loading={saving} onClick={save}>إنشاء وإرسال</LoadingButton>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">الفعاليات السابقة</h2>
        <div className="border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">العنوان</th>
                <th className="p-2 text-start">الموعد</th>
                <th className="p-2 text-start">المكان</th>
                <th className="p-2 text-start">التفاصيل</th>
                <th className="p-2 text-center">حذف</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t align-top">
                  <td className="p-2">{r.title}</td>
                  <td className="p-2">{new Date(r.starts_at).toLocaleString()}</td>
                  <td className="p-2">{r.location || '—'}</td>
                  <td className="p-2 whitespace-pre-wrap">{r.content || '—'}</td>
                  <td className="p-2 text-center">
                    <button className="btn border" disabled={deleting===r.id} onClick={()=>softDelete(r.id)}>
                      {deleting===r.id ? '...' : 'حذف'}
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td className="p-3 text-center text-gray-500" colSpan={5}>لا توجد فعاليات</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
