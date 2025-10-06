// src/pages/AdminFieldReservations.tsx
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

type QtyCol = 'quantity' | 'qty' | 'count' | null
type SoftDeleteCol = 'soft_deleted_at' | 'deleted_at' | 'is_deleted' | null

export default function AdminFieldReservations() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [teams, setTeams] = useState<Team[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [teamId, setTeamId] = useState<string>('all')

  // فلتر “يوم واحد”
  const [dayDate, setDayDate] = useState<string>('')

  // بيانات حجوزات الأرض
  const [rows, setRows] = useState<Row[]>([])

  // ملخص اليوم
  const [summaryRows, setSummaryRows] = useState<SummaryRow[]>([])
  const [summaryLoading, setSummaryLoading] = useState(false)

  // حجوزات الأدوات لليوم
  const [materialsLoading, setMaterialsLoading] = useState(false)
  const [materialsRows, setMaterialsRows] = useState<any[]>([])
  const [materialsSource, setMaterialsSource] = useState<string | null>(null)
  const [materialsDict, setMaterialsDict] = useState<Record<string, string>>({})

  // تحرير/إلغاء حجوزات الأدوات
  const [editingMatId, setEditingMatId] = useState<string | null>(null)
  const [editingMatDraft, setEditingMatDraft] = useState<{ quantity: number | string; starts_at: string; ends_at: string } | null>(null)
  const [editingQtyCol, setEditingQtyCol] = useState<QtyCol>(null)
  const [editingSoftCol, setEditingSoftCol] = useState<SoftDeleteCol>(null)
  const [savingMatId, setSavingMatId] = useState<string | null>(null)
  const [cancellingMatId, setCancellingMatId] = useState<string | null>(null)

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

      const today = new Date()
      const pad=(n:number)=>String(n).padStart(2,'0')
      setDayDate(`${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`)

      await loadMaterialNames()
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally { setLoading(false) }
  }

  async function loadMaterialNames() {
    const candidates = [
      { table: 'materials', id: 'id', name: 'name' },
      { table: 'material_items', id: 'id', name: 'name' },
      { table: 'tools', id: 'id', name: 'name' },
      { table: 'tools_items', id: 'id', name: 'name' },
    ]
    for (const c of candidates) {
      try {
        const { data, error } = await supabase.from(c.table).select(`${c.id}, ${c.name}`).limit(1000)
        if (!error && Array.isArray(data) && data.length) {
          const map: Record<string,string> = {}
          ;(data as any[]).forEach((r:any) => { map[r[c.id]] = r[c.name] ?? '' })
          setMaterialsDict(map)
          break
        }
      } catch { /* جرّب اللي بعده */ }
    }
  }

  useEffect(() => { if (dayDate) refreshAll() }, [dayDate, teamId])

  function getDayBounds(d: string) {
    const start = new Date(d + 'T00:00:00')
    const end   = new Date(d + 'T23:59:59')
    return { startISO: start.toISOString(), endISO: end.toISOString() }
  }

  async function refreshAll() {
    await Promise.all([refreshReservations(), refreshSummary(), refreshMaterialsForDay()])
  }

  // حجوزات الأرض
  async function refreshReservations() {
    if (!dayDate) return
    const { startISO, endISO } = getDayBounds(dayDate)
    setLoading(true)
    try {
      let q = supabase.from('v_field_reservations_detailed').select('*').is('soft_deleted_at', null) as any
      q = q.lt('starts_at', endISO).gt('ends_at', startISO)
      if (teamId !== 'all') q = q.eq('team_id', teamId)
      const { data, error } = await q.order('starts_at', { ascending: true })
      if (error) throw error
      setRows((data as any) ?? [])
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل حجوزات الأرض لليوم')
    } finally { setLoading(false) }
  }

  // ملخص اليوم
  async function refreshSummary() {
    if (!dayDate) return
    setSummaryLoading(true)
    try {
      const { startISO, endISO } = getDayBounds(dayDate)
      let q = supabase
        .from('field_reservations')
        .select('team_id, teams:team_id(name), field_zone_id, starts_at, ends_at')
        .is('soft_deleted_at', null)
        .lt('starts_at', endISO)
        .gt('ends_at', startISO) as any
      if (teamId !== 'all') q = q.eq('team_id', teamId)

      const { data, error } = await q
      if (error) throw error

      const map: Record<string, { name: string, reservations: number, zones: Set<string> }> = {}
      ;(data as any[] ?? []).forEach(r => {
        const tid = r.team_id as string
        const tname = r?.teams?.name || teams.find(t => t.id === tid)?.name || '—'
        if (!map[tid]) map[tid] = { name: tname, reservations: 0, zones: new Set<string>() }
        map[tid].reservations += 1
        if (r.field_zone_id) map[tid].zones.add(r.field_zone_id as string)
      })
      const rows: SummaryRow[] = Object.entries(map).map(([tid, v]) => ({
        team_id: tid, team_name: v.name, reservations: v.reservations, distinct_zones: v.zones.size
      })).sort((a,b) => a.team_name.localeCompare(b.team_name))
      setSummaryRows(rows)
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل ملخص اليوم')
    } finally { setSummaryLoading(false) }
  }

  // حجوزات الأدوات
  async function refreshMaterialsForDay() {
    if (!dayDate) return
    setMaterialsLoading(true)
    setMaterialsRows([])
    setMaterialsSource(null)
    try {
      const { startISO, endISO } = getDayBounds(dayDate)

      const trySources: Array<() => Promise<{ ok: boolean, source: string, rows: any[] }>> = [
        async () => {
          try {
            let q = supabase.from('v_materials_reservations_detailed').select('*') as any
            if (teamId !== 'all') q = q.eq('team_id', teamId)
            const { data, error } = await q
              .lt('starts_at', endISO)
              .gt('ends_at', startISO)
              .order('starts_at', { ascending: true })
            if (error) throw error
            return { ok: true, source: 'v_materials_reservations_detailed', rows: (data as any[]) ?? [] }
          } catch { return { ok: false, source: 'v_materials_reservations_detailed', rows: [] } }
        },
        async () => {
          try {
            let q = supabase.from('materials_reservations').select(`
              id, team_id, starts_at, ends_at, notes, quantity, qty, count,
              teams:team_id(name),
              material_id,
              materials:material_id(name)
            `) as any
            if (teamId !== 'all') q = q.eq('team_id', teamId)
            const { data, error } = await q
              .lt('starts_at', endISO)
              .gt('ends_at', startISO)
              .order('starts_at', { ascending: true })
            if (error) throw error
            return { ok: true, source: 'materials_reservations', rows: (data as any[]) ?? [] }
          } catch { return { ok: false, source: 'materials_reservations', rows: [] } }
        },
        async () => {
          try {
            let q = supabase.from('material_reservations').select('*') as any
            if (teamId !== 'all') q = q.eq('team_id', teamId)
            const { data, error } = await q
              .lt('starts_at', endISO)
              .gt('ends_at', startISO)
              .order('starts_at', { ascending: true })
            if (error) throw error
            return { ok: true, source: 'material_reservations', rows: (data as any[]) ?? [] }
          } catch { return { ok: false, source: 'material_reservations', rows: [] } }
        },
        async () => {
          try {
            let q = supabase.from('tools_reservations').select('*') as any
            if (teamId !== 'all') q = q.eq('team_id', teamId)
            const { data, error } = await q
              .lt('starts_at', endISO)
              .gt('ends_at', startISO)
              .order('starts_at', { ascending: true })
            if (error) throw error
            return { ok: true, source: 'tools_reservations', rows: (data as any[]) ?? [] }
          } catch { return { ok: false, source: 'tools_reservations', rows: [] } }
        },
      ]

      for (const fn of trySources) {
        const { ok, source, rows } = await fn()
        if (ok) {
          setMaterialsSource(source)
          setMaterialsRows(rows)
          break
        }
      }
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل حجوزات الأدوات')
    } finally { setMaterialsLoading(false) }
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
      toast.success('تم الحفظ')
      await refreshAll()
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحفظ')
    } finally { setSavingId(null) }
  }

  async function softDelete(id: string) {
    setDeletingId(id)
    try {
      const { error } = await supabase.from('field_reservations').update({ soft_deleted_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      toast.success('تم إلغاء الحجز')
      await refreshAll()
    } catch (e:any) {
      toast.error(e.message || 'تعذر الإلغاء')
    } finally { setDeletingId(null) }
  }

  // Helpers
  function getTeamNameFromRow(r: any): string {
    return (
      r.team_name ||
      r?.teams?.name ||
      r?.team?.name ||
      teams.find(t => t.id === r.team_id)?.name ||
      '—'
    )
  }
  function getMaterialNameFromRow(r: any): string {
    return (
      r.material_name ||
      r?.materials?.name ||
      r?.item_name ||
      r?.item?.name ||
      r?.tool_name ||
      r?.tools?.name ||
      (r.material_id ? materialsDict[r.material_id] : '') ||
      '—'
    )
  }
  const normalizeDTLocal = (v?: string|null) => v ? v.slice(0,16) : ''

  // أي مصادر قابلة للتعديل؟
  const editableMaterialsBaseTable = () => {
    if (materialsSource === 'materials_reservations') return 'materials_reservations'
    if (materialsSource === 'material_reservations') return 'material_reservations'
    if (materialsSource === 'tools_reservations') return 'tools_reservations'
    return null // View
  }

  function detectQtyCol(r:any): QtyCol {
    if ('quantity' in r) return 'quantity'
    if ('qty' in r) return 'qty'
    if ('count' in r) return 'count'
    return null
  }

  function detectSoftDeleteCol(r:any): SoftDeleteCol {
    if ('soft_deleted_at' in r) return 'soft_deleted_at'
    if ('deleted_at' in r) return 'deleted_at'
    if ('is_deleted' in r) return 'is_deleted'
    return null
  }

  function startEditMat(r: any) {
    if (!r?.id) return
    setEditingMatId(r.id)
    setEditingQtyCol(detectQtyCol(r))
    setEditingSoftCol(detectSoftDeleteCol(r))
    setEditingMatDraft({
      quantity: (r.quantity ?? r.qty ?? r.count ?? 1) as number,
      starts_at: normalizeDTLocal(r.starts_at),
      ends_at: normalizeDTLocal(r.ends_at),
    })
  }
  function cancelEditMat() {
    setEditingMatId(null)
    setEditingMatDraft(null)
    setEditingQtyCol(null)
    setEditingSoftCol(null)
  }

  // ✅ UPDATE بدون .select — نعتمد على عدم وجود error
  async function saveEditMat() {
    if (!editingMatId || !editingMatDraft) return
    const base = editableMaterialsBaseTable()
    if (!base) {
      toast.error('مصدر البيانات الحالي غير قابل للتعديل.')
      return
    }
    const qtyCol: QtyCol = editingQtyCol || 'qty' // fallback شائع
    try {
      setSavingMatId(editingMatId)

      const isoStart = editingMatDraft.starts_at ? new Date(editingMatDraft.starts_at).toISOString() : null
      const isoEnd   = editingMatDraft.ends_at   ? new Date(editingMatDraft.ends_at).toISOString()   : null
      const qtyNum = Number(editingMatDraft.quantity || 0) || 1

      const payload: any = {}
      if (isoStart) payload.starts_at = isoStart
      if (isoEnd) payload.ends_at = isoEnd
      if (qtyCol) payload[qtyCol] = qtyNum

      const { error } = await supabase
        .from(base)
        .update(payload)
        .eq('id', editingMatId)

      if (error) throw error

      toast.success('تم حفظ التعديل')
      cancelEditMat()
      await refreshMaterialsForDay()
    } catch (e:any) {
      toast.error(e?.message || 'تعذر حفظ التعديل')
    } finally {
      setSavingMatId(null)
    }
  }

  // ✅ إلغاء الحجز: Soft-delete إن وُجد عمود، وإلا Delete — بدون .select
  async function cancelMaterialReservation(row: any) {
    if (!row?.id) return
    const base = editableMaterialsBaseTable()
    if (!base) {
      toast.error('مصدر البيانات الحالي غير قابل للإلغاء.')
      return
    }
    if (!confirm('هل أنت متأكد من إلغاء هذا الحجز؟')) return
    try {
      setCancellingMatId(row.id)

      const softCol: SoftDeleteCol = detectSoftDeleteCol(row)

      if (softCol) {
        const payload: any = {}
        payload[softCol] = softCol === 'is_deleted' ? true : new Date().toISOString()

        const { error } = await supabase
          .from(base)
          .update(payload)
          .eq('id', row.id)

        if (error) throw error

        toast.success('تم إلغاء الحجز')
        await refreshMaterialsForDay()
        return
      }

      // Delete فعلي
      const { error: e2 } = await supabase
        .from(base)
        .delete()
        .eq('id', row.id)

      if (e2) throw e2

      toast.success('تم إلغاء الحجز')
      await refreshMaterialsForDay()
    } catch (e:any) {
      toast.error(e?.message || 'تعذر إلغاء الحجز')
    } finally {
      setCancellingMatId(null)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">إدارة حجوزات الأرض</h1>

      {/* الخرائط دائمًا */}
      <FieldMaps className="mb-4" sticky height="h-72 md:h-[28rem]" />

      {/* فلاتر: يوم + فريق */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
        <div>
          <label className="text-sm">التاريخ</label>
          <input
            type="date"
            className="border rounded-xl p-2 w-full min-w-0"
            value={dayDate}
            onChange={e=>setDayDate(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm">الفريق</label>
          <select
            className="border rounded-xl p-2 w-full min-w-0 cursor-pointer"
            value={teamId}
            onChange={e=>setTeamId(e.target.value)}
          >
            <option value="all">كل الفرق</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="text-end mt-2 sm:mt-0">
          <button className="btn border w-full sm:w-auto" onClick={refreshAll}>تحديث</button>
        </div>
      </div>

      {/* ملخص اليوم */}
      <section className="card space-y-3">
        <div className="flex flex-wrap items-end gap-3 justify-between">
          <h2 className="text-lg font-semibold">ملخص اليوم — عدد الأرض المحجوزة</h2>
          <div className="text-sm text-gray-600">التاريخ: {dayDate || '—'}</div>
        </div>

        <PageLoader visible={summaryLoading} text="جاري حساب الملخص..." />
        <div className="border rounded-2xl w-full max-w-full overflow-x-auto" dir="ltr" style={{ WebkitOverflowScrolling: 'touch' as any }}>
          <table className="w-full min-w-[520px] text-xs sm:text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الفريق</th>
                <th className="p-2 text-center">عدد الحجوزات</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map(r => (
                <tr key={r.team_id} className="border-t">
                  <td className="p-2">{r.team_name}</td>
                  <td className="p-2 text-center">{r.reservations}</td>
                </tr>
              ))}
              {summaryRows.length === 0 && (
                <tr>
                  <td className="p-3 text-center text-gray-500" colSpan={2}>لا توجد حجوزات في هذا اليوم</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* حجوزات الأدوات (مع تعديل/إلغاء) */}
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">حجوزات الأدوات — نفس اليوم</h2>
          {materialsSource && <div className="text-xs text-gray-500">المصدر: {materialsSource}</div>}
        </div>
        <PageLoader visible={materialsLoading} text="جاري تحميل حجوزات الأدوات..." />
        <div className="border rounded-2xl w-full max-w-full overflow-x-auto" dir="ltr" style={{ WebkitOverflowScrolling: 'touch' as any }}>
          <table className="w-full min-w-[980px] text-xs sm:text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الفريق</th>
                <th className="p-2 text-start">الأداة</th>
                <th className="p-2 text-center">الكمية</th>
                <th className="p-2 text-start whitespace-nowrap">من</th>
                <th className="p-2 text-start whitespace-nowrap">إلى</th>
                <th className="p-2 text-center">تحرير</th>
                <th className="p-2 text-center">إلغاء الحجز</th>
              </tr>
            </thead>
            <tbody>
              {materialsRows.map((r:any) => {
                const teamName = getTeamNameFromRow(r)
                const itemName = getMaterialNameFromRow(r)
                const qty = (r.quantity ?? r.qty ?? r.count ?? r.amount ?? 1) as number
                const start = (r.starts_at || '')
                const end   = (r.ends_at   || '')
                const startDisp = start ? start.slice(0,16).replace('T',' ') : '—'
                const endDisp   = end   ? end.slice(0,16).replace('T',' ')   : '—'
                const key = r.id || `${teamName}-${itemName}-${start}`

                const canEdit = !!r.id && !!editableMaterialsBaseTable()
                const isEditing = editingMatId === r.id

                return (
                  <tr key={key} className="border-t align-top">
                    <td className="p-2">{teamName}</td>
                    <td className="p-2">{itemName}</td>
                    <td className="p-2 text-center">
                      {isEditing ? (
                        <input
                          type="number"
                          min={1}
                          className="border rounded-xl p-1 w-24 text-center"
                          value={editingMatDraft?.quantity ?? 1}
                          onChange={e=>setEditingMatDraft(d => d ? { ...d, quantity: e.target.value } : d)}
                        />
                      ) : qty}
                    </td>
                    <td className="p-2">
                      {isEditing ? (
                        <input
                          type="datetime-local"
                          className="border rounded-xl p-1 w-48"
                          value={editingMatDraft?.starts_at ?? normalizeDTLocal(start)}
                          onChange={e=>setEditingMatDraft(d => d ? { ...d, starts_at: e.target.value } : d)}
                        />
                      ) : startDisp}
                    </td>
                    <td className="p-2">
                      {isEditing ? (
                        <input
                          type="datetime-local"
                          className="border rounded-xl p-1 w-48"
                          value={editingMatDraft?.ends_at ?? normalizeDTLocal(end)}
                          onChange={e=>setEditingMatDraft(d => d ? { ...d, ends_at: e.target.value } : d)}
                        />
                      ) : endDisp}
                    </td>
                    <td className="p-2 text-center">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-2">
                          <LoadingButton
                            loading={savingMatId===r.id}
                            onClick={saveEditMat}
                          >
                            حفظ
                          </LoadingButton>
                          <button className="btn border" onClick={cancelEditMat}>إلغاء التعديل</button>
                        </div>
                      ) : (
                        <button
                          className="btn border"
                          disabled={!canEdit}
                          onClick={()=>startEditMat(r)}
                          title={canEdit ? '' : 'غير قابل للتعديل (مصدر البيانات View)'}
                        >
                          تعديل
                        </button>
                      )}
                    </td>
                    <td className="p-2 text-center">
                      <button
                        className="btn border"
                        disabled={!canEdit || cancellingMatId===r.id}
                        onClick={()=>cancelMaterialReservation(r)}
                        title={canEdit ? '' : 'غير قابل للإلغاء (مصدر البيانات View)'}
                      >
                        {cancellingMatId===r.id ? '...' : 'إلغاء'}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {materialsRows.length === 0 && !materialsLoading && (
                <tr>
                  <td className="p-3 text-center text-gray-500" colSpan={7}>
                    لا توجد حجوزات أدوات في هذا اليوم{teamId!=='all' ? ' لهذا الفريق' : ''}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* الجدول الرئيسي (حجوزات الأرض) */}
      <div className="border rounded-2xl w-full max-w-full overflow-x-auto" dir="ltr" style={{ WebkitOverflowScrolling: 'touch' as any }}>
        <table className="w-full min-w-[920px] text-xs sm:text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-start">الفريق</th>
              <th className="p-2 text-start">القطاع</th>
              <th className="p-2 text-start whitespace-nowrap">من</th>
              <th className="p-2 text-start whitespace-nowrap">إلى</th>
              <th className="p-2 text-start whitespace-nowrap">تاريخ الاجتماع</th>
              <th className="p-2 text-start">النوع</th>
              <th className="p-2 text-center">حفظ</th>
              <th className="p-2 text-center">إلغاء</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                <td className="p-2">
                  <select
                    className="border rounded-xl p-1 w-full sm:w-auto min-w-0"
                    value={r.team_id}
                    onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, team_id: e.target.value}:x))}
                  >
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </td>
                <td className="p-2">
                  <select
                    className="border rounded-xl p-1 w-full sm:w-auto min-w-0"
                    value={r.field_zone_id}
                    onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, field_zone_id: e.target.value}:x))}
                  >
                    {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                </td>
                <td className="p-2">
                  <input
                    type="datetime-local"
                    className="border rounded-xl p-1 w-full sm:w-auto min-w-0"
                    value={r.starts_at?.slice(0,16)}
                    onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, starts_at: e.target.value}:x))}
                  />
                </td>
                <td className="p-2">
                  <input
                    type="datetime-local"
                    className="border rounded-xl p-1 w-full sm:w-auto min-w-0"
                    value={r.ends_at?.slice(0,16)}
                    onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, ends_at: e.target.value}:x))}
                  />
                </td>
                <td className="p-2">
                  <input
                    type="date"
                    className="border rounded-xl p-1 w-full sm:w-auto min-w-0"
                    value={r.meeting_date ?? ''}
                    onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, meeting_date: e.target.value}:x))}
                  />
                </td>
                <td className="p-2">
                  <select
                    className="border rounded-xl p-1 w-full sm:w-auto min-w-0"
                    value={r.mtype ?? 'meeting'}
                    onChange={e=>setRows(prev=>prev.map(x=>x.id===r.id?{...x, mtype: e.target.value as any}:x))}
                  >
                    <option value="preparation">تحضير</option>
                    <option value="meeting">اجتماع</option>
                  </select>
                </td>
                <td className="p-2 text-center">
                  <LoadingButton
                    className="w-full sm:w-auto"
                    loading={savingId===r.id}
                    onClick={()=>saveRow(r)}
                  >
                    حفظ
                  </LoadingButton>
                </td>
                <td className="p-2 text-center">
                  <button
                    className="btn border w-full sm:w-auto"
                    disabled={deletingId===r.id}
                    onClick={()=>softDelete(r.id)}
                  >
                    {deletingId===r.id ? '...' : 'إلغاء'}
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="p-3 text-center text-gray-500" colSpan={8}>لا توجد سجلات لهذا اليوم</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
