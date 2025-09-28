import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ui/Toaster'
import { PageLoader } from '../components/ui/PageLoader'
import { LoadingButton } from '../components/ui/LoadingButton'

type Q = {
  id: number
  question_text: string
  weight: number
  active: boolean
  created_at?: string
}

export default function AdminEvalQuestions() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Q[]>([])
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  // إضافة سؤال
  const [qText, setQText] = useState('')
  const [qWeight, setQWeight] = useState<number | ''>('')
  const [qActive, setQActive] = useState(true)
  const [saving, setSaving] = useState(false)

  // حالة تعديل/حذف
  const [savingRow, setSavingRow] = useState<number | null>(null)
  const [deletingRow, setDeletingRow] = useState<number | null>(null)

  useEffect(() => { refresh() }, [])
  async function refresh() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('evaluation_questions')
        .select('id, question_text, weight, active, created_at')
        .order('active', { ascending: false })
        .order('weight', { ascending: false })
        .order('id', { ascending: false })
      if (error) throw error
      setRows((data as any) ?? [])
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الأسئلة')
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return rows.filter(r => {
      if (!showInactive && !r.active) return false
      if (!s) return true
      return (
        r.question_text.toLowerCase().includes(s)
        || String(r.weight).includes(s)
      )
    })
  }, [rows, search, showInactive])

  async function addQuestion() {
    if (!qText.trim()) return toast.error('أدخل نص السؤال')
    const w = Number(qWeight)
    if (!Number.isFinite(w) || w < 0 || w > 100) return toast.error('الوزن يجب أن يكون بين 0 و 100')

    setSaving(true)
    try {
      const { error } = await supabase
        .from('evaluation_questions')
        .insert({ question_text: qText.trim(), weight: w, active: qActive })
      if (error) throw error
      toast.success('تمت الإضافة')
      setQText(''); setQWeight(''); setQActive(true)
      await refresh()
    } catch (e:any) {
      toast.error(e.message || 'تعذر الإضافة')
    } finally {
      setSaving(false)
    }
  }

  async function saveRow(r: Q) {
    setSavingRow(r.id)
    try {
      const w = Number(r.weight)
      if (!Number.isFinite(w) || w < 0 || w > 100) throw new Error('الوزن يجب أن يكون بين 0 و 100')
      const { error } = await supabase
        .from('evaluation_questions')
        .update({ question_text: r.question_text.trim(), weight: w, active: r.active })
        .eq('id', r.id)
      if (error) throw error
      toast.success('تم الحفظ')
      await refresh()
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحفظ')
    } finally {
      setSavingRow(null)
    }
  }

  async function removeRow(id: number) {
    if (!confirm('هل تريد حذف هذا السؤال؟ سيؤثر ذلك على الإجابات المرتبطة به.')) return
    setDeletingRow(id)
    try {
      const { error } = await supabase
        .from('evaluation_questions')
        .delete()
        .eq('id', id)
      if (error) throw error
      toast.success('تم الحذف')
      setRows(prev => prev.filter(x => x.id !== id))
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحذف')
    } finally {
      setDeletingRow(null)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold">إدارة أسئلة التقييم</h1>
        <div className="flex items-center gap-2">
          <input
            className="border rounded-xl p-2 w-60"
            placeholder="بحث..."
            value={search}
            onChange={e=>setSearch(e.target.value)}
          />
          <label className="inline-flex items-center gap-2 text-sm bg-gray-50 border rounded-xl px-3 py-2 cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e=>setShowInactive(e.target.checked)} />
            إظهار غير النشطة
          </label>
          <button className="btn border" onClick={refresh}>تحديث</button>
        </div>
      </div>

      {/* إضافة سؤال جديد */}
      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">إضافة سؤال</h2>
        <div className="grid md:grid-cols-4 gap-2 items-end">
          <div className="md:col-span-2">
            <label className="text-sm">نص السؤال</label>
            <input className="border rounded-xl p-2 w-full" value={qText} onChange={e=>setQText(e.target.value)} placeholder="مثلاً: يلتزم بمواعيد الحضور؟" />
          </div>
          <div>
            <label className="text-sm">الوزن (0–100)</label>
            <input type="number" min={0} max={100} className="border rounded-xl p-2 w-full" value={qWeight} onChange={e=>setQWeight(e.target.value as any)} />
          </div>
          <div>
            <label className="text-sm">نشط؟</label>
            <select className="border rounded-xl p-2 w-full" value={String(qActive)} onChange={e=>setQActive(e.target.value==='true')}>
              <option value="true">نعم</option>
              <option value="false">لا</option>
            </select>
          </div>
          <div className="md:col-span-4 text-end">
            <LoadingButton loading={saving} onClick={addQuestion}>إضافة</LoadingButton>
          </div>
        </div>
      </section>

      {/* الجدول */}
      <div className="border rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-start w-[60px]">#</th>
              <th className="p-2 text-start">السؤال</th>
              <th className="p-2 text-center w-[120px]">الوزن</th>
              <th className="p-2 text-center w-[120px]">نشط</th>
              <th className="p-2 text-center w-[160px]">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{r.id}</td>
                <td className="p-2">
                  <input
                    className="border rounded-xl p-2 w-full"
                    value={r.question_text}
                    onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, question_text: e.target.value}:x))}
                  />
                </td>
                <td className="p-2 text-center">
                  <input
                    type="number" min={0} max={100}
                    className="border rounded-xl p-2 w-24 text-center"
                    value={r.weight}
                    onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, weight: Number(e.target.value)}:x))}
                  />
                </td>
                <td className="p-2 text-center">
                  <select
                    className="border rounded-xl p-2"
                    value={String(r.active)}
                    onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, active: e.target.value==='true'}:x))}
                  >
                    <option value="true">نعم</option>
                    <option value="false">لا</option>
                  </select>
                </td>
                <td className="p-2 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <LoadingButton loading={savingRow===r.id} onClick={()=>saveRow(r)}>حفظ</LoadingButton>
                    <button className="btn border" disabled={deletingRow===r.id} onClick={()=>removeRow(r.id)}>
                      {deletingRow===r.id ? '...' : 'حذف'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="p-3 text-center text-gray-500" colSpan={5}>لا توجد أسئلة</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
