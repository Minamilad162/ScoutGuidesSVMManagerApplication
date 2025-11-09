// src/pages/TeamSecretaryAttendance.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'
import { LoadingButton } from '../components/ui/LoadingButton'
import { useAuth } from '../components/AuthProvider'

type Team = { id: string; name: string }
type Term = { id: string; name: string; year: number; start_date: string|null; end_date: string|null }
type Equipier = { id: string; full_name: string }
type Counts = { present: number; total: number; absent_excused: number; absent_unexcused: number }

type TermDateRow = { id: string; meeting_date: string } // YYYY-MM-DD

export default function TeamSecretaryAttendance() {
  const toast = useToast()
  const { roles } = useAuth()
  const isAdmin = roles.some(r => r.role_slug === 'admin')
  const isGlobalSec = roles.some(r => r.role_slug === 'responsable_secretary' && (r.team_id === null || r.team_id === undefined))

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState<string>('')
  const [teamName, setTeamName] = useState<string>('')

  const [terms, setTerms] = useState<Term[]>([])
  const [termId, setTermId] = useState<string>('')

  // ✅ تواريخ الترم
  const [termDates, setTermDates] = useState<TermDateRow[]>([])
  const hasTermDates = termDates.length > 0
  const [useCustomDay, setUseCustomDay] = useState<boolean>(false)

  const [list, setList] = useState<Equipier[]>([])
  const [meetingDate, setMeetingDate] = useState<string>('')
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [counts, setCounts] = useState<Record<string, Counts>>({})

  const termMeta = useMemo(() => terms.find(t => t.id === termId) || null, [terms, termId])

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const { data: tm, error: terr } = await supabase
        .from('terms')
        .select('id,name,year,start_date,end_date')
        .order('year', { ascending: false })
        .order('name', { ascending: true })
      if (terr) throw terr
      setTerms(tm ?? [])
      if (tm && tm.length) setTermId(tm[0].id)

      if (isAdmin || isGlobalSec) {
        const { data: ts, error: tErr } = await supabase.from('teams').select('id,name').order('name')
        if (tErr) throw tErr
        setTeams(ts ?? [])
        if (ts && ts.length) { setTeamId(ts[0].id); setTeamName(ts[0].name) }
      } else {
        const { data: me, error: meErr } = await supabase.from('v_me').select('team_id').maybeSingle()
        if (meErr) throw meErr
        if (!me?.team_id) throw new Error('لا يوجد فريق مرتبط بحسابك')
        setTeamId(me.team_id)
        const { data: t } = await supabase.from('teams').select('name').eq('id', me.team_id).maybeSingle()
        setTeamName(t?.name || '—')
      }

      // تاريخ افتراضي (اليوم)
      const now = new Date(); const pad=(n:number)=>String(n).padStart(2,'0')
      const d = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
      setMeetingDate(d)
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally { setLoading(false) }
  }

  // ✅ تحميل تواريخ الترم المختار
  useEffect(() => { if (termId) loadTermDates(termId) }, [termId])
  async function loadTermDates(tid: string) {
    try {
      const { data, error } = await supabase
        .from('term_meeting_dates')
        .select('id, meeting_date')
        .eq('term_id', tid)
        .order('meeting_date', { ascending: true })
      if (error) throw error
      const list = (data as TermDateRow[]) ?? []
      setTermDates(list)
      if (list.length > 0) {
        setUseCustomDay(false)
        setMeetingDate(list[0].meeting_date)
        await loadMeetingAttendanceForDate(list[0].meeting_date)
      } else {
        setUseCustomDay(true)
      }
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل تواريخ الترم')
    }
  }

  useEffect(() => { if (teamId) refreshList() }, [teamId])
  useEffect(() => { if (teamId && termId) refreshCounts() }, [teamId, termId])

  async function refreshList() {
    try {
      const { data, error } = await supabase.from('members')
        .select('id, full_name')
        .eq('team_id', teamId).eq('is_equipier', true).order('full_name')
      if (error) throw error
      const arr = (data as any[]) ?? []
      setList(arr)
      const c: Record<string, boolean> = {}; const r: Record<string, string> = {}
      arr.forEach(m => { c[m.id] = false; r[m.id] = '' })
      setChecks(c); setReasons(r)
      if (meetingDate) await loadMeetingAttendanceForDate(meetingDate, arr.map(x=>x.id))
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الأفراد')
    }
  }

  // ===== احصاءات الترم من الView (مع fallback) =====
  async function refreshCounts() {
    try {
      if (!teamId || !termId) { setCounts({}); return }
      const { data, error } = await supabase
        .from('v_equipier_term_stats')
        .select('member_id, present, total, absent_excused, absent_unexcused')
        .eq('team_id', teamId)
        .eq('term_id', termId)
      if (error) throw error
      const map: Record<string, Counts> = {}
      ;(data as any[] ?? []).forEach(r => {
        map[r.member_id] = {
          present: Number(r.present)||0,
          total: Number(r.total)||0,
          absent_excused: Number(r.absent_excused)||0,
          absent_unexcused: Number(r.absent_unexcused)||0
        }
      })
      setCounts(map)
    } catch (e:any) {
      await refreshCountsFallback()
    }
  }

  async function refreshCountsFallback() {
    try {
      const term = terms.find(t => t.id === termId)
      if (!term?.start_date || !term?.end_date) { setCounts({}); return }
      const { data, error } = await supabase
        .from('attendance')
        .select('member_id, is_present, absence_reason, meetings!inner(meeting_date, mtype, team_id)')
        .eq('meetings.team_id', teamId)
        .eq('meetings.mtype', 'meeting')
        .gte('meetings.meeting_date', term.start_date)
        .lte('meetings.meeting_date', term.end_date)
      if (error) throw error
      const map: Record<string, Counts> = {}
      ;(data as any[] ?? []).forEach(r => {
        const id = r.member_id as string
        if (!map[id]) map[id] = { present: 0, total: 0, absent_excused: 0, absent_unexcused: 0 }
        map[id].total += 1
        if (r.is_present) map[id].present += 1
        else {
          const exc = r.absence_reason && String(r.absence_reason).trim() !== ''
          if (exc) map[id].absent_excused += 1
          else map[id].absent_unexcused += 1
        }
      })
      setCounts(map)
    } catch { setCounts({}) }
  }

  async function loadMeetingAttendanceForDate(dateISO: string, memberIds?: string[]) {
    try {
      const { data: mrow } = await supabase
        .from('meetings')
        .select('id')
        .eq('team_id', teamId)
        .eq('meeting_date', dateISO)
        .eq('mtype', 'meeting')
        .maybeSingle()
      if (!mrow?.id) {
        const ids = memberIds ?? list.map(x=>x.id)
        const c: Record<string, boolean> = {}; const r: Record<string, string> = {}
        ids.forEach(id => { c[id] = false; r[id] = '' })
        setChecks(c); setReasons(r)
        return
      }
      const { data: attRows } = await supabase
        .from('attendance')
        .select('member_id, is_present, absence_reason')
        .eq('meeting_id', mrow.id)
      const c: Record<string, boolean> = {}; const r: Record<string, string> = {}
      const ids = memberIds ?? list.map(x=>x.id)
      ids.forEach(id => { c[id] = false; r[id] = '' })
      ;(attRows as any[] ?? []).forEach(a => {
        c[a.member_id] = !!a.is_present
        r[a.member_id] = a.is_present ? '' : (a.absence_reason || '')
      })
      setChecks(c); setReasons(r)
    } catch {/* silent */}
  }

  async function saveAttendance() {
    setSaving(true)
    try {
      if (!meetingDate) throw new Error('اختر تاريخ الاجتماع')
      const { data: mrow, error: me } = await supabase
        .from('meetings')
        .upsert({ team_id: teamId, meeting_date: meetingDate, mtype: 'meeting' }, { onConflict: 'team_id,meeting_date,mtype' })
        .select('id').maybeSingle()
      if (me) throw me
      const meeting_id = mrow?.id
      if (!meeting_id) throw new Error('تعذر إنشاء سجل الاجتماع')

      const payload = Object.entries(checks).map(([member_id, present]) => ({
        meeting_id, member_id, is_present: !!present,
        absence_reason: present ? null : ((reasons[member_id] || '').trim() || null)
      }))
      if (!payload.length) throw new Error('لا يوجد أفراد')

      const { error: ae } = await supabase.from('attendance').upsert(payload, { onConflict: 'meeting_id,member_id' })
      if (ae) throw ae

      toast.success('تم حفظ الحضور')
      await refreshCounts()
      await loadMeetingAttendanceForDate(meetingDate)
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحفظ')
    } finally { setSaving(false) }
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">حضور وغياب — سكرتارية الفريق</h1>

      {(isAdmin || isGlobalSec) ? (
        <div className="mb-3">
          <label className="text-sm">الفريق</label>
          <select
            className="border rounded-xl p-2 w-full min-w-0 cursor-pointer"
            value={teamId}
            onChange={e=>{
              const id = e.target.value; setTeamId(id)
              const t = teams.find(x=>x.id===id); setTeamName(t?.name || '')
            }}
          >
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      ) : (
        <div className="mb-3 text-sm">
          <span className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border">
            فريقك: <b>{teamName}</b>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 items-end">
        <div>
          <label className="text-sm">الترم</label>
          <select
            className="border rounded-xl p-2 w-full min-w-0 cursor-pointer"
            value={termId}
            onChange={e=>setTermId(e.target.value)}
          >
            {terms.map(t => <option key={t.id} value={t.id}>{t.year} — {t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm">تاريخ الاجتماع</label>
          {hasTermDates && !useCustomDay ? (
            <>
              <select
                className="border rounded-xl p-2 w-full min-w-0 cursor-pointer"
                value={meetingDate}
                onChange={async e=>{
                  const v = e.target.value
                  if (v === '__custom__') { setUseCustomDay(true); return }
                  setMeetingDate(v)
                  await loadMeetingAttendanceForDate(v)
                }}
              >
                {termDates.map(d => (
                  <option key={d.id} value={d.meeting_date}>{d.meeting_date}</option>
                ))}
                <option value="__custom__">— تاريخ آخر —</option>
              </select>
              <div className="text-[11px] text-gray-500 mt-1">اختر من جدول الترم أو اختر "تاريخ آخر".</div>
            </>
          ) : (
            <>
              <input
                type="date"
                className="border rounded-xl p-2 w-full min-w-0"
                value={meetingDate}
                onChange={async e=>{
                  const v = e.target.value
                  setMeetingDate(v)
                  await loadMeetingAttendanceForDate(v)
                }}
                min={termMeta?.start_date ?? undefined}
                max={termMeta?.end_date ?? undefined}
              />
              {hasTermDates && (
                <button
                  type="button"
                  className="text-[12px] underline mt-1"
                  onClick={()=>{
                    if (termDates.length){
                      setUseCustomDay(false)
                      const d = termDates[0].meeting_date
                      setMeetingDate(d)
                      loadMeetingAttendanceForDate(d)
                    }
                  }}
                >الرجوع لاختيار من جدول الترم</button>
              )}
            </>
          )}
        </div>
        <div className="text-end">
          <LoadingButton loading={saving} onClick={saveAttendance}>حفظ الحضور</LoadingButton>
        </div>
      </div>

      <div className="border rounded-2xl w-full max-w-full overflow-x-auto mt-3">
        <table className="w-full min-w-[900px] text-xs sm:text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-start">الاسم</th>
              <th className="p-2 text-center whitespace-nowrap">حضر؟</th>
              <th className="p-2 text-start">عذر الغياب (إن وُجد)</th>
              <th className="p-2 text-center whitespace-nowrap">حضوره في الترم</th>
            </tr>
          </thead>
          <tbody>
            {list.map(m => {
              const c = counts[m.id] || { present: 0, total: 0, absent_excused: 0, absent_unexcused: 0 }
              const present = !!checks[m.id]
              return (
                <tr key={m.id} className="border-t align-top">
                  <td className="p-2">{m.full_name}</td>
                  <td className="p-2 text-center whitespace-nowrap">
                    <input
                      type="checkbox"
                      className="scale-125 cursor-pointer"
                      checked={present}
                      onChange={e=>{
                        const v = e.target.checked
                        setChecks(p=>({...p, [m.id]: v}))
                        if (v) setReasons(r=>({...r, [m.id]: ''}))
                      }}
                    />
                  </td>
                  <td className="p-2">
                    {!present ? (
                      <input
                        className="border rounded-xl p-2 w-full min-w-0"
                        placeholder="اكتب العذر (اختياري)"
                        value={reasons[m.id] || ''}
                        onChange={e=>setReasons(r=>({...r, [m.id]: e.target.value}))}
                      />
                    ) : <span className="text-xs text-gray-500">—</span>}
                  </td>
                  <td className="p-2 text-center whitespace-nowrap">
                    <span className="px-2 py-1 rounded-full bg-white border text-[11px] sm:text-xs">
                      {c.present} من {c.total} — {c.total ? Math.round((c.present/c.total)*100) : 0}%
                      <br />
                      <span className="text-[10px] sm:text-[11px] text-gray-600">بعذر {c.absent_excused} / بدون {c.absent_unexcused}</span>
                    </span>
                  </td>
                </tr>
              )
            })}
            {list.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={4}>لا توجد بيانات</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
