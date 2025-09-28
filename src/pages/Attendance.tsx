
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import { LoadingButton } from '../components/ui/LoadingButton'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'

type Team = { id: string; name: string }
type Term = { id: string; name: string; year: number; start_date: string | null; end_date: string | null }
type Member = { id: string; full_name: string; auth_user_id: string | null; rank_id: number | null }
type Rank = { id: number; rank_label: string }
type MeetingType = 'meeting' | 'preparation'
type Stat = { present: number; absent: number; total: number }

export default function Attendance() {
  const { user, roles } = useAuth()
  const toast = useToast()
  const isAdmin = roles.some(r => r.role_slug === 'admin')

  // ---------- Shared selectors ----------
  const [teams, setTeams] = useState<Team[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [teamId, setTeamId] = useState<string>('')
  const [termId, setTermId] = useState<string>('')

  // ---------- READ section state ----------
  const [members, setMembers] = useState<Member[]>([])
  const [ranks, setRanks] = useState<Record<number, string>>({})
  const [mtypeFilter, setMtypeFilter] = useState<'' | MeetingType>('') // '' => كل الأنواع
  const [stats, setStats] = useState<Record<string, Stat>>({})
  const [totalMeetings, setTotalMeetings] = useState<number>(0)

  // ---------- WRITE section ----------
  const [leaders, setLeaders] = useState<Member[]>([])
  const [adminOverrideAll, setAdminOverrideAll] = useState<boolean>(false)
  const [date, setDate] = useState<string>('')
  const [mtypeWrite, setMtypeWrite] = useState<MeetingType>('meeting')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [presence, setPresence] = useState<Record<string, boolean>>({})

  // ---------- UI feedback ----------
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [saving, setSaving] = useState<boolean>(false)

  useEffect(() => { init() }, [user])
  async function init() {
    if (!user) return
    setLoading(true); setErr(null); setMsg(null)
    try {
      const [{ data: tm, error: te }, { data: ts, error: tse }, { data: rk, error: re }] = await Promise.all([
        supabase.from('terms').select('id,name,year,start_date,end_date').order('year', { ascending: false }).order('name', { ascending: true }),
        supabase.from('teams').select('id,name').order('name'),
        supabase.from('ranks').select('id,rank_label').order('id')
      ])
      if (te) throw te
      if (tse) throw tse
      if (re) throw re
      setTerms((tm as any) ?? [])
      setTeams((ts as any) ?? [])
      const rankMap: Record<number, string> = {}
      for (const r of (rk as any[] ?? [])) rankMap[r.id] = r.rank_label
      setRanks(rankMap)
      if (!termId && tm && tm.length) setTermId(tm[0].id)
      if (!teamId && ts && ts.length) setTeamId(ts[0].id)
    } catch (e: any) {
      setErr(e.message || 'خطأ أثناء التحميل')
    } finally {
      setLoading(false)
    }
  }

  // Load all members of team (for READ) and also for write-override
  useEffect(() => { if (teamId) loadMembers(teamId) }, [teamId])
  async function loadMembers(tid: string) {
    setErr(null)
    const { data, error } = await supabase
      .from('members')
      .select('id, full_name, auth_user_id, rank_id')
      .eq('team_id', tid)
      .order('full_name')
    if (error) { setErr(error.message); return }
    setMembers((data as any) ?? [])
  }

  // Compute stats for READ
  useEffect(() => { if (teamId && termId) loadStats() }, [teamId, termId, mtypeFilter, members])
  async function loadStats() {
    setErr(null); setStats({}); setTotalMeetings(0)
    const term = terms.find(t => t.id === termId)
    if (!term?.start_date || !term?.end_date) return

    // Count meetings in range
    let meetingsQuery = supabase
      .from('meetings')
      .select('id, mtype, meeting_date')
      .eq('team_id', teamId)
      .gte('meeting_date', term.start_date)
      .lte('meeting_date', term.end_date)
    if (mtypeFilter) meetingsQuery = meetingsQuery.eq('mtype', mtypeFilter)
    const { data: meetRows, error: meetErr } = await meetingsQuery
    if (meetErr) { setErr(meetErr.message); return }
    const total = (meetRows as any[] ?? []).length
    setTotalMeetings(total)

    // Attendance rows joined to these meetings
    let attQuery = supabase
      .from('attendance')
      .select('member_id, is_present, meetings!inner(id, team_id, meeting_date, mtype)')
      .eq('meetings.team_id', teamId)
      .gte('meetings.meeting_date', term.start_date)
      .lte('meetings.meeting_date', term.end_date)
    if (mtypeFilter) attQuery = attQuery.eq('meetings.mtype', mtypeFilter)
    const { data: attRows, error: attErr } = await attQuery
    if (attErr) { setErr(attErr.message); return }
    const rows = (attRows as any[] ?? [])

    // present = count(is_present=true), absent = totalMeetings - present
    const presentByMember = new Map<string, number>()
    for (const r of rows) {
      if (r.is_present) {
        const mid = r.member_id as string
        presentByMember.set(mid, (presentByMember.get(mid) || 0) + 1)
      }
    }
    const result: Record<string, Stat> = {}
    for (const m of members) {
      const p = presentByMember.get(m.id) || 0
      const a = Math.max(total - p, 0)
      result[m.id] = { present: p, absent: a, total }
    }
    setStats(result)
  }

  // Leaders list (team or global role)
  useEffect(() => { if (teamId) loadLeaders(teamId) }, [teamId])
  async function loadLeaders(tid: string) {
    setErr(null); setMsg(null)
    const { data: ur, error: er1 } = await supabase
      .from('user_roles_view')
      .select('user_id, role_slug, team_id')
      .eq('role_slug', 'chef_de_legion')
      .or(`team_id.eq.${tid},team_id.is.null`)
    if (er1) { setErr(er1.message); return }

    const { data: ms, error: er2 } = await supabase
      .from('members')
      .select('id, full_name, auth_user_id, rank_id')
      .eq('team_id', tid)
      .order('full_name')
    if (er2) { setErr(er2.message); return }

    const userIds = new Set(((ur as any[]) || []).map(u => u.user_id))
    const list = ((ms as any[]) || []).filter(m => m.auth_user_id && userIds.has(m.auth_user_id))

    setLeaders(list as any)

    const ids = (list as any[]).map(l => l.id as string)
    setSelectedIds(new Set(ids))
    const pres: Record<string, boolean> = {}
    for (const id of ids) pres[id] = true
    setPresence(pres)
  }

  // Write-list to display: leaders by default; or all members if admin override ON or leaders empty
  const adminOverrideAllDefault = leaders.length === 0
  useEffect(() => {
    if (adminOverrideAllDefault) setAdminOverrideAll(true)
  }, [adminOverrideAllDefault])
  const writeList: Member[] = useMemo(() => {
    if (adminOverrideAll || leaders.length === 0) return members
    return leaders
  }, [adminOverrideAll, leaders, members])

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  function togglePresence(id: string) {
    setPresence(prev => ({ ...prev, [id]: !prev[id] }))
  }
  function setAllPresence(val: boolean) {
    setPresence(prev => {
      const ids = writeList.map(m => m.id)
      const n: Record<string, boolean> = { ...prev }
      for (const id of ids) n[id] = val
      return n
    })
  }
  function selectAll(val: boolean) {
    if (val) setSelectedIds(new Set(writeList.map(l => l.id)))
    else setSelectedIds(new Set())
  }

  async function saveAttendance() {
    setErr(null); setMsg(null)
    if (!isAdmin) { setErr('هذه الصفحة مخصصة للأدمن'); return }
    if (!teamId || !date) { setErr('اختر الفريق والتاريخ'); return }
    if (selectedIds.size === 0) { setErr('اختر واحدًا على الأقل'); return }
    setSaving(true)
    try {
      const { data: mt, error: me } = await supabase
        .from('meetings')
        .upsert({ team_id: teamId, meeting_date: date, mtype: mtypeWrite }, { onConflict: 'team_id,meeting_date,mtype' })
        .select('id')
        .single()
      if (me) throw me
      const meeting_id = (mt as any).id as string

      const payload = Array.from(selectedIds).map(id => ({
        meeting_id, member_id: id, is_present: !!presence[id]
      }))
      const { error: ae } = await supabase.from('attendance').upsert(payload, { onConflict: 'meeting_id,member_id' })
      if (ae) throw ae

      setMsg('تم حفظ الحضور/الغياب')
      toast.success('تم حفظ الحضور/الغياب')
      await loadStats()
    } catch (e: any) {
      setErr(e.message || 'تعذر الحفظ')
      toast.error(e.message || 'تعذر الحفظ')
    } finally {
      setSaving(false)
    }
  }

  const rankLabel = (rid: number | null) => (rid && ranks[rid]) ? ranks[rid] : '—'
  const selectedCount = selectedIds.size
  const presentCount = writeList.filter(m => selectedIds.has(m.id) && presence[m.id]).length

  return (
    <div className="p-6 space-y-8">
      <PageLoader visible={loading} text="جاري تحميل البيانات..." />

      {err && <div className="text-red-600 text-sm">{err}</div>}
      {msg && <div className="text-green-700 text-sm">{msg}</div>}

      {!loading && !isAdmin && <div className="p-6">هذه الصفحة مخصصة للأدمن فقط.</div>}

      {!loading && isAdmin && (
        <>
          {/* ============ READ SECTION ============ */}
          <section className="card space-y-4">
            <h2 className="text-lg font-bold">قراءة الحضور/الغياب — كل أعضاء الفريق</h2>
            <div className="grid md:grid-cols-4 gap-3 items-end">
              <div>
                <label className="text-sm">الفريق</label>
                <select className="border rounded-xl p-2 w-full cursor-pointer" value={teamId} onChange={e=>setTeamId(e.target.value)}>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm">الترم</label>
                <select className="border rounded-xl p-2 w-full cursor-pointer" value={termId} onChange={e=>setTermId(e.target.value)}>
                  {terms.map(t => <option key={t.id} value={t.id}>{t.year} — {t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm">نوع اليوم</label>
                <select className="border rounded-xl p-2 w-full cursor-pointer" value={mtypeFilter} onChange={e=>setMtypeFilter(e.target.value as any)}>
                  <option value="">الكل</option>
                  <option value="meeting">اجتماع</option>
                  <option value="preparation">تحضير</option>
                </select>
              </div>
            </div>

            <div className="text-xs text-gray-500">
              إجمالي الاجتماعات بالفترة المحددة: <b>{totalMeetings}</b> (الغياب = الإجمالي − مرات الحضور)
            </div>

            <div className="border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2 text-start">الاسم</th>
                    <th className="p-2">الرتبة</th>
                    <th className="p-2">حضور</th>
                    <th className="p-2">غياب</th>
                    <th className="p-2">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(m => {
                    const s = stats[m.id] || { present: 0, absent: totalMeetings, total: totalMeetings }
                    return (
                      <tr key={m.id} className="border-t">
                        <td className="p-2">{m.full_name}</td>
                        <td className="p-2 text-center">{rankLabel(m.rank_id)}</td>
                        <td className="p-2 text-center">{s.present}</td>
                        <td className="p-2 text-center">{s.absent}</td>
                        <td className="p-2 text-center">{s.total}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ============ WRITE SECTION ============ */}
          <section className="card space-y-4">
            <h2 className="text-lg font-bold">تسجيل حضور/غياب — قادة Chef de legion</h2>

            <div className="grid md:grid-cols-5 gap-3 items-end">
              <div>
                <label className="text-sm">الفريق</label>
                <select className="border rounded-xl p-2 w-full cursor-pointer" value={teamId} onChange={e=>setTeamId(e.target.value)}>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm">التاريخ</label>
                <input type="date" className="border rounded-xl p-2 w-full cursor-pointer" value={date} onChange={e=>setDate(e.target.value)} />
              </div>
              <div>
                <label className="text-sm">نوع اليوم</label>
                <select className="border rounded-xl p-2 w-full cursor-pointer" value={mtypeWrite} onChange={e=>setMtypeWrite(e.target.value as MeetingType)}>
                  <option value="meeting">اجتماع</option>
                  <option value="preparation">تحضير</option>
                </select>
              </div>
              <div className="text-sm">
                <label className="text-sm">العمليات السريعة</label>
                <div className="flex gap-2 flex-wrap">
                  <button className="btn border cursor-pointer" onClick={()=>selectAll(true)}>تحديد الكل</button>
                  <button className="btn border cursor-pointer" onClick={()=>selectAll(false)}>إلغاء تحديد الكل</button>
                  <button className="btn border cursor-pointer" onClick={()=>setAllPresence(true)}>الكل حاضر</button>
                  <button className="btn border cursor-pointer" onClick={()=>setAllPresence(false)}>الكل غائب</button>
                </div>
              </div>
              <div className="text-sm">
                <label className="text-sm">وضع طوارئ (أظهر كل أعضاء الفريق)</label>
                <div>
                  <input type="checkbox" className="cursor-pointer" checked={adminOverrideAll} onChange={e=>setAdminOverrideAll(e.target.checked)} /> <span className="text-sm">تفعيل/تعطيل</span>
                </div>
              </div>
            </div>

            <div className="border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2 text-start">الاسم</th>
                    <th className="p-2">الرتبة</th>
                    <th className="p-2 text-center">اختيار</th>
                    <th className="p-2 text-center">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {writeList.map(l => (
                    <tr key={l.id} className="border-t">
                      <td className="p-2">{l.full_name}</td>
                      <td className="p-2 text-center">{rankLabel(l.rank_id)}</td>
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          className="cursor-pointer"
                          checked={selectedIds.has(l.id)}
                          onChange={()=>toggleSelect(l.id)}
                        />
                      </td>
                      <td className="p-2 text-center">
                        <button className={`btn ${presence[l.id] ? 'btn-brand' : 'border'} cursor-pointer`} onClick={()=>togglePresence(l.id)}>
                          {presence[l.id] ? 'حاضر' : 'غائب'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-sm text-gray-600">المحدَّدون: {selectedCount} — الحاضرون: {presentCount}</div>
            <div className="flex justify-end">
              <LoadingButton loading={saving} onClick={saveAttendance}>حفظ</LoadingButton>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
