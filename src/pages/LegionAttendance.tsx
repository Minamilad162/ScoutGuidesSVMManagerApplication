import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'
import { LoadingButton } from '../components/ui/LoadingButton'

type Term = { id: string; name: string; year: number; start_date: string | null; end_date: string | null }
type Member = { id: string; full_name: string; is_equipier: boolean; rank?: { rank_label: string | null } }

type AttRow = {
  member_id: string
  is_present: boolean
  is_excused: boolean | null
  excuse_note: string | null
  meetings: { meeting_date: string; mtype: 'preparation' | 'meeting'; team_id: string }
}

type Scope = 'term' | 'overall'
type KindFilter = 'all' | 'chefs' | 'equipiers'

type DayStatus = {
  present?: boolean
  is_excused?: boolean
  excuse_note?: string
}

type StatsSort = 'name' | 'most' | 'least' // ⬅️ جديد: ترتيب الإحصائيات

export default function LegionAttendance() {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // فلتر القراءة
  const [terms, setTerms] = useState<Term[]>([])
  const [termId, setTermId] = useState<string>('')
  const [scope, setScope] = useState<Scope>('overall')
  const [kind, setKind] = useState<KindFilter>('equipiers')

  // فريق القائد
  const [teamId, setTeamId] = useState<string>('')

  // بيانات
  const [members, setMembers] = useState<Member[]>([])
  const [rows, setRows] = useState<AttRow[]>([])

  // نموذج التسجيل
  const [dayDate, setDayDate] = useState<string>('')
  const [dayType, setDayType] = useState<'meeting' | 'preparation'>('meeting')
  const [dayStatus, setDayStatus] = useState<Record<string, DayStatus>>({})

  // ⬅️ جديد: ترتيب الإحصائيات
  const [statsSort, setStatsSort] = useState<StatsSort>('name')

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const { data: me, error: meErr } = await supabase.from('v_me').select('team_id').maybeSingle()
      if (meErr) throw meErr
      if (!me?.team_id) throw new Error('لا يوجد فريق مرتبط بحسابك')
      setTeamId(me.team_id)

      const { data: ts, error: te } = await supabase
        .from('terms').select('id,name,year,start_date,end_date')
        .order('year', { ascending: false }).order('name', { ascending: true })
      if (te) throw te
      setTerms((ts as any) ?? [])
      if (ts && ts.length) setTermId(ts[0].id)

      const { data: ms, error: me2 } = await supabase
        .from('members')
        .select('id, full_name, is_equipier, rank:ranks(rank_label)')
        .eq('team_id', me.team_id)
        .order('full_name', { ascending: true })
      if (me2) throw me2
      setMembers((ms as any) ?? [])

      const now = new Date()
      const pad = (n:number)=>String(n).padStart(2,'0')
      const d = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
      setDayDate(d)
      setDayType('meeting')
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (teamId) refreshRead() }, [teamId, scope, termId, terms])
  async function refreshRead() {
    setLoading(true)
    try {
      let q = supabase.from('attendance')
        .select('member_id,is_present,is_excused,excuse_note,meetings!inner(meeting_date,mtype,team_id)')
        .eq('meetings.team_id', teamId) as any

      if (scope === 'term') {
        const t = terms.find(x => x.id === termId)
        if (t?.start_date) q = q.gte('meetings.meeting_date', t.start_date)
        if (t?.end_date)   q = q.lte('meetings.meeting_date', t.end_date)
      }

      q = q.order('meeting_date', { foreignTable: 'meetings', ascending: false }).range(0, 9999)

      const { data, error } = await q
      if (error) throw error
      setRows((data as any) ?? [])
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل سجلات الحضور')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (teamId && dayDate && dayType) refreshDay() }, [teamId, dayDate, dayType, kind])
  async function refreshDay() {
    try {
      if (kind === 'equipiers' && dayType !== 'meeting') setDayType('meeting')

      const { data, error } = await supabase
        .from('attendance')
        .select('member_id, is_present, is_excused, excuse_note, meetings!inner(id, team_id, meeting_date, mtype)')
        .eq('meetings.team_id', teamId)
        .eq('meetings.meeting_date', dayDate)
        .eq('meetings.mtype', kind === 'equipiers' ? 'meeting' : dayType)
      if (error) throw error

      const map: Record<string, DayStatus> = {}
      for (const r of (data as any[] ?? [])) {
        map[r.member_id] = {
          present: !!r.is_present,
          is_excused: !!r.is_excused,
          excuse_note: r.excuse_note || ''
        }
      }
      setDayStatus(map)
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل حالة اليوم')
    }
  }

  const filteredMembers = useMemo(() => {
    switch (kind) {
      case 'chefs': return members.filter(m => !m.is_equipier)
      case 'equipiers': return members.filter(m => m.is_equipier)
      default: return members
    }
  }, [members, kind])

  const stats = useMemo(() => {
    const map: Record<string, {
      present: number, total: number,
      excused: number, unexcused: number
    }> = {}

    rows.forEach(r => {
      const mid = r.member_id
      if (!map[mid]) map[mid] = { present: 0, total: 0, excused: 0, unexcused: 0 }
      map[mid].total += 1
      if (r.is_present) map[mid].present += 1
      else (r.is_excused ? map[mid].excused++ : map[mid].unexcused++)
    })

    const arr = filteredMembers.map(m => {
      const s = map[m.id] || { present: 0, total: 0, excused: 0, unexcused: 0 }
      const pct = s.total > 0 ? Math.round((s.present / s.total) * 100) : 0
      return {
        member_id: m.id,
        name: m.full_name,
        rank: m.rank?.rank_label || (m.is_equipier ? 'Equipier' : '—'),
        present: s.present,
        excused: s.excused,
        unexcused: s.unexcused,
        total: s.total,
        pct,
      }
    })

    // ⬅️ ترتيب الإحصائيات
    if (statsSort === 'most') {
      arr.sort((a,b)=> (b.pct - a.pct) || (b.present - a.present) || a.name.localeCompare(b.name, 'ar'))
    } else if (statsSort === 'least') {
      arr.sort((a,b)=> (a.pct - b.pct) || (a.present - b.present) || a.name.localeCompare(b.name, 'ar'))
    } else {
      arr.sort((a,b)=> a.name.localeCompare(b.name, 'ar'))
    }

    return arr
  }, [rows, filteredMembers, statsSort])

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

  async function saveDay() {
    if (!teamId) return toast.error('لا يوجد فريق')
    if (!dayDate) return toast.error('اختر التاريخ')
    if (!dayType) return toast.error('اختر نوع اليوم')

    const effectiveType = kind === 'equipiers' ? 'meeting' : dayType

    setSaving(true)
    try {
      const { data: mrow, error: me } = await supabase
        .from('meetings')
        .upsert({ team_id: teamId, meeting_date: dayDate, mtype: effectiveType }, { onConflict: 'team_id,meeting_date,mtype' })
        .select('id').maybeSingle()
      if (me) throw me
      const meeting_id = mrow?.id
      if (!meeting_id) throw new Error('تعذر الحصول على اجتماع اليوم')

      const payload: any[] = []
      for (const m of filteredMembers) {
        const st = dayStatus[m.id]
        if (st && typeof st.present === 'boolean') {
          payload.push({
            meeting_id,
            member_id: m.id,
            is_present: st.present,
            is_excused: st.present ? false : !!st.is_excused,
            excuse_note: st.present ? null : (st.excuse_note || null)
          })
        }
      }
      if (payload.length === 0) {
        toast.error('لم يتم تحديد أي حضور/غياب')
        setSaving(false)
        return
      }

      const { error: aerr } = await supabase
        .from('attendance')
        .upsert(payload, { onConflict: 'meeting_id,member_id' })
      if (aerr) throw aerr

      toast.success('تم حفظ الحضور/الغياب')
      await Promise.all([refreshDay(), refreshRead()])
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحفظ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">غياب/حضور فريقي — (قائد الفرقة)</h1>

      {/* فلاتر القراءة */}
      <div className="grid md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="text-sm">نطاق الحساب</label>
          <select
            className="border rounded-xl p-2 w-full cursor-pointer"
            value={scope}
            onChange={e => setScope(e.target.value as Scope)}
          >
            <option value="overall">إجمالي (كل الفترة)</option>
            <option value="term">حسب الترم</option>
          </select>
        </div>

        <div className={`${scope === 'term' ? '' : 'opacity-60 pointer-events-none'}`}>
          <label className="text-sm">الترم</label>
          <select
            className="border rounded-xl p-2 w-full cursor-pointer"
            value={termId}
            onChange={e => setTermId(e.target.value)}
          >
            {terms.map(t => (
              <option key={t.id} value={t.id}>{t.year} — {t.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm">نوع العضو</label>
          <select
            className="border rounded-xl p-2 w-full cursor-pointer"
            value={kind}
            onChange={e => setKind(e.target.value as KindFilter)}
          >
            <option value="all">الكل</option>
            <option value="chefs">القادة فقط</option>
            <option value="equipiers">Equipier فقط</option>
          </select>
          {kind === 'equipiers' && (
            <div className="text-[11px] text-gray-500 mt-1">Equipier يُسجَّل لهم اجتماعات فقط.</div>
          )}
        </div>

        <div className="md:text-end">
          <button className="btn border w-full md:w-auto" onClick={refreshRead}>تحديث</button>
        </div>
      </div>

      {/* تسجيل اليوم */}
      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">تسجيل حضور/غياب — اليوم</h2>

        <div className="grid md:grid-cols-5 gap-2 items-end">
          <div>
            <label className="text-sm">التاريخ</label>
            <input type="date" className="border rounded-xl p-2 w-full" value={dayDate} onChange={e=>setDayDate(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">نوع اليوم</label>
            <select
              className="border rounded-xl p-2 w-full cursor-pointer"
              value={kind==='equipiers' ? 'meeting' : dayType}
              onChange={e=>setDayType(e.target.value as any)}
              disabled={kind==='equipiers'}
            >
              <option value="meeting">اجتماع</option>
              <option value="preparation">تحضير</option>
            </select>
          </div>
          <div className="md:col-span-3 md:text-end">
            <LoadingButton loading={saving} onClick={saveDay}>
              <span className="w-full md:w-auto inline-block">حفظ اليوم</span>
            </LoadingButton>
          </div>
        </div>

        {/* جدول اليوم */}
        <div className="rounded-2xl border">
          <div className="block overflow-x-auto" dir="ltr" style={{ WebkitOverflowScrolling: 'touch' as any }}>
            <table className="table-auto w-full min-w-[900px] text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-start">الاسم</th>
                  <th className="p-2 text-start">الرتبة</th>
                  <th className="p-2 text-center">حاضر</th>
                  <th className="p-2 text-center">غائب</th>
                  <th className="p-2 text-center">بعذر؟</th>
                  <th className="p-2 text-start">العذر</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map(m => {
                  const st = dayStatus[m.id] || {}
                  const present = st.present === true
                  const absent = st.present === false
                  return (
                    <tr key={m.id} className="border-t align-top">
                      <td className="p-2">{m.full_name}</td>
                      <td className="p-2">{m.rank?.rank_label || (m.is_equipier ? 'Equipier' : '—')}</td>
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
                {filteredMembers.length === 0 && (
                  <tr><td className="p-3 text-center text-gray-500" colSpan={6}>لا يوجد أعضاء في هذا التصنيف</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* الإحصائيات */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">الإحصائيات</h2>

        {/* ⬅️ جديد: أدوات ترتيب الإحصائيات */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm text-gray-600">رتّب النتائج</div>
          <div>
            <select
              className="border rounded-xl p-2 w-full md:w-[240px] cursor-pointer"
              value={statsSort}
              onChange={e=>setStatsSort(e.target.value as StatsSort)}
            >
              <option value="name">أبجديًا (أ–ي)</option>
              <option value="most">الأكثر حضورًا</option>
              <option value="least">الأقل حضورًا</option>
            </select>
          </div>
        </div>

        {/* جدول الإحصائيات */}
        <div className="rounded-2xl border">
          <div className="block overflow-x-auto" dir="ltr" style={{ WebkitOverflowScrolling: 'touch' as any }}>
            <table className="table-auto w-full min-w-[880px] text-sm">
              <thead className="bg-gray-100">
                <tr>
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
                {stats.map(r => (
                  <tr key={r.member_id} className="border-t">
                    <td className="p-2">{r.name}</td>
                    <td className="p-2">{r.rank}</td>
                    <td className="p-2 text-center">{r.present}</td>
                    <td className="p-2 text-center">{r.excused}</td>
                    <td className="p-2 text-center">{r.unexcused}</td>
                    <td className="p-2 text-center">{r.total}</td>
                    <td className="p-2 text-center">
                      <span className={`inline-flex items-center justify-center min-w-[56px] px-2 py-1 rounded-full text-xs ${r.pct>=80?'bg-emerald-50 border border-emerald-300 text-emerald-700': r.pct>=60?'bg-amber-50 border border-amber-300 text-amber-700':'bg-rose-50 border border-rose-300 text-rose-700'}`}>
                        {r.total > 0 ? `${r.pct}%` : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
                {stats.length === 0 && (
                  <tr><td className="p-3 text-center text-gray-500" colSpan={7}>لا توجد بيانات لعرضها</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
