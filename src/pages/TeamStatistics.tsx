// src/pages/TeamStatistics.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'
import { LoadingButton } from '../components/ui/LoadingButton'
import { useAuth } from '../components/AuthProvider'

type Team = { id: string; name: string }
type Term = { id: string; name: string; year: number; start_date: string|null; end_date: string|null }
type Member = { id: string; full_name: string }
type MeetingRow = { id: string; meeting_date: string }

type TermStatsRow = { member_id: string; present: number; total: number; absent_excused: number; absent_unexcused: number }

type MeetingDayRow = {
  member_id: string
  full_name: string
  is_present: boolean
  absence_reason: string | null
}

type MemberTimelineRow = {
  meeting_id: string
  meeting_date: string
  is_present: boolean
  absence_reason: string | null
}

type TabKey = 'by_meeting' | 'by_term' | 'by_member'

export default function TeamStatistics() {
  const toast = useToast()
  const { roles } = useAuth()
  const isAdmin = roles.some(r => r.role_slug === 'admin')
  const isGlobalSec = roles.some(r => r.role_slug === 'responsable_secretary' && (r.team_id === null || r.team_id === undefined))

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState<string>('')
  const [teamName, setTeamName] = useState<string>('')

  const [terms, setTerms] = useState<Term[]>([])
  const [termId, setTermId] = useState<string>('')

  // Tabs
  const [tab, setTab] = useState<TabKey>('by_meeting')

  // Meetings (for selected term)
  const [meetings, setMeetings] = useState<MeetingRow[]>([])
  const [meetingDate, setMeetingDate] = useState<string>('') // YYYY-MM-DD
  const [meetingDayRows, setMeetingDayRows] = useState<MeetingDayRow[]>([])
  const [meetingKpis, setMeetingKpis] = useState({ total: 0, present: 0, abs_excused: 0, abs_unexcused: 0, ratio: 0 })

  // Term (per-member) stats
  const [termStats, setTermStats] = useState<TermStatsRow[]>([])
  const [members, setMembers] = useState<Member[]>([])

  // فردي (حسب الشخص)
  const [selectedMemberId, setSelectedMemberId] = useState<string>('')
  const [memberKpis, setMemberKpis] = useState<{ present: number; total: number; absent_excused: number; absent_unexcused: number; ratio: number }>({
    present: 0, total: 0, absent_excused: 0, absent_unexcused: 0, ratio: 0
  })
  const [memberTimeline, setMemberTimeline] = useState<MemberTimelineRow[]>([])

  /* INIT */
  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      // Load terms
      const { data: tm, error: terr } = await supabase
        .from('terms')
        .select('id,name,year,start_date,end_date')
        .order('year', { ascending: false })
        .order('name', { ascending: true })
      if (terr) throw terr
      setTerms(tm ?? [])
      if (tm && tm.length) setTermId(tm[0].id)

      // Teams scope
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
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally {
      setLoading(false)
    }
  }

  // when teamId/termId change → load meetings (term range) + members + stats
  useEffect(() => {
    if (!teamId || !termId) return
    loadMembers()
    loadMeetingsForTerm()
    loadTermStats()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, termId])

  async function loadMembers() {
    try {
      const { data, error } = await supabase
        .from('members')
        .select('id, full_name')
        .eq('team_id', teamId)
        .eq('is_equipier', true)
        .order('full_name')
      if (error) throw error
      const arr = (data as Member[]) ?? []
      setMembers(arr)
      if (arr.length) setSelectedMemberId(arr[0].id)
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الأفراد')
    }
  }

  async function loadMeetingsForTerm() {
    try {
      const t = terms.find(x => x.id === termId)
      const start = t?.start_date || null
      const end   = t?.end_date   || null

      let q = supabase
        .from('meetings')
        .select('id, meeting_date')
        .eq('team_id', teamId)
        .eq('mtype', 'meeting')
        .order('meeting_date', { ascending: true })
      if (start) q = q.gte('meeting_date', start)
      if (end)   q = q.lte('meeting_date', end)

      const { data, error } = await q
      if (error) throw error
      const list = (data as MeetingRow[]) ?? []
      setMeetings(list)
      const last = list.length ? list[list.length - 1].meeting_date : ''
      setMeetingDate(last)

      if (last) await loadMeetingDay(last)
      else {
        setMeetingDayRows([])
        setMeetingKpis({ total: 0, present: 0, abs_excused: 0, abs_unexcused: 0, ratio: 0 })
      }
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الاجتماعات')
    }
  }

  /* ====== BY MEETING ====== */
  async function loadMeetingDay(dateISO: string) {
    if (!dateISO) { setMeetingDayRows([]); return }
    setBusy(true)
    try {
      const { data: mrow } = await supabase
        .from('meetings')
        .select('id')
        .eq('team_id', teamId)
        .eq('meeting_date', dateISO)
        .eq('mtype', 'meeting')
        .maybeSingle()

      const baseRows: MeetingDayRow[] = members.map(m => ({
        member_id: m.id,
        full_name: m.full_name,
        is_present: false,
        absence_reason: null
      }))

      if (!mrow?.id) {
        // مفيش سجل اجتماع ⇒ اعتبر الكل غياب بدون عذر
        setMeetingDayRows(baseRows)
        setMeetingKpis({
          total: baseRows.length,
          present: 0,
          abs_excused: 0,
          abs_unexcused: baseRows.length,
          ratio: 0
        })
        return
      }

      const { data: atts, error: aErr } = await supabase
        .from('attendance')
        .select('member_id, is_present, absence_reason')
        .eq('meeting_id', mrow.id)
      if (aErr) throw aErr

      const map = new Map<string, { is_present: boolean; absence_reason: string|null }>()
      ;(atts ?? []).forEach(a => map.set(a.member_id as string, { is_present: !!a.is_present, absence_reason: a.absence_reason || null }))

      const merged = baseRows.map(r => {
        const v = map.get(r.member_id)
        return v ? { ...r, is_present: v.is_present, absence_reason: v.is_present ? null : (v.absence_reason || null) } : r
      })

      // KPIs
      let present = 0, abs_excused = 0, abs_unexcused = 0
      merged.forEach(r => {
        if (r.is_present) present++
        else if (r.absence_reason && r.absence_reason.trim() !== '') abs_excused++
        else abs_unexcused++
      })
      const total = merged.length
      const ratio = total ? Math.round((present / total) * 100) : 0

      setMeetingDayRows(merged)
      setMeetingKpis({ total, present, abs_excused, abs_unexcused, ratio })
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل حضور اليوم')
    } finally {
      setBusy(false)
    }
  }

  /* ====== BY TERM (TEAM) ====== */
  async function loadTermStats() {
    setBusy(true)
    try {
      const { data, error } = await supabase
        .from('v_equipier_term_stats')
        .select('member_id, present, total, absent_excused, absent_unexcused')
        .eq('team_id', teamId)
        .eq('term_id', termId)

      if (!error && data) {
        setTermStats((data as any as TermStatsRow[]) ?? [])
        return
      }

      // Fallback: من الاجتماعات داخل الترم
      const t = terms.find(x => x.id === termId)
      if (!t?.start_date || !t?.end_date) { setTermStats([]); return }

      const { data: meetingRows, error: mErr } = await supabase
        .from('meetings')
        .select('id')
        .eq('team_id', teamId)
        .eq('mtype', 'meeting')
        .gte('meeting_date', t.start_date)
        .lte('meeting_date', t.end_date)
      if (mErr) throw mErr

      const mids = (meetingRows ?? []).map(x => x.id)
      if (!mids.length) { setTermStats([]); return }

      const { data: atts, error: aErr } = await supabase
        .from('attendance')
        .select('member_id, is_present, absence_reason, meeting_id')
        .in('meeting_id', mids)
      if (aErr) throw aErr

      const map = new Map<string, TermStatsRow>()
      ;(atts ?? []).forEach(a => {
        const id = a.member_id as string
        if (!map.has(id)) map.set(id, { member_id: id, present: 0, total: 0, absent_excused: 0, absent_unexcused: 0 })
        const row = map.get(id)!
        row.total += 1
        if (a.is_present) row.present += 1
        else if (a.absence_reason && String(a.absence_reason).trim() !== '') row.absent_excused += 1
        else row.absent_unexcused += 1
      })

      setTermStats(Array.from(map.values()))
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل إحصائيات الترم')
      setTermStats([])
    } finally {
      setBusy(false)
    }
  }

  /* ====== BY MEMBER ====== */
  useEffect(() => {
    if (!teamId || !termId || !selectedMemberId) return
    if (tab !== 'by_member') return
    loadMemberStatsAndTimeline(selectedMemberId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, termId, selectedMemberId, tab, meetings.length])

  async function loadMemberStatsAndTimeline(memberId: string) {
    setBusy(true)
    try {
      // كل اجتماعات الترم الحالية:
      const mids = meetings.map(m => m.id)
      const totalMeetings = meetings.length

      if (!totalMeetings) {
        setMemberKpis({ present:0,total:0,absent_excused:0,absent_unexcused:0, ratio:0 })
        setMemberTimeline([])
        return
      }

      // اسحب حضور هذا العضو فقط
      const { data: atts2 } = await supabase
        .from('attendance')
        .select('meeting_id, is_present, absence_reason')
        .in('meeting_id', mids)
        .eq('member_id', memberId)

      const map = new Map<string, { is_present: boolean; absence_reason: string | null }>()
      ;(atts2 ?? []).forEach(a => map.set(a.meeting_id as string, { is_present: !!a.is_present, absence_reason: a.absence_reason || null }))

      // تايملاين + حساب KPIs عبر كل الاجتماعات (حتى اللي مفيهاش سجل → غياب بدون عذر)
      let present=0, abs_exc=0, abs_un=0
      const merged: MemberTimelineRow[] = meetings.map(m => {
        const v = map.get(m.id)
        const is_present = v ? v.is_present : false
        const reason = v ? (v.is_present ? null : (v.absence_reason || null)) : null
        if (is_present) present += 1
        else if (reason && reason.trim() !== '') abs_exc += 1
        else abs_un += 1

        return {
          meeting_id: m.id,
          meeting_date: m.meeting_date,
          is_present,
          absence_reason: reason
        }
      })

      const ratio = totalMeetings ? Math.round((present/totalMeetings)*100) : 0
      setMemberKpis({ present, total: totalMeetings, absent_excused: abs_exc, absent_unexcused: abs_un, ratio })
      setMemberTimeline(merged)
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل إحصائيات الفرد')
      setMemberKpis({ present:0,total:0,absent_excused:0,absent_unexcused:0, ratio:0 })
      setMemberTimeline([])
    } finally {
      setBusy(false)
    }
  }

  /* Helpers */
  const memberNameById = (id: string) => members.find(m => m.id === id)?.full_name || '—'

  const termTotals = useMemo(() => {
    let present = 0, total = 0, abs_excused = 0, abs_un = 0
    termStats.forEach(r => {
      present += r.present
      total   += r.total
      abs_excused += r.absent_excused
      abs_un += r.absent_unexcused
    })
    const ratio = total ? Math.round((present / total) * 100) : 0
    return { present, total, abs_excused, abs_un, ratio }
  }, [termStats])

  const topAbsentees = useMemo(() => {
    const withRatio = termStats.map(r => ({ ...r, ratio: r.total ? r.present / r.total : 0 }))
    withRatio.sort((a,b) => a.ratio - b.ratio || b.total - a.total)
    return withRatio.slice(0, 5)
  }, [termStats])

  /* UI */
  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">إحصائيات الفريق</h1>

      {(isAdmin || isGlobalSec) ? (
        <div className="mb-2">
          <label className="text-sm">الفريق</label>
          <select
            className="border rounded-xl p-2 w-full min-w-0 cursor-pointer"
            value={teamId}
            onChange={e=>{
              const id = e.target.value
              setTeamId(id)
              const t = teams.find(x=>x.id===id); setTeamName(t?.name || '')
            }}
          >
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      ) : (
        <div className="mb-2 text-sm">
          <span className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border">
            فريقك: <b>{teamName}</b>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
        <div>
          <label className="text-sm">الترم</label>
          <select
            className="border rounded-xl p-2 w-full min-w-0 cursor-pointer"
            value={termId}
            onChange={e=>setTermId(e.target.value)}
          >
            {terms.map(t => <option key={t.id} value={t.id}>{t.year} — {t.name}</option>)}
          </select>
          {(() => {
            const t = terms.find(x=>x.id===termId)
            return (t?.start_date && t?.end_date)
              ? <div className="text-[11px] text-gray-500 mt-1">نطاق الترم: {t.start_date} → {t.end_date}</div>
              : null
          })()}
        </div>

        {/* Tabs with nicer buttons */}
        <div className="md:col-span-2">
          <label className="text-sm">العرض</label>
          <div className="flex items-center gap-2 flex-wrap">
            <TabButton active={tab==='by_meeting'} onClick={()=>setTab('by_meeting')}>حسب الاجتماع</TabButton>
            <TabButton active={tab==='by_term'} onClick={()=>setTab('by_term')}>حسب الترم (الفريق)</TabButton>
            <TabButton active={tab==='by_member'} onClick={()=>setTab('by_member')}>حسب الفرد</TabButton>
          </div>
        </div>
      </div>

      {/* BY MEETING */}
      {tab === 'by_meeting' && (
        <section className="space-y-4">
          <div className="card p-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
              <div className="md:col-span-2">
                <label className="text-sm">تاريخ الاجتماع</label>
                <select
                  className="border rounded-xl p-2 w-full min-w-0 cursor-pointer"
                  value={meetingDate}
                  onChange={async e=>{
                    const v = e.target.value
                    setMeetingDate(v)
                    await loadMeetingDay(v)
                  }}
                >
                  {meetings.map(m => <option key={m.id} value={m.meeting_date}>{m.meeting_date}</option>)}
                </select>
                {meetings.length === 0 && <div className="text-xs text-gray-500 mt-1">لا توجد اجتماعات ضمن نطاق الترم المختار.</div>}
              </div>
              <div className="text-end">
                <LoadingButton loading={busy} onClick={()=>loadMeetingDay(meetingDate)}>تحديث</LoadingButton>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <KpiCard label="إجمالي Equipier" value={meetingKpis.total} />
            <KpiCard label="حضر" value={meetingKpis.present} />
            <KpiCard label="غياب بعذر" value={meetingKpis.abs_excused} />
            <KpiCard label="غياب بدون عذر" value={meetingKpis.abs_unexcused} />
            <KpiCard label="نسبة الحضور" value={`${meetingKpis.ratio}%`} />
          </div>

          <div className="border rounded-2xl overflow-x-auto">
            <table className="w-full min-w-[820px] text-xs sm:text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-start">الاسم</th>
                  <th className="p-2 text-center whitespace-nowrap">حضر؟</th>
                  <th className="p-2 text-start">عذر الغياب</th>
                </tr>
              </thead>
              <tbody>
                {meetingDayRows.map(r => (
                  <tr key={r.member_id} className="border-t">
                    <td className="p-2">{r.full_name}</td>
                    <td className="p-2 text-center">
                      <span className={`px-2 py-1 rounded-full text-[11px] border ${r.is_present ? 'bg-green-50 border-green-200 text-green-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                        {r.is_present ? 'حضر' : 'غاب'}
                      </span>
                    </td>
                    <td className="p-2">{r.is_present ? <span className="text-xs text-gray-500">—</span> : (r.absence_reason || <span className="text-xs text-gray-500">—</span>)}</td>
                  </tr>
                ))}
                {meetingDayRows.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={3}>لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* BY TERM */}
      {tab === 'by_term' && (
        <section className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <KpiCard label="إجمالي سجلات الحضور" value={termTotals.total} />
            <KpiCard label="مجموع مرات الحضور" value={termTotals.present} />
            <KpiCard label="غياب بعذر" value={termTotals.abs_excused} />
            <KpiCard label="غياب بدون عذر" value={termTotals.abs_un} />
            <KpiCard label="نسبة الحضور العامة" value={`${termTotals.ratio}%`} />
          </div>

          <div className="card p-3">
            <h3 className="font-semibold mb-2">أكثر ٥ يحتاجوا متابعة (حسب أقل نسبة حضور)</h3>
            <div className="grid gap-2">
              {topAbsentees.map(r => {
                const ratio = r.total ? Math.round((r.present / r.total) * 100) : 0
                return (
                  <div key={r.member_id} className="flex items-center gap-3">
                    <div className="w-48 truncate">{memberNameById(r.member_id)}</div>
                    <Progress ratio={ratio} />
                    <div className="ml-auto text-xs whitespace-nowrap">{r.present} من {r.total} — {ratio}%</div>
                  </div>
                )
              })}
              {topAbsentees.length === 0 && <div className="text-xs text-gray-500">لا توجد بيانات</div>}
            </div>
          </div>

          <div className="border rounded-2xl overflow-x-auto">
            <table className="w-full min-w-[950px] text-xs sm:text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-start">الاسم</th>
                  <th className="p-2 text-center whitespace-nowrap">الحضور</th>
                  <th className="p-2 text-center whitespace-nowrap">النسبة</th>
                  <th className="p-2 text-center whitespace-nowrap">بعذر / بدون</th>
                  <th className="p-2 text-start">شريط التقدم</th>
                </tr>
              </thead>
              <tbody>
                {members.map(m => {
                  const r = termStats.find(x => x.member_id === m.id) || { present:0, total:0, absent_excused:0, absent_unexcused:0 }
                  const ratio = r.total ? Math.round((r.present / r.total) * 100) : 0
                  return (
                    <tr key={m.id} className="border-t">
                      <td className="p-2">{m.full_name}</td>
                      <td className="p-2 text-center">{r.present} من {r.total}</td>
                      <td className="p-2 text-center">{ratio}%</td>
                      <td className="p-2 text-center">{r.absent_excused} / {r.absent_unexcused}</td>
                      <td className="p-2"><Progress ratio={ratio} /></td>
                    </tr>
                  )
                })}
                {members.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={5}>لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="text-end">
            <LoadingButton loading={busy} onClick={loadTermStats}>تحديث</LoadingButton>
          </div>
        </section>
      )}

      {/* BY MEMBER */}
      {tab === 'by_member' && (
        <section className="space-y-4">
          <div className="card p-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
              <div className="md:col-span-2">
                <label className="text-sm">الطالب</label>
                <select
                  className="border rounded-xl p-2 w-full min-w-0 cursor-pointer"
                  value={selectedMemberId}
                  onChange={e=>setSelectedMemberId(e.target.value)}
                >
                  {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                </select>
                <div className="text-[11px] text-gray-500 mt-1">
                  يُعرض أدناه ملخص حضور {memberNameById(selectedMemberId)} خلال الترم المختار، وجدول بكل الاجتماعات.
                </div>
              </div>
              <div className="text-end">
                <LoadingButton loading={busy} onClick={()=>loadMemberStatsAndTimeline(selectedMemberId)}>تحديث</LoadingButton>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <KpiCard label="إجمالي الاجتماعات" value={memberKpis.total} />
            <KpiCard label="حضر" value={memberKpis.present} />
            <KpiCard label="غياب بعذر" value={memberKpis.absent_excused} />
            <KpiCard label="غياب بدون عذر" value={memberKpis.absent_unexcused} />
            <KpiCard label="نسبة الحضور" value={`${memberKpis.ratio}%`} />
          </div>

          <div className="border rounded-2xl overflow-x-auto">
            <table className="w-full min-w-[780px] text-xs sm:text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-start">تاريخ الاجتماع</th>
                  <th className="p-2 text-center whitespace-nowrap">الحالة</th>
                  <th className="p-2 text-start">عذر الغياب</th>
                </tr>
              </thead>
              <tbody>
                {memberTimeline.map(r => (
                  <tr key={r.meeting_id} className="border-t">
                    <td className="p-2">{r.meeting_date}</td>
                    <td className="p-2 text-center">
                      <span className={`px-2 py-1 rounded-full text-[11px] border ${r.is_present ? 'bg-green-50 border-green-200 text-green-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                        {r.is_present ? 'حضر' : 'غاب'}
                      </span>
                    </td>
                    <td className="p-2">{r.is_present ? <span className="text-xs text-gray-500">—</span> : (r.absence_reason || <span className="text-xs text-gray-500">—</span>)}</td>
                  </tr>
                ))}
                {memberTimeline.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={3}>لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

/* ============ UI helpers ============ */
function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="kpi bg-white rounded-2xl border p-3">
      <div className="text-xs text-gray-600">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  )
}

function Progress({ ratio }: { ratio: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(ratio)))
  return (
    <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
      <div className="h-full bg-[#0ea5e9]" style={{ width: `${clamped}%` }} />
    </div>
  )
}

/** Tab button with clear borders + active state */
function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm transition',
        active
          ? 'bg-white border-sky-300 text-sky-700 shadow-sm'
          : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-white hover:border-gray-300'
      ].join(' ')}
    >
      {children}
    </button>
  )
}
