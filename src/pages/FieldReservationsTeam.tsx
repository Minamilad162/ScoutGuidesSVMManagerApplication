import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ui/Toaster'
import { PageLoader } from '../components/ui/PageLoader'
import { LoadingButton } from '../components/ui/LoadingButton'
import { useRoleGate } from '../hooks/useRoleGate'
import { useAuth } from '../components/AuthProvider'
import FieldMaps from '../components/FieldMaps'

type Team = { id: string; name: string }
type Zone = { id: string; name: string }

export default function FieldReservationsTeam() {
  const toast = useToast()
  const gate = useRoleGate()
  const { roles } = useAuth()
  const isAdmin = roles.some(r => r.role_slug === 'admin')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [canceling, setCanceling] = useState<string | null>(null)

  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState<string>(''); const [teamName, setTeamName] = useState<string>('')

  const [zones, setZones] = useState<Zone[]>([])
  const [meetingDate, setMeetingDate] = useState<string>(''); const [mtype, setMtype] = useState<'preparation'|'meeting'>('meeting')
  const [startsAt, setStartsAt] = useState<string>(''); const [endsAt, setEndsAt] = useState<string>(''); const [zoneId, setZoneId] = useState<string>('')

  const [rows, setRows] = useState<any[]>([])

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const { data: z, error: ze } = await supabase.from('field_zones').select('id,name').eq('active', true).order('name')
      if (ze) throw ze
      setZones((z as any) ?? []); if (z && z.length) setZoneId(z[0].id)

      if (isAdmin) {
        const { data: ts, error: te } = await supabase.from('teams').select('id,name').order('name')
        if (te) throw te
        setTeams((ts as any) ?? []); if (ts && ts.length) { setTeamId(ts[0].id); setTeamName(ts[0].name) }
      } else {
        const { data: me, error: meErr } = await supabase.from('v_me').select('team_id').maybeSingle()
        if (meErr) throw meErr
        if (!me?.team_id) throw new Error('لا يوجد فريق مرتبط بحسابك')
        setTeamId(me.team_id)
        const { data: t, error: te2 } = await supabase.from('teams').select('name').eq('id', me.team_id).maybeSingle()
        if (te2) throw te2
        setTeamName(t?.name || '—')
      }

      const now = new Date(); const pad = (n:number)=>String(n).padStart(2,'0')
      const date = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
      setMeetingDate(date); setStartsAt(`${date}T16:00`); setEndsAt(`${date}T18:00`)
    } catch (e:any) { toast.error(e.message || 'تعذر التحميل') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (teamId) refresh() }, [teamId])
  async function refresh() {
    try {
      const { data, error } = await supabase
        .from('field_reservations')
        .select('id, starts_at, ends_at, field_zones:field_zone_id(name)')
        .eq('team_id', teamId)
        .is('soft_deleted_at', null)
        .order('starts_at', { ascending: true })
      if (error) throw error
      setRows((data as any) ?? [])
    } catch (e:any) { toast.error(e.message || 'تعذر تحميل الحجوزات') }
  }

  async function save() {
    if (!teamId) return toast.error('اختر الفريق')
    if (!zoneId) return toast.error('اختر القطاع')
    if (!meetingDate) return toast.error('اختر تاريخ الاجتماع')
    if (!startsAt || !endsAt) return toast.error('أدخل وقتي البداية والنهاية')
    if (new Date(startsAt) >= new Date(endsAt)) return toast.error('وقت البداية يجب أن يسبق النهاية')

    setSaving(true)
    try {
      const { data: mrow, error: me } = await supabase
        .from('meetings')
        .upsert({ team_id: teamId, meeting_date: meetingDate, mtype }, { onConflict: 'team_id,meeting_date,mtype' })
        .select('id').maybeSingle()
      if (me) throw me

      const { error: ie } = await supabase.from('field_reservations').insert({
        team_id: teamId, field_zone_id: zoneId, starts_at: startsAt, ends_at: endsAt, meeting_id: mrow?.id || null
      })
      if (ie) {
        const msg = String(ie.message || '')
        if (msg.includes('field_reservations_no_overlap') || msg.includes('overlap'))
          throw new Error('تعذر الحجز: هناك تعارض مع فريق آخر في نفس الوقت لهذا القطاع')
        throw ie
      }
      toast.success('تم الحجز'); await refresh()
    } catch (e:any) { toast.error(e.message || 'تعذر الحجز') }
    finally { setSaving(false) }
  }

  async function cancel(id: string) {
    setCanceling(id)
    try {
      const { error } = await supabase.from('field_reservations').update({ soft_deleted_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      toast.success('تم إلغاء الحجز'); await refresh()
    } catch (e:any) { toast.error(e.message || 'تعذر الإلغاء') }
    finally { setCanceling(null) }
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">حجوزات قطاعات الأرض — (مسؤول الأدوات / قائد الفرقة)</h1>

      {/* الخرائط دائمًا */}
      <FieldMaps className="mb-4" sticky height="h-72 md:h-[28rem]" />

      {!isAdmin ? (
        <div className="mb-3 text-sm">
          <span className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border">
            تحجز الآن لفريق: <b>{teamName}</b>
          </span>
        </div>
      ) : (
        <div className="mb-3">
          <label className="text-sm">الفريق</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={teamId} onChange={e=>{
            const id = e.target.value; setTeamId(id); const t = teams.find(x=>x.id===id); setTeamName(t?.name || '')
          }}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      <div className={`${(!isAdmin && !gate.canBookReservations(teamId)) ? 'opacity-60 pointer-events-none' : ''}`}>
        <div className="grid md:grid-cols-5 gap-2 items-end">
          <div>
            <label className="text-sm">تاريخ الاجتماع</label>
            <input type="date" className="border rounded-xl p-2 w-full" value={meetingDate} onChange={e=>setMeetingDate(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">نوع اليوم</label>
            <select className="border rounded-xl p-2 w-full cursor-pointer" value={mtype} onChange={e=>setMtype(e.target.value as any)}>
              <option value="preparation">تحضير</option>
              <option value="meeting">اجتماع</option>
            </select>
          </div>
          <div>
            <label className="text-sm">القطاع</label>
            <select className="border rounded-xl p-2 w-full cursor-pointer" value={zoneId} onChange={e=>setZoneId(e.target.value)}>
              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm">من</label>
            <input type="datetime-local" className="border rounded-xl p-2 w-full" value={startsAt} onChange={e=>setStartsAt(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">إلى</label>
            <input type="datetime-local" className="border rounded-xl p-2 w-full" value={endsAt} onChange={e=>setEndsAt(e.target.value)} />
          </div>
          <div className="md:col-span-5 text-end">
            <LoadingButton loading={saving} onClick={save}>حجز القطاع</LoadingButton>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">حجوزات الفريق</h2>
        <div className="border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">القطاع</th>
                <th className="p-2 text-start">من</th>
                <th className="p-2 text-start">إلى</th>
                <th className="p-2 text-center">إلغاء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.field_zones?.name || '—'}</td>
                  <td className="p-2">{new Date(r.starts_at).toLocaleString()}</td>
                  <td className="p-2">{new Date(r.ends_at).toLocaleString()}</td>
                  <td className="p-2 text-center">
                    <button className="btn border" onClick={()=>cancel(r.id)} disabled={canceling===r.id}>{canceling===r.id ? '...' : 'إلغاء'}</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={4}>لا توجد حجوزات</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
