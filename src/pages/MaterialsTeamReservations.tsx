import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { LoadingButton } from '../components/ui/LoadingButton'
import { useToast } from '../components/ui/Toaster'
import { useRoleGate } from '../hooks/useRoleGate'
import { useAuth } from '../components/AuthProvider'

// ===== Types =====
type Team = { id: string; name: string }
type Material = { id: string; name: string; total_qty: number }
type Resv = { id: string; material_id: string; team_id: string; qty: number; starts_at: string; ends_at: string }

type DayRow = {
  id: string
  qty: number
  starts_at: string
  ends_at: string
  teams: { name: string | null } | null
  materials: { name: string | null } | null
}

type Term = { id: string; name: string; year: number; start_date: string | null; end_date: string | null }
type TermDateRow = { id: string; meeting_date: string }

// ===== Helpers =====
function localDateTimeToISOString(dtLocal: string): string {
  if (!dtLocal || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dtLocal)) {
    const d = new Date(dtLocal)
    return isNaN(+d) ? new Date().toISOString() : d.toISOString()
  }
  const [datePart, timePart] = dtLocal.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString()
}

function toLocalInput(d: Date) {
  const pad = (n:number)=> String(n).padStart(2,'0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function combineDateTime(day: string, timeHHmm: string) { return `${day}T${timeHHmm}` }

function fmt12(iso: string) {
  const d = new Date(iso)
  if (isNaN(+d)) return '—'
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2,'0')
  const am = h < 12
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${m} ${am ? 'ص' : 'م'}`
}

function overlapsDay(isoStart: string, isoEnd: string, dayYYYYMMDD: string) {
  const [y, m, d] = dayYYYYMMDD.split('-').map(Number)
  const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0)
  const dayEnd   = new Date(y, m - 1, d, 23, 59, 59, 999)
  const s = new Date(isoStart)
  const e = new Date(isoEnd)
  return e >= dayStart && s <= dayEnd
}

function getDayBoundsISO(ymd: string) {
  const start = new Date(ymd + 'T00:00:00')
  const end   = new Date(ymd + 'T23:59:59')
  return { startISO: start.toISOString(), endISO: end.toISOString() }
}

export default function MaterialsTeamReservations() {
  const { roles } = useAuth()
  const gate = useRoleGate()
  const toast = useToast()

  const [loading, setLoading] = useState(true)

  const [teams, setTeams] = useState<Team[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [teamId, setTeamId] = useState<string>('')
  const [matId, setMatId] = useState<string>('')
  const [qty, setQty] = useState<number | ''>('')

  const [startAt, setStartAt] = useState<string>('') // YYYY-MM-DDTHH:MM
  const [endAt, setEndAt] = useState<string>('')

  const [saving, setSaving] = useState(false)
  const [list, setList] = useState<Resv[]>([])
  const isAdmin = roles.some(r => r.role_slug === 'admin')

  const [terms, setTerms] = useState<Term[]>([])
  const [termId, setTermId] = useState<string>('')
  const [termDates, setTermDates] = useState<TermDateRow[]>([])
  const hasTermDates = termDates.length > 0

  const [useCustomDay, setUseCustomDay] = useState<boolean>(false)
  const [selectedDay, setSelectedDay] = useState<string>('') // YYYY-MM-DD
  const [startTime, setStartTime] = useState<string>('16:00')
  const [endTime, setEndTime] = useState<string>('18:00')

  const termMeta = useMemo(() => terms.find(t => t.id === termId) || null, [terms, termId])
  const termMinDT = termMeta?.start_date ? `${termMeta.start_date}T00:00` : undefined
  const termMaxDT = termMeta?.end_date   ? `${termMeta.end_date}T23:59` : undefined

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const [{ data: ts, error: te }, { data: ms, error: me }] = await Promise.all([
        supabase.from('teams').select('id,name').order('name'),
        supabase.from('materials').select('id,name,total_qty').eq('active', true).order('name')
      ])
      if (te) throw te
      if (me) throw me
      setTeams((ts as any) ?? [])
      setMaterials((ms as any) ?? [])
      if (ms && ms.length) setMatId(ms[0].id)

      const { data: tm, error: terr } = await supabase
        .from('terms').select('id,name,year,start_date,end_date')
        .order('year', { ascending: false })
        .order('name', { ascending: true })
      if (terr) throw terr
      setTerms((tm as any) ?? [])
      if (tm && tm.length) setTermId(tm[0].id)

      const isAdmin = roles.some(r => r.role_slug === 'admin')
      if (isAdmin) {
        if (ts && ts.length) setTeamId(ts[0].id)
      } else {
        const { data: meRow, error: meErr } = await supabase.from('v_me').select('team_id').maybeSingle()
        if (meErr) throw meErr
        if (!meRow?.team_id) throw new Error('لا يوجد فريق مرتبط بحسابك')
        setTeamId(meRow.team_id)
      }

      const now = new Date()
      const two = new Date(now.getTime() + 2*60*60*1000)
      setStartAt(toLocalInput(now))
      setEndAt(toLocalInput(two))
      setStartTime(toLocalInput(now).slice(11,16))
      setEndTime(toLocalInput(two).slice(11,16))
      setSelectedDay(toLocalInput(now).slice(0,10))
      setUseCustomDay(false)
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (termId) loadTermDates(termId) }, [termId])
  async function loadTermDates(tid: string) {
    try {
      const { data, error } = await supabase
        .from('term_meeting_dates')
        .select('id,meeting_date')
        .eq('term_id', tid)
        .order('meeting_date', { ascending: true })
      if (error) throw error
      const list = (data as any as TermDateRow[]) ?? []
      setTermDates(list)

      if (list.length > 0) {
        const d = list[0].meeting_date
        setSelectedDay(d)
        setUseCustomDay(false)
        setStartAt(combineDateTime(d, startTime))
        setEndAt(combineDateTime(d, endTime))
      } else {
        setUseCustomDay(true)
      }
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل تواريخ الترم')
    }
  }

  useEffect(() => { if (teamId) refreshList() }, [teamId])
  async function refreshList() {
    try {
      const { data, error } = await supabase
        .from('material_reservations')
        .select('id, material_id, team_id, qty, starts_at, ends_at')
        .eq('team_id', teamId)
        .is('soft_deleted_at', null)
        .order('starts_at', { ascending: false })
      if (error) throw error
      setList((data as any) ?? [])
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الحجوزات')
    }
  }

  const [available, setAvailable] = useState<number | null>(null)
  useEffect(() => { computeAvailability() }, [matId, startAt, endAt])
  async function computeAvailability() {
    setAvailable(null)
    if (!matId || !startAt || !endAt) return
    try {
      const { data, error } = await supabase.rpc('material_available_qty', {
        p_material_id: matId,
        p_starts: localDateTimeToISOString(startAt),
        p_ends: localDateTimeToISOString(endAt)
      })
      if (error) throw error
      setAvailable((data as any) ?? null)
    } catch {
      setAvailable(null)
    }
  }

  function onTermDayChange(v: string) {
    if (v === '__custom__') { setUseCustomDay(true); return }
    setUseCustomDay(false)
    setSelectedDay(v)
    setStartAt(combineDateTime(v, startTime))
    setEndAt(combineDateTime(v, endTime))
  }

  function onStartTimeChange(t: string) { setStartTime(t); setStartAt(combineDateTime(selectedDay, t)) }
  function onEndTimeChange(t: string)   { setEndTime(t);   setEndAt(combineDateTime(selectedDay, t)) }

  function validateRange(): string | null {
    const s = new Date(startAt)
    const e = new Date(endAt)
    if (isNaN(+s) || isNaN(+e)) return 'تنسيق التاريخ/الوقت غير صالح'
    if (s >= e) return 'وقت البداية يجب أن يسبق وقت النهاية'
    if (termMeta?.start_date) {
      const min = new Date(`${termMeta.start_date}T00:00`)
      if (s < min || e < min) return 'الوقت خارج نطاق بداية الترم'
    }
    if (termMeta?.end_date) {
      const max = new Date(`${termMeta.end_date}T23:59`)
      if (s > max || e > max) return 'الوقت خارج نطاق نهاية الترم'
    }
    return null
  }

  async function saveReservation() {
    if (!teamId) return toast.error('اختر الفريق')
    if (!matId) return toast.error('اختر الأداة')
    const q = Number(qty); if (!isFinite(q) || q <= 0) return toast.error('الكمية غير صالحة')
    if (!startAt || !endAt) return toast.error('حدد وقت البداية والنهاية')

    const err = validateRange(); if (err) return toast.error(err)

    setSaving(true)
    try {
      const { error } = await supabase.from('material_reservations').insert({
        team_id: teamId,
        material_id: matId,
        qty: q,
        starts_at: localDateTimeToISOString(startAt),
        ends_at:   localDateTimeToISOString(endAt)
      })
      if (error) throw error
      toast.success('تم الحجز')
      setQty('')
      await refreshList()
      await refreshDayReservations()
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحجز (قد تكون الكمية غير متاحة)')
    } finally {
      setSaving(false)
    }
  }

  async function cancelReservation(id: string) {
    try {
      const { error } = await supabase
        .from('material_reservations')
        .update({ soft_deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      toast.success('تم إلغاء الحجز')
      await refreshList()
      await refreshDayReservations()
    } catch (e:any) {
      toast.error(e.message || 'تعذر الإلغاء')
    }
  }

  const matMap = useMemo(() => new Map(materials.map(m => [m.id, m])), [materials])
  const canBook = useRoleGate().canBookReservations(teamId)

  const effectiveFilterDay = useMemo(() => {
    if (hasTermDates && !useCustomDay && selectedDay) return selectedDay
    if (startAt) return startAt.slice(0, 10)
    return ''
  }, [hasTermDates, useCustomDay, selectedDay, startAt])

  const listFiltered = useMemo(() => {
    if (!effectiveFilterDay) return list
    return list.filter(r => overlapsDay(r.starts_at, r.ends_at, effectiveFilterDay))
  }, [list, effectiveFilterDay])

  // ===== “كل الفرق في اليوم” =====
  const [dayRows, setDayRows] = useState<DayRow[]>([])
  const [dayLoading, setDayLoading] = useState(false)

  useEffect(() => { if (effectiveFilterDay) refreshDayReservations(); else setDayRows([]) }, [effectiveFilterDay])

  async function refreshDayReservations() {
    if (!effectiveFilterDay) { setDayRows([]); return }
    setDayLoading(true)
    try {
      // ✅ جرّب الـ RPC (يتخطى RLS بإذن محدود)
      const { data: rpc, error: rpcErr } = await supabase
        .rpc('material_reservations_by_day_all', { p_day: effectiveFilterDay })
      if (!rpcErr && rpc) {
        // Map لهيكل العرض المعتاد
        const mapped: DayRow[] = (rpc as any[]).map(r => ({
          id: r.id,
          qty: r.qty,
          starts_at: r.starts_at,
          ends_at: r.ends_at,
          teams: { name: r.team_name ?? null },
          materials: { name: r.material_name ?? null }
        }))
        setDayRows(mapped)
        setDayLoading(false)
        return
      }

      // 🔁 fallback (هيتقيّد بـ RLS لو مفيش RPC/صلاحيات)
      const { startISO, endISO } = getDayBoundsISO(effectiveFilterDay)
      const { data, error } = await supabase
        .from('material_reservations')
        .select('id, qty, starts_at, ends_at, teams:team_id(name), materials:material_id(name)')
        .is('soft_deleted_at', null)
        .lt('starts_at', endISO)
        .gt('ends_at', startISO)
        .order('starts_at', { ascending: true })
      if (error) throw error
      setDayRows((data as any) ?? [])
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل حجوزات هذا اليوم')
    } finally {
      setDayLoading(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">حجوزات الأدوات — مسؤول الفريق</h1>

      {/* فلاتر أساسية */}
      <div className="grid md:grid-cols-4 gap-3 items-end">
        <div className={`${isAdmin ? '' : 'opacity-60 pointer-events-none'}`}>
          <label className="text-sm">الفريق</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={teamId} onChange={e=>setTeamId(e.target.value)}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {!isAdmin && <div className="text-xs text-gray-500">لا يمكن تغيير الفريق إلا للأدمن</div>}
        </div>

        <div>
          <label className="text-sm">الأداة</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={matId} onChange={e=>setMatId(e.target.value)}>
            {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="text-sm">الترم (لاختيار تواريخ جاهزة)</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={termId} onChange={e=>setTermId(e.target.value)}>
            {terms.map(t => <option key={t.id} value={t.id}>{t.year} — {t.name}</option>)}
          </select>
          {termMeta?.start_date && termMeta?.end_date && (
            <div className="text-[11px] text-gray-500 mt-1">نطاق الترم: {termMeta.start_date} → {termMeta.end_date}</div>
          )}
        </div>
      </div>

      {/* نموذج الحجز */}
      <div className="grid md:grid-cols-6 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="text-sm">اليوم</label>
          {hasTermDates && !useCustomDay ? (
            <>
              <select
                className="border rounded-xl p-2 w-full cursor-pointer"
                value={selectedDay}
                onChange={e=>onTermDayChange(e.target.value)}
              >
                {termDates.map(d => (
                  <option key={d.id} value={d.meeting_date}>{d.meeting_date}</option>
                ))}
                <option value="__custom__">— تاريخ آخر —</option>
              </select>
              <div className="text-[11px] text-gray-500 mt-1">اختر من جدول الترم أو اختر “تاريخ آخر”.</div>
            </>
          ) : (
            <>
              <input
                type="datetime-local"
                className="border rounded-xl p-2 w-full"
                value={startAt}
                onChange={e=>{ setStartAt(e.target.value) }}
                min={termMinDT}
                max={termMaxDT}
              />
              <div className="text-[11px] text-gray-500 mt-1">اضبط وقت البداية (يمكن تعديل النهاية أدناه).</div>
              {hasTermDates && (
                <button
                  type="button"
                  className="text-[12px] underline mt-1"
                  onClick={()=>{
                    if (termDates.length) {
                      setUseCustomDay(false)
                      const d = termDates[0].meeting_date
                      setSelectedDay(d)
                      setStartAt(combineDateTime(d, startTime))
                      setEndAt(combineDateTime(d, endTime))
                    }
                  }}
                >
                  الرجوع لاختيار من جدول الترم
                </button>
              )}
            </>
          )}
        </div>

        {hasTermDates && !useCustomDay ? (
          <>
            <div>
              <label className="text-sm">من (الوقت)</label>
              <input type="time" className="border rounded-xl p-2 w-full" value={startTime} onChange={e=>onStartTimeChange(e.target.value)} />
            </div>
            <div>
              <label className="text-sm">إلى (الوقت)</label>
              <input type="time" className="border rounded-xl p-2 w-full" value={endTime} onChange={e=>onEndTimeChange(e.target.value)} />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="text-sm">إلى</label>
              <input
                type="datetime-local"
                className="border rounded-xl p-2 w-full"
                value={endAt}
                onChange={e=>setEndAt(e.target.value)}
                min={termMinDT}
                max={termMaxDT}
              />
            </div>
            <div></div>
          </>
        )}

        <div>
          <label className="text-sm">العدد</label>
          <input type="number" min={1} className="border rounded-xl p-2 w-full" value={qty} onChange={e=>setQty(e.target.value as any)} />
          {available !== null && <div className="text-xs mt-1">المتاح: <b>{available}</b></div>}
        </div>

        <div className="md:col-span-1 md:text-end">
          {canBook
            ? <LoadingButton loading={saving} onClick={saveReservation}><span className="w-full md:w-auto inline-block">حجز</span></LoadingButton>
            : <div className="text-xs text-amber-600">ليس لديك صلاحية للحجز</div>
          }
        </div>
      </div>

      {effectiveFilterDay && (
        <div className="text-xs text-gray-600">يتم عرض حجوزات يوم: <b>{effectiveFilterDay}</b></div>
      )}

      {/* جدول حجوزات الفريق (مصفى على اليوم المختار) */}
      <div className="rounded-2xl border">
        <div className="block overflow-x-auto" dir="ltr" style={{ WebkitOverflowScrolling: 'touch' as any }}>
          <table className="table-auto w-full min-w-[720px] text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2"></th>
                <th className="p-2 text-start">إلى</th>
                <th className="p-2 text-start">من</th>
                <th className="p-2 text-center">العدد</th>
                <th className="p-2 text-start">الأداة</th>
              </tr>
            </thead>
            <tbody>
              {listFiltered.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 text-end">
                    <button className="btn border text-xs w-full md:w-auto" onClick={()=>cancelReservation(r.id)}>إلغاء</button>
                  </td>
                  <td className="p-2">{fmt12(r.ends_at)}</td>
                  <td className="p-2">{fmt12(r.starts_at)}</td>
                  <td className="p-2 text-center">{r.qty}</td>
                  <td className="p-2">{matMap.get(r.material_id)?.name || '—'}</td>
                </tr>
              ))}
              {listFiltered.length === 0 && (
                <tr><td className="p-3 text-center text-gray-500" colSpan={5}>لا توجد حجوزات لهذا اليوم</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===== جدول “جميع الفرق” لليوم المختار ===== */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">حجوزات جميع الفرق — تاريخ: {effectiveFilterDay || '—'}</h2>
          {dayLoading && <span className="text-sm text-gray-500">جاري التحميل…</span>}
        </div>
        <div className="rounded-2xl border">
          <div className="block overflow-x-auto" dir="ltr" style={{ WebkitOverflowScrolling: 'touch' as any }}>
            <table className="table-auto w-full min-w-[800px] text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-start">الفريق</th>
                  <th className="p-2 text-start">الأداة</th>
                  <th className="p-2 text-center">العدد</th>
                  <th className="p-2 text-start whitespace-nowrap">من</th>
                  <th className="p-2 text-start whitespace-nowrap">إلى</th>
                </tr>
              </thead>
              <tbody>
                {dayRows.map(r => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2">{r.teams?.name || '—'}</td>
                    <td className="p-2">{r.materials?.name || '—'}</td>
                    <td className="p-2 text-center">{r.qty}</td>
                    <td className="p-2">{fmt12(r.starts_at)}</td>
                    <td className="p-2">{fmt12(r.ends_at)}</td>
                  </tr>
                ))}
                {(!dayLoading && dayRows.length === 0) && (
                  <tr><td className="p-3 text-center text-gray-500" colSpan={5}>لا توجد حجوزات في هذا التاريخ</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
