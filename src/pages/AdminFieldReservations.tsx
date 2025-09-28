import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'
import { LoadingButton } from '../components/ui/LoadingButton'
import FieldMaps from '../components/FieldMaps'

type Team = { id: string; name: string }
type Zone = { id: string; name: string }
type Row = {
  id: string
  team_id: string
  team_name: string | null
  field_zone_id: string
  field_zone_name: string | null
  starts_at: string
  ends_at: string
  meeting_id: string | null
  meeting_date: string | null
  mtype: 'preparation'|'meeting' | null
}
type SummaryRow = { team_id: string; team_name: string; reservations: number; distinct_zones: number }

export default function AdminFieldReservations() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [teams, setTeams] = useState<Team[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [teamId, setTeamId] = useState<string>('all')
  const [from, setFrom] = useState<string>(''); const [to, setTo] = useState<string>('')
  const [rows, setRows] = useState<Row[]>([])

  // ملخص يومي
  const [summaryDate, setSummaryDate] = useState<string>(''); const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([])
  const [summaryLoading, setSummaryLoading] = useState(false)

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const [{ data: ts, error: te }, { data: zs, error: ze }] = await Promise.all([
        supabase.from('teams').select('id,name').order('name'),
        supabase.from('field_zones').select('id,name').eq('active', true).order('name')
      ])
      if (te) throw te; if (ze) throw ze
      setTeams((ts as any) ?? []); setZones((zs as any) ?? [])

      const today = new Date(); const pad=(n:number)=>String(n).padStart(2,'0')
      const start = new Date(today.getFullYear(), today.getMonth(), 1)
      setFrom(`${start.getFullYear()}-${pad(start.getMonth()+1)}-${pad(start.getDate())}`)
      setTo(`${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`)
      setSummaryDate(`${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`)
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally { setLoading(false) }
  }

  useEffect(() => { if (from && to) refresh() }, [teamId, from, to])
  async function refresh() {
    setLoading(true)
    try {
      let q = supabase.from('v_field_reservations_detailed').select('*').is('soft_deleted_at', null) as any
      q = q.gte('starts_at', new Date(from + 'T00:00:00').toISOString()).lte('ends_at', new Date(to + 'T23:59:59').toISOString())
      if (teamId !== 'all') q = q.eq('team_id', teamId)
      const { data, error } = await q.order('starts_at', { ascending: true })
      if (error) throw error
      setRows((data as any) ?? [])
    } catch (e:any) { toast.error(e.message || 'تعذر تحميل الحجوزات') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (summaryDate) refreshSummary() }, [summaryDate])
  async function refreshSummary() {
    setSummaryLoading(true)
    try {
      const dayStart = new Date(summaryDate + 'T00:00:00'); const dayEnd = new Date(summaryDate + 'T23:59:59')
      const { data, error } = await supabase
        .from('field_reservations')
        .select('team_id, teams:team_id(name), field_zone_id, starts_at, ends_at')
        .is('soft_deleted_at', null)
        .lt('starts_at', dayEnd.toISOString())
        .gt('ends_at', dayStart.toISOString())
      if (error) throw error

      const map: Record<string, { name: string, reservations: number, zones: Set<string> }> = {}
      ;(data as any[] ?? []).forEach(r => {
        const tid = r.team_id as string; const tname = r.teams?.name || '—'
        if (!map[tid]) map[tid] = { name: tname, reservations: 0, zones: new Set<string>() }
        map[tid].reservations += 1
        if (r.field_zone_id) map[tid].zones.add(r.field_zone_id as string)
      })
      const rows: SummaryRow[] = Object.entries(map).map(([tid, v]) => ({
        team_id: tid, team_name: v.name, reservations: v.reservations, distinct_zones: v.zones.size
      })).sort((a,b) => a.team_name.localeCompare(b.team_name))
      setSummaryRows(rows)
    } catch (e:any) { toast.error(e.message || 'تعذر تحميل ملخص اليوم') }
    finally { setSummaryLoading(false) }
  }

  async function saveRow(r: Row) {
    setSavingId(r.id)
    try {
      let meeting_id = r.meeting_id
      if (r.meeting_date && r.mtype) {
        const { data: mrow, error: me } = await supabase
          .from('meetings')
          .upsert({ team_id: r.team_id, meeting_date: r.meeting_date, mtype: r.mtype }, { onConflict: 'team_id,meeting_date,mtype' })
          .select('id').maybeSingle()
        if (me) throw me
        meeting_id = mrow?.id || null
      }

      const { error } = await supabase.from('field_reservations').update({
        team_id: r.team_id, field_zone_id: r.field_zone_id, starts_at: r.starts_at, ends_at: r.ends_at, meeting_id
      }).eq('id', r.id)
      if (error) {
        const msg = String(error.message || '')
        if (msg.includes('field_reservations_no_overlap') || msg.includes('overlap')) throw new Error('تعذر الحفظ: تعارض مع حجز آخر')
        throw error
      }
      toast.success('تم الحفظ'); await refresh(); await refreshSummary()
    } catch (e:any) { toast.error(e.message || 'تعذر الحفظ') }
    finally { setSavingId(null) }
  }

  async function softDelete(id: string) {
    setDeletingId(id)
    try {
      const { error } = await supabase.from('field_reservations').update({ soft_deleted_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      toast.success('تم إلغاء الحجز'); await refresh(); await refreshSummary()
    } catch (e:any) { toast.error(e.message || 'تعذر الإلغاء') }
    finally { setDeletingId(null) }
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">إدارة حجوزات قطاعات الأرض — (أدمن)</h1>

      {/* الخرائط دائمًا */}
      <FieldMaps className="mb-4" sticky height="h-72 md:h-[28rem]" />

      <div className="grid md:grid-cols-5 gap-2 items-end">
        <div>
          <label className="text-sm">الفريق</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={teamId} onChange={e=>setTeamId(e.target.value)}>
            <option value="all">كل الفرق</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div><label className="text-sm">من</label>
          <input type="date" className="border rounded-xl p-2 w-full" value={from} onChange={e=>setFrom(e.target.value)} />
        </div>
        <div><label className="text-sm">إلى</label>
          <input type="date" className="border rounded-xl p-2 w-full" value={to} onChange={e=>setTo(e.target.value)} />
        </div>
        <div className="md:col-span-2 text-end">
          <button className="btn border" onClick={refresh}>تحديث</button>
        </div>
      </div>

      {/* ملخص اليوم */}
      <section className="card space-y-3">
        <div className="flex items-end gap-3 justify-between">
          <h2 className="text-lg font-semibold">ملخص اليوم — عدد القطاعات المحجوزة لكل فريق</h2>
          <div>
            <label className="text-sm mr-2">التاريخ</label>
            <input type="date" className="border rounded-xl p-2" value={summaryDate} onChange={e=>setSummaryDate(e.target.value)} />
          </div>
        </div>

        <PageLoader visible={summaryLoading} text="جاري حساب الملخص..." />
        <div className="border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr><th className="p-2 text-start">الفريق</th><th className="p-2 text-center">عدد الحجوزات</th></tr>
            </thead>
            <tbody>
              {summaryRows.map(r => (
                <tr key={r.team_id} className="border-t">
                  <td className="p-2">{r.team_name}</td>
                  <td className="p-2 text-center">{r.reservations}</td>
                </tr>
              ))}
              {summaryRows.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={3}>لا توجد حجوزات في هذا اليوم</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-start">الفريق</th>
              <th className="p-2 text-start">القطاع</th>
              <th className="p-2 text-start">من</th>
              <th className="p-2 text-start">إلى</th>
              <th className="p-2 text-start">تاريخ الاجتماع</th>
              <th className="p-2 text-start">النوع</th>
              <th className="p-2 text-center">حفظ</th>
              <th className="p-2 text-center">إلغاء</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                <td className="p-2">
                  <select className="border rounded-xl p-1" value={r.team_id}
                    onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, team_id: e.target.value}:x))}>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </td>
                <td className="p-2">
                  <select className="border rounded-xl p-1" value={r.field_zone_id}
                    onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, field_zone_id: e.target.value}:x))}>
                    {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                </td>
                <td className="p-2"><input type="datetime-local" className="border rounded-xl p-1"
                  value={r.starts_at?.slice(0,16)} onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, starts_at: e.target.value}:x))} /></td>
                <td className="p-2"><input type="datetime-local" className="border rounded-xl p-1"
                  value={r.ends_at?.slice(0,16)} onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, ends_at: e.target.value}:x))} /></td>
                <td className="p-2"><input type="date" className="border rounded-xl p-1"
                  value={r.meeting_date ?? ''} onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, meeting_date: e.target.value}:x))} /></td>
                <td className="p-2">
                  <select className="border rounded-xl p-1" value={r.mtype ?? 'meeting'}
                    onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, mtype: e.target.value as any}:x))}>
                    <option value="preparation">تحضير</option>
                    <option value="meeting">اجتماع</option>
                  </select>
                </td>
                <td className="p-2 text-center"><LoadingButton loading={savingId===r.id} onClick={()=>saveRow(r)}>حفظ</LoadingButton></td>
                <td className="p-2 text-center">
                  <button className="btn border" disabled={deletingId===r.id} onClick={()=>softDelete(r.id)}>{deletingId===r.id?'...':'إلغاء'}</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={8}>لا توجد سجلات</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
