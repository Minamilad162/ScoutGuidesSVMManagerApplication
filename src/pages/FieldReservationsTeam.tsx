import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ui/Toaster'
import { PageLoader } from '../components/ui/PageLoader'
import { LoadingButton } from '../components/ui/LoadingButton'
import { useRoleGate } from '../hooks/useRoleGate'
import { useAuth } from '../components/AuthProvider'
import FieldMaps from '../components/FieldMaps'

// ===== Types =====
type Team = { id: string; name: string }
type Zone = { id: string; name: string }
type Term = { id: string; name: string; year: number; start_date: string | null; end_date: string | null }
type TermDateRow = { id: string; meeting_date: string } // YYYY-MM-DD

// حجوزات اليوم المختار (لكل الفرق)
type DayRow = {
  id: string
  starts_at: string
  ends_at: string
  field_zones: { name: string | null } | null
  teams: { name: string | null } | null
}

// حجوزات الفريق في اليوم المختار فقط
type TeamRow = {
  id: string
  starts_at: string
  ends_at: string
  field_zones: { name: string | null } | null
}

// ===== Helpers =====
function pad2(n: number) { return String(n).padStart(2, '0') }
function todayYMD() {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}
function ymdToDateParts(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number)
  return { y, m: m - 1, d }
}
// كوّن ISO من تاريخ (Y-M-D) + وقت (HH:MM) محلي → ISO (UTC) للتخزين الآمن
function localYMDhmToISO(ymd: string, hm: string): string {
  const { y, m, d } = ymdToDateParts(ymd)
  const [hh, mm] = hm.split(':').map(Number)
  const local = new Date(y, m, d, hh, mm, 0, 0)
  return local.toISOString()
}
// تحقّق أن تاريخ داخل نطاق
function withinRange(d: string, start?: string | null, end?: string | null) {
  if (!d) return false
  if (!start || !end) return true
  return d >= start && d <= end
}
// حدود اليوم المختار (محلي → ISO)
function getDayBoundsISO(ymd: string) {
  const start = new Date(ymd + 'T00:00:00')
  const end   = new Date(ymd + 'T23:59:59')
  return { startISO: start.toISOString(), endISO: end.toISOString() }
}

