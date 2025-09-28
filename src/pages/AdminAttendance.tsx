// src/pages/AdminAttendance.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ui/Toaster'
import { PageLoader } from '../components/ui/PageLoader'
import { LoadingButton } from '../components/ui/LoadingButton'

type Team = { id: string; name: string }
type Term = { id: string; name: string; year: number; start_date: string | null; end_date: string | null }

type RankObj = { rank_slug: string | null; rank_label: string | null }

type Member = {
  id: string
  full_name: string
  team_id: string
  rank?: RankObj | null
}

type DayStatus = {
  present?: boolean
  is_excused?: boolean
  excuse_note?: string
}

type ScopeRead = 'range' | 'year' | 'term'

export default function AdminAttendance() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)

  // ====== Teams / Terms ======
  const [teams, setTeams] = useState<Team[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [teamNameMap, setTeamNameMap] = useState<Map<string,string>>(new Map())

  // ====== READ (Stats) filters — مستقلة ======
  const [readTeamId, setReadTeamId] = useState<string>('all') // 'all' => كل الفرق
  const [readScope, setReadScope] = useState<ScopeRead>('range')
  const [readFrom, setReadFrom] = useState<string>('')
  const [readTo, setReadTo] = useState<string>('')
  const [readYear, setReadYear] = useState<number>(new Date().getFullYear())
  const [readTermId, setReadTermId] = useState<string>('')

  // ====== WRITE (Chef de legion attendance) filters — مستقلة ======
  const [writeTeamId, setWriteTeamId] = useState<string>('')       // فريق الكتابة أو "all"
  const [writeDate, setWriteDate] = useState<string>('')           // تاريخ التسجيل
  const [writeType, setWriteType] = useState<'preparation'|'meeting'>('meeting')

  // ====== READ data ======
  const [readMembers, setReadMembers] = useState<Member[]>([])
  const [readRows, setReadRows] = useState<any[]>([]) // rows للجدول

  // ====== WRITE data ======
  const [chefs, setChefs] = useState<Member[]>([]) // أعضاء rank = chef_de_legion (فريق واحد أو كل الفرق)
  const [dayStatus, setDayStatus] = useState<Record<string, DayStatus>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      // فرق
      const { data: ts, error: te } = await supabase.from('teams').select('id,name').order('name')
      if (te) throw te
      const tlist = (ts as Team[]) ?? []
      setTeams(tlist)
      setTeamNameMap(new Map(tlist.map(t => [t.id, t.name])))

      // ترمات
      const { data: tms, error: trE } = await supabase
        .from('terms').select('id,name,year,start_date,end_date')
        .order('year', { ascending: false }).order('name', { ascending: true })
      if (trE) throw trE
      const tmsList = (tms as Term[]) ?? []
      setTerms(tmsList)
      if (tmsList.length) setReadTermId(tmsList[0].id)

      // تواريخ افتراضية للقراءة (الشهر الحالي)
      const today = new Date(); const pad = (n:number)=>String(n).padStart(2,'0')
      const start = new Date(today.getFullYear(), today.getMonth(), 1)
      setReadFrom(`${start.getFullYear()}-${pad(start.getMonth()+1)}-${pad(start.getDate())}`)
      setReadTo(`${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`)
      setReadYear(today.getFullYear())

      // افتراض الكتابة: أول فريق لو موجود
      if (tlist.length) setWriteTeamId(tlist[0].id)
      setWriteDate(`${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`)
      setWriteType('meeting')
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally {
      setLoading(false)
    }
  }

  // ====== READ: تحميل الأعضاء (Chef de legion فقط) حسب "الكل" أو فريق محدد ======
  useEffect(() => { loadReadMembers() }, [readTeamId])
  async function loadReadMembers() {
    try {
      let q = supabase
        .from('members')
        .select('id, full_name, team_id, ranks!inner(rank_slug,rank_label)')
        .eq('ranks.rank_slug', 'chef_de_legion')
        .order('full_name', { ascending: true }) as any

      if (readTeamId !== 'all') q = q.eq('team_id', readTeamId)

      const { data, error } = await q
      if (error) throw error

      // Supabase بيرجع ranks كـ Array — نفلّتها إلى عنصر واحد
      const mapped: Member[] = ((data as any[]) ?? []).map(r => ({
        id: r.id,
        full_name: r.full_name,
        team_id: r.team_id,
        rank: Array.isArray(r.ranks) ? (r.ranks[0] as RankObj ?? null) : (r.ranks as RankObj ?? null),
      }))
      setReadMembers(mapped)
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الأعضاء (الإحصائيات)')
    }
  }

  // ====== READ: حساب الفترة الزمنية الفعلية من الفلاتر ======
  function computeReadRange(): { from?: string, to?: string } {
    if (readScope === 'range') {
      return { from: readFrom || undefined, to: readTo || undefined }
    }
    if (readScope === 'year') {
      const y = readYear || new Date().getFullYear()
      return { from: `${y}-01-01`, to: `${y}-12-31` }
    }
    // term
    const t = terms.find(x => x.id === readTermId)
    return { from: (t?.start_date || undefined), to: (t?.end_date || undefined) }
  }

  // ====== READ: تحميل الإحصائيات ======
  async function loadStats() {
    const { from, to } = computeReadRange()
    setLoading(true)
    try {
      // meetings
      let mq = supabase
        .from('meetings')
        .select('id, team_id, meeting_date, mtype') as any
      if (readTeamId !== 'all') mq = mq.eq('team_id', readTeamId)
      if (from) mq = mq.gte('meeting_date', from)
      if (to) mq = mq.lte('meeting_date', to)
      mq = mq.order('meeting_date', { ascending: true })

      const { data: meets, error: me } = await mq
      if (me) throw me

      const meetingIds = (meets as any[] ?? []).map(x => x.id)
      if (!meetingIds.length) { setReadRows([]); setLoading(false); return }

      // attendance (مع بعذر/بدون)
      const { data: atts, error: ae } = await supabase
        .from('attendance')
        .select('meeting_id, member_id, is_present, is_excused')
        .in('meeting_id', meetingIds)
      if (ae) throw ae

      // build maps
      const nameByMember: Record<string, string> = {}
      const rankByMember: Record<string, string> = {}
      const teamByMember: Record<string, string> = {}
      readMembers.forEach(m => {
        nameByMember[m.id] = m.full_name
        rankByMember[m.id] = m.rank?.rank_label || 'Chef de legion'
        teamByMember[m.id] = teamNameMap.get(m.team_id) || '—'
      })

      const map: Record<string, {
        present: number, excused: number, unexcused: number, total: number,
        name: string, rank: string, team_name: string
      }> = {}

      ;(atts as any[] ?? []).forEach(a => {
        const mid = a.member_id
        if (!nameByMember[mid]) return // خارج الفلتر (مش Chef)
        if (!map[mid]) {
          map[mid] = {
            present: 0, excused: 0, unexcused: 0, total: 0,
            name: nameByMember[mid], rank: rankByMember[mid], team_name: teamByMember[mid]
          }
        }
        map[mid].total += 1
        if (a.is_present) map[mid].present += 1
        else (a.is_excused ? map[mid].excused++ : map[mid].unexcused++)
      })

      const rows = Object.values(map).sort((a,b) => a.name.localeCompare(b.name, 'ar'))
      setReadRows(rows)
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الإحصائيات')
    } finally {
      setLoading(false)
    }
  }

  // ====== WRITE: تحميل Chef de legion للفريق المختار أو لكل الفرق ======
  useEffect(() => { if (writeTeamId) loadChefs() }, [writeTeamId])
  async function loadChefs() {
    try {
      let q = supabase
        .from('members')
        .select('id, full_name, team_id, ranks!inner(rank_slug,rank_label)')
        .eq('ranks.rank_slug', 'chef_de_legion')
        .order('team_id', { ascending: true })
        .order('full_name', { ascending: true }) as any

      if (writeTeamId !== 'all') q = q.eq('team_id', writeTeamId)

      const { data, error } = await q
      if (error) throw error

      const list: Member[] = ((data as any[]) ?? []).map(r => ({
        id: r.id,
        full_name: r.full_name,
        team_id: r.team_id,
        rank: Array.isArray(r.ranks) ? (r.ranks[0] as RankObj ?? null) : (r.ranks as RankObj ?? null),
      }))
      setChefs(list)
      setDayStatus({})
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل قادة الفرقة')
    }
  }

  // ====== WRITE: تحكم الحالة ======
  function setPresent(mid: string, v: boolean) {
    setDayStatus(prev => {
      const curr = prev[mid] || {}
      return { ...prev, [mid]: { ...curr, present: v, ...(v ? { is_excused: false, excuse_note: '' } : {}) } }
    })
  }
  function setExcused(mid: string, v: boolean) {
    setDayStatus(prev => {
      const curr = prev[mid] || {}
      return { ...prev, [mid]: { ...curr, is_excused: v } }
    })
  }
  function setNote(mid: string, v: string) {
    setDayStatus(prev => {
      const curr = prev[mid] || {}
      return { ...prev, [mid]: { ...curr, excuse_note: v } }
    })
  }

  // ====== WRITE: حفظ ======
  const [savingBusy, setSavingBusy] = useState(false)
  async function saveAttendance() {
    if (!writeDate) return toast.error('اختر التاريخ')
    if (!chefs.length) return toast.error('لا يوجد Chef de legion للحفظ')

    setSaving(true); setSavingBusy(true)
    try {
      // لو فريق معيّن: اجتماع واحد
      if (writeTeamId !== 'all') {
        const { data: mrow, error: me } = await supabase
          .from('meetings')
          .upsert({ team_id: writeTeamId, meeting_date: writeDate, mtype: writeType }, { onConflict: 'team_id,meeting_date,mtype' })
          .select('id')
          .maybeSingle()
        if (me) throw me
        const meetingId = mrow?.id
        if (!meetingId) throw new Error('تعذر إنشاء/الوصول للاجتماع')

        const rows = chefs.map(m => {
          const st = dayStatus[m.id] || {}
          const present = st.present === true
          const absent  = st.present === false
          return {
            meeting_id: meetingId,
            member_id: m.id,
            is_present: present,
            is_excused: present ? false : !!st.is_excused,
            excuse_note: present ? null : (st.excuse_note || null),
          }
        }).filter(r => typeof r.is_present === 'boolean')

        if (!rows.length) { toast.error('لم يتم تحديد أي حضور/غياب'); setSaving(false); setSavingBusy(false); return }

        const { error: aerr } = await supabase
          .from('attendance')
          .upsert(rows, { onConflict: 'meeting_id,member_id' })
        if (aerr) throw aerr
      } else {
        // "الكل": ننشئ اجتماع لكل فريق موجود له Chef ونحفظ حضور كل قائد على اجتماع فريقه
        const teamIds = Array.from(new Set(chefs.map(c => c.team_id)))
        if (!teamIds.length) throw new Error('لا توجد فرق')

        // أنشئ/احصل على اجتماع لكل فريق
        const teamMeetingMap = new Map<string, string>() // team_id -> meeting_id
        // نعملها على التوالي لتبسيط الأخطاء
        for (const tid of teamIds) {
          const { data: mrow, error: me } = await supabase
            .from('meetings')
            .upsert({ team_id: tid, meeting_date: writeDate, mtype: writeType }, { onConflict: 'team_id,meeting_date,mtype' })
            .select('id')
            .maybeSingle()
          if (me) throw me
          if (!mrow?.id) throw new Error(`تعذر إنشاء/الوصول لاجتماع الفريق ${teamNameMap.get(tid) || tid}`)
          teamMeetingMap.set(tid, mrow.id)
        }

        // حضّر صفوف الحضور موزّعة على الاجتماعات الصحيحة
        const rows = chefs.map(m => {
          const st = dayStatus[m.id] || {}
          const present = st.present === true
          const absent  = st.present === false
          const meeting_id = teamMeetingMap.get(m.team_id)
          if (!meeting_id) return null
          return {
            meeting_id,
            member_id: m.id,
            is_present: present,
            is_excused: present ? false : !!st.is_excused,
            excuse_note: present ? null : (st.excuse_note || null),
          }
        }).filter((r: any) => r && typeof r.is_present === 'boolean') as any[]

        if (!rows.length) { toast.error('لم يتم تحديد أي حضور/غياب'); setSaving(false); setSavingBusy(false); return }

        // نرفعهم دفعة واحدة
        const { error: aerr } = await supabase
          .from('attendance')
          .upsert(rows, { onConflict: 'meeting_id,member_id' })
        if (aerr) throw aerr
      }

      toast.success('تم حفظ الحضور')
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحفظ')
    } finally {
      setSaving(false); setSavingBusy(false)
    }
  }

  // ====== مشتقات للعرض ======
  const showTeamColumnInRead = readTeamId === 'all'
  const showTeamColumnInWrite = writeTeamId === 'all'

  // ====== UI ======
  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">حضور/غياب — (إدمن)</h1>

      {/* READ: إحصائيات الحضور لِـ Chef de legion فقط */}
      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">إحصائيات الحضور (Chef de legion)</h2>

        <div className="grid md:grid-cols-5 gap-2 items-end">
          <div>
            <label className="text-sm">الفريق</label>
            <select className="border rounded-xl p-2 w-full cursor-pointer" value={readTeamId} onChange={e=>setReadTeamId(e.target.value)}>
              <option value="all">الكل</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div>
            <label className="text-sm">النطاق</label>
            <select className="border rounded-xl p-2 w-full cursor-pointer" value={readScope} onChange={e=>setReadScope(e.target.value as ScopeRead)}>
              <option value="range">مدى (من/إلى)</option>
              <option value="year">سنة كاملة</option>
              <option value="term">ترم</option>
            </select>
          </div>

          {/* مدى */}
          {readScope === 'range' && (
            <>
              <div>
                <label className="text-sm">من</label>
                <input type="date" className="border rounded-xl p-2 w-full" value={readFrom} onChange={e=>setReadFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-sm">إلى</label>
                <input type="date" className="border rounded-xl p-2 w-full" value={readTo} onChange={e=>setReadTo(e.target.value)} />
              </div>
              <div className="text-end">
                <button className="btn border" onClick={loadStats}>عرض الإحصائيات</button>
              </div>
            </>
          )}

          {/* سنة */}
          {readScope === 'year' && (
            <>
              <div>
                <label className="text-sm">السنة</label>
                <input type="number" className="border rounded-xl p-2 w-full" value={readYear}
                       onChange={e=>setReadYear(Number(e.target.value)||new Date().getFullYear())}/>
              </div>
              <div className="md:col-span-2 text-end">
                <button className="btn border" onClick={loadStats}>عرض الإحصائيات</button>
              </div>
            </>
          )}

          {/* ترم */}
          {readScope === 'term' && (
            <>
              <div className="md:col-span-2">
                <label className="text-sm">الترم</label>
                <select className="border rounded-xl p-2 w-full cursor-pointer" value={readTermId} onChange={e=>setReadTermId(e.target.value)}>
                  {terms.map(t => (
                    <option key={t.id} value={t.id}>{t.year} — {t.name}</option>
                  ))}
                </select>
              </div>
              <div className="text-end">
                <button className="btn border" onClick={loadStats}>عرض الإحصائيات</button>
              </div>
            </>
          )}
        </div>

        <div className="border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                {showTeamColumnInRead && <th className="p-2 text-start">الفريق</th>}
                <th className="p-2 text-start">الاسم</th>
                <th className="p-2 text-start">الرتبة</th>
                <th className="p-2 text-center">حضور</th>
                <th className="p-2 text-center">غياب بعذر</th>
                <th className="p-2 text-center">غياب بدون عذر</th>
                <th className="p-2 text-center">الإجمالي</th>
                <th className="p-2 text-center">نسبة الحضور</th>
              </tr>
            </thead>
            <tbody>
              {readRows.map((r:any, i:number) => {
                const pct = r.total > 0 ? Math.round((r.present / r.total) * 100) : 0
                return (
                  <tr key={i} className="border-t">
                    {showTeamColumnInRead && <td className="p-2">{r.team_name}</td>}
                    <td className="p-2">{r.name}</td>
                    <td className="p-2">{r.rank}</td>
                    <td className="p-2 text-center">{r.present}</td>
                    <td className="p-2 text-center">{r.excused}</td>
                    <td className="p-2 text-center">{r.unexcused}</td>
                    <td className="p-2 text-center">{r.total}</td>
                    <td className="p-2 text-center">
                      <span className={`inline-flex items-center justify-center min-w-[56px] px-2 py-1 rounded-full text-xs ${pct>=80?'bg-emerald-50 border border-emerald-300 text-emerald-700': pct>=60?'bg-amber-50 border border-amber-300 text-amber-700':'bg-rose-50 border border-rose-300 text-rose-700'}`}>
                        {r.total > 0 ? `${pct}%` : '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {readRows.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={showTeamColumnInRead ? 8 : 7}>لا توجد بيانات</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* WRITE: تسجيل حضور Chef de legion فقط */}
      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">تسجيل حضور — (Chef de legion فقط)</h2>

        <div className="grid md:grid-cols-5 gap-2 items-end">
          <div>
            <label className="text-sm">الفريق</label>
            <select className="border rounded-xl p-2 w-full cursor-pointer" value={writeTeamId} onChange={e=>setWriteTeamId(e.target.value)}>
              <option value="all">الكل</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm">التاريخ</label>
            <input type="date" className="border rounded-xl p-2 w-full" value={writeDate} onChange={e=>setWriteDate(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">نوع اليوم</label>
            <select className="border rounded-xl p-2 w-full cursor-pointer" value={writeType} onChange={e=>setWriteType(e.target.value as any)}>
              <option value="preparation">تحضير</option>
              <option value="meeting">اجتماع</option>
            </select>
          </div>
          <div className="md:col-span-2 text-end">
            <LoadingButton loading={saving} onClick={saveAttendance}>حفظ الحضور</LoadingButton>
          </div>
        </div>

        <div className="border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                {showTeamColumnInWrite && <th className="p-2 text-start">الفريق</th>}
                <th className="p-2 text-start">الاسم</th>
                <th className="p-2 text-center">حاضر</th>
                <th className="p-2 text-center">غائب</th>
                <th className="p-2 text-center">بعذر؟</th>
                <th className="p-2 text-start">العذر</th>
              </tr>
            </thead>
            <tbody>
              {chefs.map(m => {
                const st = dayStatus[m.id] || {}
                const present = st.present === true
                const absent = st.present === false
                return (
                  <tr key={m.id} className="border-t align-top">
                    {showTeamColumnInWrite && <td className="p-2">{teamNameMap.get(m.team_id) || '—'}</td>}
                    <td className="p-2">{m.full_name}</td>
                    <td className="p-2 text-center">
                      <input type="radio" name={`att-${m.id}`} checked={present} onChange={()=>setPresent(m.id, true)} />
                    </td>
                    <td className="p-2 text-center">
                      <input type="radio" name={`att-${m.id}`} checked={absent} onChange={()=>setPresent(m.id, false)} />
                    </td>
                    <td className="p-2 text-center">
                      <input type="checkbox" disabled={!absent} checked={!!st.is_excused} onChange={e=>setExcused(m.id, e.target.checked)} />
                    </td>
                    <td className="p-2">
                      <input
                        className="border rounded-xl p-2 w-full"
                        placeholder="سبب الغياب (اختياري)"
                        value={st.excuse_note || ''}
                        onChange={e=>setNote(m.id, e.target.value)}
                        disabled={!absent}
                      />
                    </td>
                  </tr>
                )
              })}
              {chefs.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={showTeamColumnInWrite ? 6 : 5}>لا يوجد Chef de legion مطابق</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
