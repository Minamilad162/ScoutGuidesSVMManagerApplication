import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'
import OpsDashboardBlocks from '../pages/OpsDashboardBlocks'

type Team = { id: string; name: string }
type Rank = { id: number; rank_label: string | null }
type MemberLite = { id: string; team_id: string | null; is_equipier: boolean | null; rank_id: number | null }

type AttendanceRow = {
  member_id: string
  is_present: boolean
  is_excused: boolean | null
  meetings: { team_id: string; meeting_date: string }
}

type RoleRow = { role_slug: string; team_id: string | null }

const THIS_YEAR = new Date().getFullYear()
const pad = (n:number)=>String(n).padStart(2,'0')
const yearRange = (y:number)=>({ from: `${y}-01-01`, to: `${y}-12-31` })

function cls(...xs:(string|false|undefined)[]) { return xs.filter(Boolean).join(' ') }

export default function AdminDashboard() {
  const toast = useToast()

  // ===== Auth/role guard (اختياري: نسمح للمسؤولين فقط) =====
  const [isAdmin, setIsAdmin] = useState(false)

  // ===== Filters =====
  const [year, setYear] = useState<number>(THIS_YEAR)
  const [{from, to}, setRange] = useState<{from:string; to:string}>(yearRange(THIS_YEAR))
  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState<'all'|string>('all')

  // ===== Reference data =====
  const [ranks, setRanks] = useState<Rank[]>([])
  const [members, setMembers] = useState<MemberLite[]>([])

  // ===== Metrics state =====
  const [loading, setLoading] = useState(true)
  const [meetingsCount, setMeetingsCount] = useState(0)
  const [materialsCount, setMaterialsCount] = useState(0)
  const [matReservationsCount, setMatReservationsCount] = useState(0)
  const [fieldReservationsCount, setFieldReservationsCount] = useState(0)

  // Attendance raw (خلال النطاق)
  const [attRows, setAttRows] = useState<AttendanceRow[]>([])

  // ===== Init: صلاحيات + فرق + رتب =====
  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      // أدوار المستخدم الحالي
      const { data: roles } = await supabase.from('v_my_roles').select('role_slug,team_id')
      const rr: RoleRow[] = (roles as any[]) ?? []
      const _isAdmin = rr.some(r => r.role_slug === 'admin' || (r.role_slug === 'responsable_secretary' && r.team_id == null))
      setIsAdmin(_isAdmin)

      // فرق
      const { data: ts } = await supabase.from('teams').select('id,name').order('name')
      setTeams((ts as any[]) ?? [])

      // رتب (للعدّ حسب الرتبة)
      const { data: rs } = await supabase.from('ranks').select('id,rank_label').order('id')
      setRanks((rs as any[]) ?? [])

      // أعضاء (مصفوفة خفيفة: id,is_equipier,team,rank)
      const { data: ms } = await supabase
        .from('members')
        .select('id, team_id, is_equipier, rank_id')
      setMembers((ms as any[]) ?? [])

      await refreshAll(_isAdmin, (ts as any[]) ?? [])
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally {
      setLoading(false)
    }
  }

  // ===== إعادة التحميل عند تغيّر الفلاتر =====
  useEffect(() => { refreshAll(isAdmin, teams) }, [year, from, to, teamId])

  async function refreshAll(_isAdmin:boolean, teamList:Team[]) {
    setLoading(true)
    try {
      // الاجتماعات حسب النطاق + الفريق
      let mq = supabase
        .from('meetings')
        .select('id', { count: 'exact', head: true })
        .gte('meeting_date', from)
        .lte('meeting_date', to) as any
      if (teamId !== 'all') mq = mq.eq('team_id', teamId)
      const mres = await mq
      setMeetingsCount(mres.count ?? 0)

      // الأدوات و الحجوزات (مجمل)
      // ⚠️ لو عندك أعمدة وقت للحجز تقدر تضيف فلترة زمنية هنا
      const { count: mc } = await supabase.from('materials').select('id', { count:'exact', head:true })
      setMaterialsCount(mc ?? 0)
      const { count: mrc } = await supabase.from('material_reservations').select('id', { count:'exact', head:true })
      setMatReservationsCount(mrc ?? 0)
      const { count: frc } = await supabase.from('field_reservations').select('id', { count:'exact', head:true })
      setFieldReservationsCount(frc ?? 0)

      // الحضور/الغياب خلال النطاق
      let aq = supabase
        .from('attendance')
        .select('member_id,is_present,is_excused,meetings!inner(team_id,meeting_date)')
        .gte('meetings.meeting_date', from)
        .lte('meetings.meeting_date', to) as any
      if (teamId !== 'all') aq = aq.eq('meetings.team_id', teamId)
      const { data: att, error } = await aq
      if (error) throw error
      setAttRows((att as any[]) ?? [])
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحديث البيانات')
    } finally {
      setLoading(false)
    }
  }

  // ===== خرائط مساعدة =====
  const teamName = useMemo(
    () => Object.fromEntries(teams.map(t => [t.id, t.name])),
    [teams]
  )
  const memberById = useMemo(() => {
    const m = new Map<string, MemberLite>()
    members.forEach(x => m.set(x.id, x))
    return m
  }, [members])

  // ===== تجميع الحضور والغياب =====
  const attendanceAgg = useMemo(() => {
    const all = { present:0, total:0, absent:0, unexcused:0 }
    const perTeam = new Map<string, { present:number; total:number; absent:number; unexcused:number }>()
    const chefsAbs = new Map<string, { absent:number; total:number }>()      // chefs فقط
    const equipsAbs = new Map<string, { absent:number; total:number }>()     // equipiers فقط

    for (const r of attRows) {
      const team = r.meetings?.team_id
      if (!team) continue
      const m = memberById.get(r.member_id)
      if (!m) continue

      // الجميع
      all.total += 1
      if (r.is_present) all.present += 1
      else {
        all.absent += 1
        if (!r.is_excused) all.unexcused += 1
      }

      // لكل فريق
      if (!perTeam.has(team)) perTeam.set(team, { present:0, total:0, absent:0, unexcused:0 })
      const t = perTeam.get(team)!
      t.total += 1
      if (r.is_present) t.present += 1
      else { t.absent += 1; if (!r.is_excused) t.unexcused += 1 }

      // تقسيم: شفّات vs إكويبيير
      const isEquip = !!m.is_equipier
      const map = isEquip ? equipsAbs : chefsAbs
      if (!map.has(team)) map.set(team, { absent:0, total:0 })
      const bucket = map.get(team)!
      bucket.total += 1
      if (!r.is_present) bucket.absent += 1
    }

    // Top teams (حسب الغياب)
    const toArray = (mp:Map<string,{absent:number;total:number}>) =>
      Array.from(mp.entries())
        .map(([team, v]) => ({ team_id: team, team: teamName[team] || team, absent: v.absent, total: v.total, rate: v.total? Math.round(v.absent*100/v.total):0 }))
        .sort((a,b)=> b.absent - a.absent)

    return {
      all,
      perTeam,
      topChefs: toArray(chefsAbs).slice(0,5),
      topEquips: toArray(equipsAbs).slice(0,5),
    }
  }, [attRows, memberById, teamName])

  // ===== عدّاد الأعضاء حسب الرتبة (للفريق المحدد أو الكل) =====
  const rankCards = useMemo(() => {
    const ids = new Set<string>()
    if (teamId === 'all') members.forEach(m => m.team_id && ids.add(m.team_id))
    const filteredMembers = teamId === 'all' ? members : members.filter(m => m.team_id === teamId)

    const byRank = new Map<number, number>()
    filteredMembers.forEach(m => {
      const rid = m.rank_id ?? -1
      byRank.set(rid, (byRank.get(rid) || 0) + 1)
    })
    return ranks.map(r => ({
      id: r.id,
      label: r.rank_label || '—',
      count: byRank.get(r.id) || 0
    }))
  }, [members, ranks, teamId])

  // ===== كروت إجمالية =====
  const totalTeams = useMemo(() => teamId==='all' ? teams.length : 1, [teamId, teams.length])
  const totalMembers = useMemo(() => (teamId==='all' ? members.length : members.filter(m=>m.team_id===teamId).length), [members, teamId])
  const totalChefs = useMemo(() => (teamId==='all' ? members.filter(m=>!m.is_equipier).length : members.filter(m=>m.team_id===teamId && !m.is_equipier).length), [members, teamId])
  const totalEquips = useMemo(() => (teamId==='all' ? members.filter(m=>m.is_equipier).length : members.filter(m=>m.team_id===teamId && m.is_equipier).length), [members, teamId])

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold">لوحة القياس — الإدارة</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm">السنة</label>
          <select className="border rounded-xl p-2" value={year} onChange={e=>{
            const y = Number(e.target.value)
            setYear(y); setRange(yearRange(y))
          }}>
            {Array.from({length:6}).map((_,i)=>{ const y=THIS_YEAR-i; return <option key={y} value={y}>{y}</option> })}
          </select>
        </div>
      </div>

      {/* فلاتر */}
      <div className="card">
        <div className="grid md:grid-cols-5 gap-2 items-end">
          <div>
            <label className="text-sm">الفريق</label>
            <select className="border rounded-xl p-2 w-full" value={teamId} onChange={e=>setTeamId(e.target.value as any)}>
              <option value="all">كل الفرق</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm">من</label>
            <input type="date" className="border rounded-xl p-2 w-full" value={from} onChange={e=>setRange(r=>({...r, from: e.target.value}))}/>
          </div>
          <div>
            <label className="text-sm">إلى</label>
            <input type="date" className="border rounded-xl p-2 w-full" value={to} onChange={e=>setRange(r=>({...r, to: e.target.value}))}/>
          </div>
          <div className="md:col-span-2 md:text-end">
            <button className="btn border" onClick={()=>refreshAll(isAdmin, teams)}>تحديث</button>
          </div>
        </div>
      </div>

      {/* كروت إجمالية */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">عدد الفرق</div>
          <div className="text-2xl font-extrabold">{totalTeams}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">إجمالي الأعضاء</div>
          <div className="text-2xl font-extrabold">{totalMembers}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">القادة (Chefs)</div>
          <div className="text-2xl font-extrabold">{totalChefs}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">الإكويبيير</div>
          <div className="text-2xl font-extrabold">{totalEquips}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">الاجتماعات في النطاق</div>
          <div className="text-2xl font-extrabold">{meetingsCount}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">حضور</div>
          <div className="text-2xl font-extrabold">{attendanceAgg.all.present}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">غياب</div>
          <div className="text-2xl font-extrabold">{attendanceAgg.all.absent}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">غياب بدون عذر</div>
          <div className="text-2xl font-extrabold">{attendanceAgg.all.unexcused}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">الأدوات</div>
          <div className="text-2xl font-extrabold">{materialsCount}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">حجوزات الأدوات</div>
          <div className="text-2xl font-extrabold">{matReservationsCount}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">حجوزات الأرض</div>
          <div className="text-2xl font-extrabold">{fieldReservationsCount}</div>
        </div>
      </div>

      {/* عدّاد الرتب (كروت) */}
      <div className="space-y-2">
        <div className="font-semibold">توزيع الأعضاء حسب الرتبة</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {rankCards.map(rc => (
            <div key={rc.id} className="card text-center">
              <div className="text-sm text-gray-600 mb-1">{rc.label}</div>
              <div className="text-2xl font-extrabold">{rc.count}</div>
            </div>
          ))}
          {rankCards.every(x=>x.count===0) && <div className="card text-center text-gray-500 sm:col-span-2 lg:col-span-4">لا توجد بيانات</div>}
        </div>
      </div>

      {/* ليدر بورد: أكثر الفرق غيابًا (Chefs) */}
      <div className="space-y-2">
        <div className="font-semibold">أكثر الفرق غيابًا — القادة (Chefs)</div>
        <div className="rounded-2xl border overflow-hidden">
          <table className="w-full text-sm table-auto">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الفريق</th>
                <th className="p-2 text-center">الغياب</th>
                <th className="p-2 text-center">الإجمالي</th>
                <th className="p-2 text-center">النسبة</th>
              </tr>
            </thead>
            <tbody>
              {attendanceAgg.topChefs.map(r => (
                <tr key={r.team_id} className="border-t">
                  <td className="p-2">{r.team}</td>
                  <td className="p-2 text-center">{r.absent}</td>
                  <td className="p-2 text-center">{r.total}</td>
                  <td className="p-2 text-center">{r.total? `${r.rate}%` : '—'}</td>
                </tr>
              ))}
              {attendanceAgg.topChefs.length===0 && <tr><td className="p-3 text-center text-gray-500" colSpan={4}>لا توجد بيانات</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* ليدر بورد: أكثر الفرق غيابًا (Equipiers) */}
      <div className="space-y-2">
        <div className="font-semibold">أكثر الفرق غيابًا — الإكويبيير</div>
        <div className="rounded-2xl border overflow-hidden">
          <table className="w-full text-sm table-auto">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الفريق</th>
                <th className="p-2 text-center">الغياب</th>
                <th className="p-2 text-center">الإجمالي</th>
                <th className="p-2 text-center">النسبة</th>
              </tr>
            </thead>
            <tbody>
              {attendanceAgg.topEquips.map(r => (
                <tr key={r.team_id} className="border-t">
                  <td className="p-2">{r.team}</td>
                  <td className="p-2 text-center">{r.absent}</td>
                  <td className="p-2 text-center">{r.total}</td>
                  <td className="p-2 text-center">{r.total? `${r.rate}%` : '—'}</td>
                </tr>
              ))}
              {attendanceAgg.topEquips.length===0 && <tr><td className="p-3 text-center text-gray-500" colSpan={4}>لا توجد بيانات</td></tr>}
            </tbody>
          </table>
        </div>
      
      <div className="space-y-6">
  {/* … أدواتك/إحصائياتك الحالية … */}
  <OpsDashboardBlocks />
</div>



      </div>
    </div>
  )
}