export default function FieldReservationsTeam() {
  const toast = useToast()
  const gate = useRoleGate()
  const { roles } = useAuth()
  const isAdmin = roles.some(r => r.role_slug === 'admin')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [canceling, setCanceling] = useState<string | null>(null)

  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState<string>('')
  const [teamName, setTeamName] = useState<string>('')

  const [zones, setZones] = useState<Zone[]>([])

  // Terms + Dates
  const [terms, setTerms] = useState<Term[]>([])
  const [selTerm, setSelTerm] = useState<string>('')          // المختار في UI
  const [termDates, setTermDates] = useState<TermDateRow[]>([])

  // Meeting inputs
  const [mtype, setMtype] = useState<'preparation' | 'meeting'>('meeting')
  const [meetingDate, setMeetingDate] = useState<string>('')  // YYYY-MM-DD
  const [startTime, setStartTime] = useState<string>('16:00') // HH:MM
  const [endTime, setEndTime] = useState<string>('18:00')     // HH:MM
  const [zoneId, setZoneId] = useState<string>('')

  // حجوزات الفريق (لليوم المختار فقط)
  const [rows, setRows] = useState<TeamRow[]>([])

  // ==== حجوزات كل الفرق في التاريخ المختار ====
  const [dayRows, setDayRows] = useState<DayRow[]>([])
  const [dayLoading, setDayLoading] = useState(false)

  // ==== حجوزات الفريق في التاريخ المختار ====
  const [teamDayLoading, setTeamDayLoading] = useState(false)

  // ===== Init =====
  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      // Zones
      const { data: z, error: ze } = await supabase
        .from('field_zones')
        .select('id,name')
        .eq('active', true)
        .order('name')
      if (ze) throw ze
      setZones((z as any) ?? [])
      if (z && z.length) setZoneId(z[0].id)

      // Teams (حسب الصلاحية)
      if (isAdmin) {
        const { data: ts, error: te } = await supabase
          .from('teams')
          .select('id,name')
          .order('name')
        if (te) throw te
        setTeams((ts as any) ?? [])
        if (ts && ts.length) {
          setTeamId(ts[0].id)
          setTeamName(ts[0].name)
        }
      } else {
        const { data: me, error: meErr } = await supabase
          .from('v_me')
          .select('team_id')
          .maybeSingle()
        if (meErr) throw meErr
        if (!me?.team_id) throw new Error('لا يوجد فريق مرتبط بحسابك')
        setTeamId(me.team_id)
        const { data: t, error: te2 } = await supabase
          .from('teams')
          .select('name')
          .eq('id', me.team_id)
          .maybeSingle()
        if (te2) throw te2
        setTeamName(t?.name || '—')
      }

      // Terms (نجيب ونحدد الافتراضي النشط)
      const { data: tm, error: tmErr } = await supabase
        .from('terms')
        .select('id,name,year,start_date,end_date')
        .order('year', { ascending: false })
        .order('name', { ascending: true })
      if (tmErr) throw tmErr
      setTerms(tm ?? [])

      // حدد الترم النشط بناء على اليوم
      const today = todayYMD()
      let activeTermId = tm?.find(t => t.start_date && t.end_date && withinRange(today, t.start_date, t.end_date))?.id
      if (!activeTermId && tm && tm.length) activeTermId = tm[0].id
      if (activeTermId) setSelTerm(activeTermId)

      // تاريخ افتراضي
      setMeetingDate(today) // هيتعدل تلقائيًا لو mtype=meeting بعد تحميل termDates
    } catch (e: any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally {
      setLoading(false)
    }
  }

  // تحميل تواريخ الترم المختار
  useEffect(() => { if (selTerm) loadTermDates(selTerm) }, [selTerm])
  async function loadTermDates(termId: string) {
    try {
      const { data, error } = await supabase
        .from('term_meeting_dates')
        .select('id, meeting_date')
        .eq('term_id', termId)
        .order('meeting_date', { ascending: true })
      if (error) throw error
      const list = (data as any as TermDateRow[]) ?? []
      setTermDates(list)

      // لو النوع Meeting اختار أول تاريخ متاح تلقائيًا
      if (mtype === 'meeting') {
        if (list.length) setMeetingDate(list[0].meeting_date)
        else setMeetingDate('') // مفيش تواريخ مضافة
      }
    } catch (e: any) {
      toast.error(e.message || 'تعذر تحميل تواريخ الترم')
    }
  }

  // تغيير نوع اليوم: Meeting => استخدم قائمة التواريخ؛ Preparation => تاريخ حر (اليوم افتراضيًا)
  useEffect(() => {
    if (mtype === 'meeting') {
      if (termDates.length) setMeetingDate(termDates[0].meeting_date)
      else setMeetingDate('')
    } else {
      if (!meetingDate) setMeetingDate(todayYMD())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mtype, termDates])

  // ===== حجوزات كل الفرق في التاريخ المختار =====
  useEffect(() => { if (meetingDate) refreshDayReservations() }, [meetingDate])

  async function refreshDayReservations() {
    if (!meetingDate) { setDayRows([]); return }
    setDayLoading(true)
    try {
      const { startISO, endISO } = getDayBoundsISO(meetingDate)
      const { data, error } = await supabase
        .from('field_reservations')
        .select('id, starts_at, ends_at, field_zones:field_zone_id(name), teams:team_id(name)')
        .is('soft_deleted_at', null)
        .lt('starts_at', endISO)
        .gt('ends_at', startISO)
        .order('starts_at', { ascending: true })
      if (error) throw error
      setDayRows((data as any as DayRow[]) ?? [])
    } catch (e: any) {
      toast.error(e.message || 'تعذر تحميل حجوزات هذا التاريخ')
    } finally {
      setDayLoading(false)
    }
  }

  // ==== حجوزات الفريق لليوم المختار (تصفية بالتاريخ) ====
  useEffect(() => { if (teamId && meetingDate) refreshTeamDayReservations() }, [teamId, meetingDate])

  async function refreshTeamDayReservations() {
    if (!teamId || !meetingDate) { setRows([]); return }
    setTeamDayLoading(true)
    try {
      const { startISO, endISO } = getDayBoundsISO(meetingDate)
      const { data, error } = await supabase
        .from('field_reservations')
        .select('id, starts_at, ends_at, field_zones:field_zone_id(name)')
        .eq('team_id', teamId)
        .is('soft_deleted_at', null)
        .lt('starts_at', endISO)   // يبدأ قبل نهاية اليوم
        .gt('ends_at', startISO)   // وينتهي بعد بداية اليوم → overlap
        .order('starts_at', { ascending: true })
      if (error) throw error
      setRows((data as any as TeamRow[]) ?? [])
    } catch (e: any) {
      toast.error(e.message || 'تعذر تحميل حجوزات الفريق لهذا التاريخ')
    } finally {
      setTeamDayLoading(false)
    }
  }

  // ===== Actions =====
  async function save() {
    // فالفيديشن أساسي
    if (!teamId) return toast.error('اختر الفريق')
    if (!zoneId) return toast.error('اختر القطاع')

    if (mtype === 'meeting') {
      if (!selTerm) return toast.error('اختر الترم')
      if (!meetingDate) return toast.error('اختر تاريخ الاجتماع من قائمة التواريخ')
      // تأكد التاريخ من ضمن القائمة
      if (!termDates.some(d => d.meeting_date === meetingDate)) {
        return toast.error('التاريخ المختار غير موجود ضمن تواريخ الترم')
      }
      // (اختياري) تحقّق داخل نطاق الترم المختار
      const t = terms.find(t => t.id === selTerm)
      if (t && !withinRange(meetingDate, t.start_date, t.end_date)) {
        return toast.error('التاريخ خارج حدود الترم')
      }
    } else {
      if (!meetingDate) return toast.error('اختر تاريخ الاجتماع')
      // (اختياري) لو فيه ترم نشط حاليًا، تقدر تمنع تاريخ خارج النطاق
      const t = terms.find(t => t.id === selTerm)
      if (t?.start_date && t?.end_date && !withinRange(meetingDate, t.start_date, t.end_date)) {
        return toast.error('التاريخ خارج حدود الترم')
      }
    }

    if (!startTime || !endTime) return toast.error('أدخل وقتي البداية والنهاية')

    // كوّن Date محلي من (meetingDate + HH:MM)
    const startISO = localYMDhmToISO(meetingDate, startTime)
    const endISO   = localYMDhmToISO(meetingDate, endTime)

    // تأكد إن البداية قبل النهاية
    if (new Date(startISO) >= new Date(endISO)) {
      return toast.error('وقت البداية يجب أن يسبق وقت النهاية')
    }

    setSaving(true)
    try {
      // لو عندك جدول meetings وعايز تربط: (زي كودك القديم)
      const { data: mrow, error: me } = await supabase
        .from('meetings')
        .upsert({ team_id: teamId, meeting_date: meetingDate, mtype }, { onConflict: 'team_id,meeting_date,mtype' })
        .select('id').maybeSingle()
      if (me) throw me

      const { error: ie } = await supabase.from('field_reservations').insert({
        team_id: teamId,
        field_zone_id: zoneId,
        starts_at: startISO,
        ends_at: endISO,
        meeting_id: mrow?.id || null
      })
      if (ie) {
        const msg = String(ie.message || '')
        if (msg.includes('field_reservations_no_overlap') || msg.includes('overlap'))
          throw new Error('تعذر الحجز: هناك تعارض مع فريق آخر في نفس الوقت لهذا القطاع')
        throw ie
      }
      toast.success('تم الحجز')
      await refreshTeamDayReservations()
      await refreshDayReservations() // ← تحدّث جدول “حجوزات هذا التاريخ”
    } catch (e: any) {
      toast.error(e.message || 'تعذر الحجز')
    } finally {
      setSaving(false)
    }
  }

  async function cancel(id: string) {
    setCanceling(id)
    try {
      const { error } = await supabase
        .from('field_reservations')
        .update({ soft_deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      toast.success('تم إلغاء الحجز')
      await refreshTeamDayReservations()
      await refreshDayReservations() // ← تحدّث جدول “حجوزات هذا التاريخ”
    } catch (e: any) {
      toast.error(e.message || 'تعذر الإلغاء')
    } finally { setCanceling(null) }
  }

  // ===== UI =====
  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">حجوزات قطاعات الأرض — (مسؤول الأدوات / قائد الفرقة)</h1>

      {/* الخرائط دائمًا */}
      <FieldMaps className="mb-4" sticky height="h-72 md:h-[28rem]" />

      {/* اختيار الفريق */}
      {!isAdmin ? (
        <div className="mb-3 text-sm">
          <span className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border">
            تحجز الآن لفريق: <b>{teamName}</b>
          </span>
        </div>
      ) : (
        <div className="mb-3">
          <label className="text-sm">الفريق</label>
          <select
            className="border rounded-xl p-2 w-full cursor-pointer"
            value={teamId}
            onChange={e => {
              const id = e.target.value
              setTeamId(id)
              const t = teams.find(x => x.id === id)
              setTeamName(t?.name || '')
            }}>
            {teams.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}

      <div className={`${(!isAdmin && !gate.canBookReservations(teamId)) ? 'opacity-60 pointer-events-none' : ''}`}>
        <div className="grid md:grid-cols-6 gap-2 items-end">
          {/* اختيار نوع اليوم */}
          <div className="md:col-span-2">
            <label className="text-sm">نوع اليوم</label>
            <select className="border rounded-xl p-2 w-full cursor-pointer" value={mtype} onChange={e=>setMtype(e.target.value as any)}>
              {/* <option value="preparation">تحضير (تاريخ حر)</option> */}
              <option value="meeting">اجتماع (من تواريخ الترم)</option>
            </select>
          </div>

          {/* اختيار الترم */}
          <div className="md:col-span-2">
            <label className="text-sm">الترم</label>
            <select className="border rounded-xl p-2 w-full cursor-pointer" value={selTerm} onChange={e=>setSelTerm(e.target.value)}>
              {terms.map(t => (
                <option key={t.id} value={t.id}>
                  {t.year} — {t.name}{t.start_date && t.end_date ? ` (${t.start_date} → ${t.end_date})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* تاريخ الاجتماع */}
          <div className="md:col-span-2">
            <label className="text-sm">تاريخ الاجتماع</label>
            {mtype === 'meeting' ? (
              <select
                className="border rounded-xl p-2 w-full cursor-pointer"
                value={meetingDate}
                onChange={e=>setMeetingDate(e.target.value)}
              >
                {termDates.length === 0 && <option value="">— لا توجد تواريخ —</option>}
                {termDates.map(d => <option key={d.id} value={d.meeting_date}>{d.meeting_date}</option>)}
              </select>
            ) : (
              <input
                type="date"
                className="border rounded-xl p-2 w-full"
                value={meetingDate}
                onChange={e=>setMeetingDate(e.target.value)}
                min={terms.find(t=>t.id===selTerm)?.start_date ?? undefined}
                max={terms.find(t=>t.id===selTerm)?.end_date ?? undefined}
              />
            )}
          </div>

          {/* القطاع */}
          <div className="md:col-span-2">
            <label className="text-sm">القطاع</label>
            <select className="border rounded-xl p-2 w-full cursor-pointer" value={zoneId} onChange={e=>setZoneId(e.target.value)}>
              {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </div>

          {/* الأوقات */}
          <div className="md:col-span-1">
            <label className="text-sm">من (الساعة)</label>
            <input
              type="time"
              className="border rounded-xl p-2 w-full"
              value={startTime}
              onChange={e=>setStartTime(e.target.value)}
            />
          </div>
          <div className="md:col-span-1">
            <label className="text-sm">إلى (الساعة)</label>
            <input
              type="time"
              className="border rounded-xl p-2 w-full"
              value={endTime}
              onChange={e=>setEndTime(e.target.value)}
            />
          </div>

          <div className="md:col-span-6 text-end">
            <LoadingButton loading={saving} onClick={save}>حجز القطاع</LoadingButton>
          </div>
        </div>
      </div>

      {/* حجوزات الفريق (مصفاة على التاريخ المختار) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">حجوزات الفريق — تاريخ: {meetingDate || '—'}</h2>
          {teamDayLoading && <span className="text-sm text-gray-500">جاري التحميل…</span>}
        </div>
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
                  {/* Postgres بيخزن UTC (timestamptz) — هنا بنعرض محلي */}
                  <td className="p-2">{new Date(r.starts_at).toLocaleString()}</td>
                  <td className="p-2">{new Date(r.ends_at).toLocaleString()}</td>
                  <td className="p-2 text-center">
                    <button className="btn border" onClick={()=>cancel(r.id)} disabled={canceling===r.id}>{canceling===r.id ? '...' : 'إلغاء'}</button>
                  </td>
                </tr>
              ))}
              {(!teamDayLoading && rows.length === 0) && (
                <tr><td className="p-3 text-center text-gray-500" colSpan={4}>لا توجد حجوزات لهذا التاريخ</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== الحجوزات في التاريخ المختار (لكل الفرق) ===== */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">حجوزات كل الفرق — تاريخ: {meetingDate || '—'}</h2>
          {dayLoading && <span className="text-sm text-gray-500">جاري التحميل…</span>}
        </div>
        <div className="border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">القطاع</th>
                <th className="p-2 text-start">من</th>
                <th className="p-2 text-start">إلى</th>
                <th className="p-2 text-start">الفريق</th>
              </tr>
            </thead>
            <tbody>
              {dayRows.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{r.field_zones?.name || '—'}</td>
                  <td className="p-2">{new Date(r.starts_at).toLocaleString()}</td>
                  <td className="p-2">{new Date(r.ends_at).toLocaleString()}</td>
                  <td className="p-2">{r.teams?.name || '—'}</td>
                </tr>
              ))}
              {(!dayLoading && dayRows.length === 0) && (
                <tr><td className="p-3 text-center text-gray-500" colSpan={4}>لا توجد حجوزات في هذا التاريخ</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
