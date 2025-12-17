import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'

type RowMat = { id: string; starts_at: string; ends_at: string; qty: number; teams?: { name: string }, materials?: { name: string } }
type RowField = { id: string; starts_at: string; ends_at: string; teams?: { name: string }, field_zones?: { name: string } }

type Term = { id: string; name: string; year: number; start_date: string | null; end_date: string | null }
type TermDateRow = { id: string; meeting_date: string } // YYYY-MM-DD

export default function AdminReservationsAll() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)

  // اختيار الترم + تواريخه
  const [terms, setTerms] = useState<Term[]>([])
  const [termId, setTermId] = useState<string>('')
  const [termDates, setTermDates] = useState<TermDateRow[]>([])
  const hasTermDates = termDates.length > 0

  // اليوم المختار (من قائمة الترم)
  const [date, setDate] = useState<string>('')

  // نتائج اليوم
  const [rowsMat, setRowsMat] = useState<RowMat[]>([])
  const [rowsField, setRowsField] = useState<RowField[]>([])

  const termMeta = useMemo(() => terms.find(t => t.id === termId) || null, [terms, termId])

  /* =========== تحميل الترمات =========== */
  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const { data: tm, error } = await supabase
        .from('terms')
        .select('id,name,year,start_date,end_date')
        .order('year', { ascending: false })
        .order('name', { ascending: true })
      if (error) throw error
      setTerms((tm as any) ?? [])
      if (tm && tm.length) setTermId(tm[0].id)
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الترمات')
    } finally {
      setLoading(false)
    }
  }

  /* =========== تحميل تواريخ الترم المختار =========== */
  useEffect(() => { if (termId) loadTermDates(termId) }, [termId])
  async function loadTermDates(tid: string) {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('term_meeting_dates')
        .select('id,meeting_date')
        .eq('term_id', tid)
        .order('meeting_date', { ascending: true })
      if (error) throw error
      const list = (data as any as TermDateRow[]) ?? []
      setTermDates(list)

      // لو اليوم الحالي مش ضمن القائمة أو فاضي، خليه أول تاريخ متاح
      if (!list.find(d => d.meeting_date === date)) {
        setDate(list[0]?.meeting_date || '')
      }
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل تواريخ الترم')
    } finally {
      setLoading(false)
    }
  }

  /* =========== تحديث النتائج عند تغيير التاريخ =========== */
  useEffect(() => { if (date) refresh() }, [date])

  async function refresh() {
    setLoading(true)
    try {
      const dayStart = new Date(date + 'T00:00:00')
      const dayEnd = new Date(date + 'T23:59:59')

      const [{ data: mres, error: me }, { data: fres, error: fe }] = await Promise.all([
        supabase.from('material_reservations')
          .select('id, qty, starts_at, ends_at, teams:team_id(name), materials:material_id(name)')
          .is('soft_deleted_at', null)
          .lt('starts_at', dayEnd.toISOString())
          .gt('ends_at', dayStart.toISOString())
          .order('starts_at', { ascending: true }),
        supabase.from('field_reservations')
          .select('id, starts_at, ends_at, teams:team_id(name), field_zones:field_zone_id(name)')
          .is('soft_deleted_at', null)
          .lt('starts_at', dayEnd.toISOString())
          .gt('ends_at', dayStart.toISOString())
          .order('starts_at', { ascending: true })
      ])
      if (me) throw me
      if (fe) throw fe
      setRowsMat((mres as any) ?? [])
      setRowsField((fres as any) ?? [])
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الحجوزات')
    } finally {
      setLoading(false)
    }
  }

  function fmt(iso: string) {
    const d = new Date(iso); const pad = (n:number)=> String(n).padStart(2,'0')
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">حجز عُهدة اليوم (كل الفرق)</h1>

      {/* اختيار الترم + تاريخ من تواريخه */}
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3 items-end">
        <div>
          <label className="text-sm">الترم</label>
          <select
            className="border rounded-xl p-2 w-full"
            value={termId}
            onChange={e=>setTermId(e.target.value)}
          >
            {terms.map(t => (
              <option key={t.id} value={t.id}>{t.year} — {t.name}</option>
            ))}
          </select>
          {termMeta?.start_date && termMeta?.end_date && (
            <div className="text-[11px] text-gray-500 mt-1">
              نطاق الترم: {termMeta.start_date} → {termMeta.end_date}
            </div>
          )}
        </div>

        <div className={`${hasTermDates ? '' : 'opacity-60 pointer-events-none'}`}>
          <label className="text-sm">التاريخ (من جدول الترم)</label>
          <select
            className="border rounded-xl p-2 w-full"
            value={date}
            onChange={e=>setDate(e.target.value)}
            disabled={!hasTermDates}
          >
            {!hasTermDates && <option value="">— لا توجد تواريخ مثبتة —</option>}
            {termDates.map(d => (
              <option key={d.id} value={d.meeting_date}>{d.meeting_date}</option>
            ))}
          </select>
          {!hasTermDates && (
            <div className="text-[11px] text-amber-600 mt-1">لا توجد تواريخ مثبتة لهذا الترم.</div>
          )}
        </div>
      </div>

      {/* حجوزات العهدة */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">حجوزات العهدة</h2>
        <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs sm:text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الفريق</th>
                <th className="p-2 text-start">الأداة</th>
                <th className="p-2 text-center">العدد</th>
                <th className="p-2 text-start whitespace-nowrap">من</th>
                <th className="p-2 text-start whitespace-nowrap">إلى</th>
              </tr>
            </thead>
            <tbody>
              {rowsMat.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.teams?.name || '—'}</td>
                  <td className="p-2">{r.materials?.name || '—'}</td>
                  <td className="p-2 text-center">{r.qty}</td>
                  <td className="p-2">{fmt(r.starts_at)}</td>
                  <td className="p-2">{fmt(r.ends_at)}</td>
                </tr>
              ))}
              {rowsMat.length === 0 && (
                <tr>
                  <td className="p-3 text-center text-gray-500" colSpan={5}>لا توجد حجوزات</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* حجوزات قطاعات الأرض */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">حجوزات قطاعات الأرض</h2>
        <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
          <table className="w-full min-w-[600px] text-xs sm:text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الفريق</th>
                <th className="p-2 text-start">اسم الأرض</th>
                <th className="p-2 text-start whitespace-nowrap">من</th>
                <th className="p-2 text-start whitespace-nowrap">إلى</th>
              </tr>
            </thead>
            <tbody>
              {rowsField.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.teams?.name || '—'}</td>
                  <td className="p-2">{r.field_zones?.name || '—'}</td>
                  <td className="p-2">{fmt(r.starts_at)}</td>
                  <td className="p-2">{fmt(r.ends_at)}</td>
                </tr>
              ))}
              {rowsField.length === 0 && (
                <tr>
                  <td className="p-3 text-center text-gray-500" colSpan={4}>لا توجد حجوزات</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
