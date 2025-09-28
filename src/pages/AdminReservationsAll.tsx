import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'

type RowMat = { id: string; starts_at: string; ends_at: string; qty: number; teams?: { name: string }, materials?: { name: string } }
type RowField = { id: string; starts_at: string; ends_at: string; teams?: { name: string }, field_zones?: { name: string } }

export default function AdminReservationsAll() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)

  const [date, setDate] = useState<string>('')
  const [rowsMat, setRowsMat] = useState<RowMat[]>([])
  const [rowsField, setRowsField] = useState<RowField[]>([])

  useEffect(() => {
    const today = new Date(); const pad=(n:number)=>String(n).padStart(2,'0')
    setDate(`${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`)
  }, [])

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

      <h1 className="text-xl font-bold">حجوزات اليوم — (إدمن)</h1>

      <div>
        <label className="text-sm">التاريخ</label>
        <input type="date" className="border rounded-xl p-2 ml-2" value={date} onChange={e=>setDate(e.target.value)} />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">حجوزات الأدوات</h2>
        <div className="border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الفريق</th>
                <th className="p-2 text-start">الأداة</th>
                <th className="p-2 text-center">العدد</th>
                <th className="p-2 text-start">من</th>
                <th className="p-2 text-start">إلى</th>
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
              {rowsMat.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={5}>لا توجد حجوزات</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">حجوزات قطاعات الأرض</h2>
        <div className="border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الفريق</th>
                <th className="p-2 text-start">القطاع</th>
                <th className="p-2 text-start">من</th>
                <th className="p-2 text-start">إلى</th>
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
              {rowsField.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={4}>لا توجد حجوزات</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
