// src/pages/financeEvent.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ui/Toaster'
import { LoadingButton } from '../components/ui/LoadingButton'
import { PageLoader } from '../components/ui/PageLoader'
import { useAuth } from '../components/AuthProvider'
import ExcelJS from 'exceljs'

type RoleRow = { role_slug: string; team_id?: string | null }
type EventRow = { id: string; name: string; event_date: string; notes: string | null }
type EventExpense = { id: string; expense_date: string; item_name: string; qty: number; unit_price: number; total: number }

export default function FinanceEvent() {
  const toast = useToast()
  const { roles, user } = useAuth()

  // صلاحيات: أدمن أو مسؤول ميزانية عام (team_id = null)
  const isAdmin = roles.some((r: RoleRow) => r.role_slug === 'admin')
  const isGlobalFinance = roles.some((r: RoleRow) => r.role_slug === 'responsable_finance' && (r.team_id == null))
  const canManage = isAdmin || isGlobalFinance

  const [rolesReady, setRolesReady] = useState(false)
  useEffect(() => { setRolesReady(true) }, [roles.length])

  const [loading, setLoading] = useState(true)

  // قائمة الأحداث + الحالي المختار
  const [events, setEvents] = useState<EventRow[]>([])
  const [selectedId, setSelectedId] = useState<string>('')

  // فورم إنشاء/تعديل الحدث
  const [evName, setEvName] = useState('')
  const [evDate, setEvDate] = useState('')
  const [evNotes, setEvNotes] = useState('')

  const [savingEvent, setSavingEvent] = useState(false)
  const [updatingEvent, setUpdatingEvent] = useState(false)
  const [deletingEvent, setDeletingEvent] = useState(false)

  // مصروفات الحدث المختار
  const [expenses, setExpenses] = useState<EventExpense[]>([])
  const [savingExp, setSavingExp] = useState(false)
  const [deletingExpId, setDeletingExpId] = useState<string>('')

  // فورم إضافة بند
  const [exDate, setExDate] = useState('')
  const [exName, setExName] = useState('')
  const [exQty, setExQty] = useState<number | ''>('')
  const [exUnit, setExUnit] = useState<number | ''>('')

  // تعديل صف موجود
  const [editingId, setEditingId] = useState<string>('') // expense id
  const [editDate, setEditDate] = useState('')
  const [editName, setEditName] = useState('')
  const [editQty, setEditQty] = useState<number | ''>('')
  const [editUnit, setEditUnit] = useState<number | ''>('')

  // === Export state ===
  const [exporting, setExporting] = useState(false)
  type ExportMode = 'one' | 'year'
  const [exportMode, setExportMode] = useState<ExportMode>('one')
  const years = useMemo(() => {
    const ys = new Set<number>()
    for (const e of events) {
      const y = Number((e.event_date || '').slice(0,4))
      if (!isNaN(y)) ys.add(y)
    }
    return Array.from(ys).sort((a,b)=>a-b)
  }, [events])
  const [exportYear, setExportYear] = useState<number | ''>('')
  const [exportEventId, setExportEventId] = useState<string>('')

  useEffect(() => {
    if (years.length && exportYear === '') setExportYear(years[0])
    if (!exportEventId && selectedId) setExportEventId(selectedId)
  }, [years, exportYear, selectedId, exportEventId])

  /* ==================== Sanitizers ==================== */
  const stripMarks = (s: any) =>
    (s == null ? '' : String(s))
      .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
      .replace(/Â|â€‹|â€/g, '')

  const looksMojibake = (s: string) =>
    /[ÃÂÙƒƒœ„’”“–—]/.test(s) || /(?:Ø|Ù){2,}/.test(s)

  const WIN1252_UNI_TO_BYTE: Record<number, number> = {
    0x20AC:0x80, 0x201A:0x82, 0x0192:0x83, 0x201E:0x84, 0x2026:0x85, 0x2020:0x86, 0x2021:0x87,
    0x02C6:0x88, 0x2030:0x89, 0x0160:0x8A, 0x2039:0x8B, 0x0152:0x8C, 0x017D:0x8E, 0x2018:0x91,
    0x2019:0x92, 0x201C:0x93, 0x201D:0x94, 0x2022:0x95, 0x2013:0x96, 0x2014:0x97, 0x02DC:0x98,
    0x2122:0x99, 0x0161:0x9A, 0x203A:0x9B, 0x0153:0x9C, 0x017E:0x9E, 0x0178:0x9F
  }

  const win1252MojibakeToUtf8 = (input: string) => {
    const cleaned = stripMarks(input)
    if (!looksMojibake(cleaned)) return cleaned
    const bytes = new Uint8Array([...cleaned].map(ch => {
      const code = ch.charCodeAt(0)
      if (code <= 0xFF) return code
      return WIN1252_UNI_TO_BYTE[code] ?? 0x3F
    }))
    try { return new TextDecoder('utf-8').decode(bytes) } catch { return cleaned }
  }

  const sanitizeForUI = (v: any) => {
    const s = stripMarks(v)
    return win1252MojibakeToUtf8(s)
  }

  const egp = (v: number) =>
    new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(v)

  const totalSpent = useMemo(() => expenses.reduce((s, x) => s + (Number(x.total) || 0), 0), [expenses])

  /* ==================== Init ==================== */
  useEffect(() => { init() }, [canManage]) // مهم: بعد ما الأدوار توصل

  async function init() {
    if (!canManage) { setLoading(false); return }
    setLoading(true)
    try {
      await loadEvents()
      // Default dates = today
      const today = new Date(); const pad = (n:number)=>String(n).padStart(2,'0')
      const todayStr = `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`
      setEvDate(todayStr)
      setExDate(todayStr)
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الأحداث')
    } finally {
      setLoading(false)
    }
  }

  async function loadEvents() {
    const { data, error } = await supabase
      .from('finance_events')
      .select('id, name, event_date, notes')
      .is('soft_deleted_at', null)
      .order('event_date', { ascending: false })
      .order('name', { ascending: true })

    if (error) throw error

    const cleaned = (data ?? []).map((e:any) => ({
      ...e,
      name: sanitizeForUI(e.name),
      event_date: sanitizeForUI(e.event_date),
      notes: sanitizeForUI(e.notes)
    }))
    setEvents(cleaned)
    if (cleaned.length && !selectedId) setSelectedId(cleaned[0].id)
    if (cleaned.length === 0) { setSelectedId(''); setExpenses([]) }
  }

  useEffect(() => { if (selectedId) loadExpenses(selectedId) }, [selectedId])

  async function loadExpenses(eventId: string) {
    const { data, error } = await supabase
      .from('finance_event_expenses')
      .select('id, expense_date, item_name, qty, unit_price, total')
      .eq('event_id', eventId)
      .is('soft_deleted_at', null)
      .order('expense_date', { ascending: true })
      .order('id', { ascending: true })

    if (error) { toast.error(error.message || 'تعذر تحميل مصروفات الحدث'); return }
    const fixed = (data ?? []).map((r:any) => ({
      ...r,
      expense_date: sanitizeForUI(r.expense_date),
      item_name: sanitizeForUI(r.item_name)
    }))
    setExpenses(fixed)
  }

  /* ==================== Events CRUD ==================== */
  async function createEvent() {
    if (!evName.trim()) return toast.error('ادخل اسم الحدث')
    if (!evDate) return toast.error('اختر تاريخ الحدث')
    setSavingEvent(true)
    try {
      const { data, error } = await supabase
        .from('finance_events')
        .insert({
          name: stripMarks(evName.trim()),
          event_date: stripMarks(evDate),
          notes: stripMarks(evNotes || ''),
          created_by: user?.id ?? null
        })
        .select('id')
        .single()

      if (error) throw error
      setEvName(''); setEvNotes('')
      await loadEvents()
      if (data?.id) setSelectedId(data.id)
      toast.success('تم إنشاء الحدث')
    } catch (e:any) {
      toast.error(e.message || 'تعذر إنشاء الحدث')
    } finally {
      setSavingEvent(false)
    }
  }

  async function updateEvent() {
    if (!selectedId) return
    if (!evName.trim()) return toast.error('ادخل اسم الحدث')
    if (!evDate) return toast.error('اختر تاريخ الحدث')
    setUpdatingEvent(true)
    try {
      const { error } = await supabase
        .from('finance_events')
        .update({
          name: stripMarks(evName.trim()),
          event_date: stripMarks(evDate),
          notes: stripMarks(evNotes || '')
        })
        .eq('id', selectedId)

      if (error) throw error
      await loadEvents()
      toast.success('تم تحديث بيانات الحدث')
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحديث الحدث')
    } finally {
      setUpdatingEvent(false)
    }
  }

  async function softDeleteEvent() {
    if (!selectedId) return
    setDeletingEvent(true)
    try {
      // احذف الحدث ناعماً
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('finance_events')
        .update({ soft_deleted_at: now })
        .eq('id', selectedId)
        .is('soft_deleted_at', null)
      if (error) throw error

      // (اختياري) احذف مصروفاته ناعماً برضه للي ما تلحقوش تريجر الكاسكيد
      await supabase
        .from('finance_event_expenses')
        .update({ soft_deleted_at: now })
        .eq('event_id', selectedId)
        .is('soft_deleted_at', null)

      toast.success('تم حذف الحدث')
      await loadEvents()
    } catch (e:any) {
      toast.error(e.message || 'تعذر حذف الحدث')
    } finally {
      setDeletingEvent(false)
    }
  }

  // بعد اختيار حدث، نملأ الفورم بقيمه لسهولة التعديل
  useEffect(() => {
    const cur = events.find(e => e.id === selectedId)
    if (!cur) return
    setEvName(cur.name || '')
    setEvDate(cur.event_date?.slice(0,10) || '')
    setEvNotes(cur.notes || '')
  }, [selectedId, events])

  /* ==================== Expenses CRUD ==================== */
  async function addExpense() {
    if (!selectedId) return toast.error('اختر حدثاً أولاً')
    const q = Number(exQty), u = Number(exUnit)
    if (!exName.trim()) return toast.error('ادخل اسم البند')
    if (!exDate) return toast.error('اختر التاريخ')
    if (!isFinite(q) || q <= 0) return toast.error('العدد غير صالح')
    if (!isFinite(u) || u < 0) return toast.error('سعر القطعة غير صالح')

    setSavingExp(true)
    try {
      const { error } = await supabase
        .from('finance_event_expenses')
        .insert({
          event_id: selectedId,
          expense_date: stripMarks(exDate),
          item_name: stripMarks(exName.trim()),
          qty: q,
          unit_price: u,
          total: q * u
        })
      if (error) throw error
      setExName(''); setExQty(''); setExUnit('')
      await loadExpenses(selectedId)
      toast.success('تم إضافة المصروف')
    } catch (e:any) {
      toast.error(e.message || 'تعذر إضافة المصروف')
    } finally {
      setSavingExp(false)
    }
  }

  function startEditRow(x: EventExpense) {
    setEditingId(x.id)
    setEditDate(x.expense_date?.slice(0,10) || '')
    setEditName(x.item_name || '')
    setEditQty(Number(x.qty) || 0)
    setEditUnit(Number(x.unit_price) || 0)
  }

  async function saveEditRow() {
    if (!editingId) return
    const q = Number(editQty), u = Number(editUnit)
    if (!editName.trim()) return toast.error('ادخل اسم البند')
    if (!editDate) return toast.error('اختر التاريخ')
    if (!isFinite(q) || q <= 0) return toast.error('العدد غير صالح')
    if (!isFinite(u) || u < 0) return toast.error('سعر القطعة غير صالح')

    setSavingExp(true)
    try {
      const { error } = await supabase
        .from('finance_event_expenses')
        .update({
          expense_date: stripMarks(editDate),
          item_name: stripMarks(editName.trim()),
          qty: q,
          unit_price: u,
          total: q * u
        })
        .eq('id', editingId)

      if (error) throw error
      setEditingId('')
      await loadExpenses(selectedId)
      toast.success('تم حفظ التعديل')
    } catch (e:any) {
      toast.error(e.message || 'تعذر حفظ التعديل')
    } finally {
      setSavingExp(false)
    }
  }

  async function deleteRow(id: string) {
    if (!id) return
    setDeletingExpId(id)
    try {
      const { error } = await supabase
        .from('finance_event_expenses')
        .update({ soft_deleted_at: new Date().toISOString() })
        .eq('id', id)
        .is('soft_deleted_at', null)

      if (error) throw error
      await loadExpenses(selectedId)
      toast.success('تم حذف البند')
    } catch (e:any) {
      toast.error(e.message || 'تعذر حذف البند')
    } finally {
      setDeletingExpId('')
    }
  }

  /* ==================== Export XLSX ==================== */

  function parseDate(d?: string) {
    if (!d) return ''
    const s = String(d).slice(0,10)
    const [y,m,dd] = s.split('-').map(Number)
    if ([y,m,dd].every(x => !isNaN(x))) return new Date(y, (m||1)-1, dd||1)
    return d
  }

  function sanitizeSheetName(name: string) {
    const cleaned = name.replace(/[:\\/?*\[\]]/g, ' ').trim()
    return cleaned.length > 31 ? cleaned.slice(0, 29) + '…' : cleaned
  }

  function ensureUniqueName(base: string, used: Set<string>) {
    let name = sanitizeSheetName(base)
    if (!used.has(name)) { used.add(name); return name }
    let i = 2
    while (used.has(`${name} (${i})`)) i++
    const finalName = sanitizeSheetName(`${name} (${i})`)
    used.add(finalName)
    return finalName
  }

  async function fetchEventsData(filters: { year?: number; eventId?: string }) {
    let evs: EventRow[] = []
    if (filters.eventId) {
      const { data, error } = await supabase
        .from('finance_events')
        .select('id, name, event_date, notes')
        .eq('id', filters.eventId)
        .is('soft_deleted_at', null)
        .maybeSingle()
      if (error) throw error
      if (data) evs = [data as EventRow]
    } else if (filters.year) {
      const y = filters.year
      const from = `${y}-01-01`
      const to = `${y+1}-01-01`
      const { data, error } = await supabase
        .from('finance_events')
        .select('id, name, event_date, notes')
        .gte('event_date', from)
        .lt('event_date', to)
        .is('soft_deleted_at', null)
        .order('event_date', { ascending: true })
        .order('name', { ascending: true })
      if (error) throw error
      evs = (data ?? []) as EventRow[]
    } else {
      evs = []
    }

    // sanitize
    evs = evs.map(e => ({
      ...e,
      name: sanitizeForUI(e.name),
      event_date: sanitizeForUI(e.event_date),
      notes: sanitizeForUI(e.notes)
    }))

    // fetch expenses for those events
    const expensesByEvent = new Map<string, EventExpense[]>()
    const ids = evs.map(e => e.id)
    if (ids.length) {
      const { data, error } = await supabase
        .from('finance_event_expenses')
        .select('id, event_id, expense_date, item_name, qty, unit_price, total')
        .in('event_id', ids)
        .is('soft_deleted_at', null)
        .order('expense_date', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      for (const row of (data ?? [])) {
        const arr = expensesByEvent.get(row.event_id) || []
        arr.push({
          id: row.id,
          expense_date: sanitizeForUI(row.expense_date),
          item_name: sanitizeForUI(row.item_name),
          qty: Number(row.qty) || 0,
          unit_price: Number(row.unit_price) || 0,
          total: Number(row.total) || (Number(row.qty||0) * Number(row.unit_price||0))
        })
        expensesByEvent.set(row.event_id, arr)
      }
    }
    return { evs, expensesByEvent }
  }

  async function handleExport() {
    if (!canManage) return
    setExporting(true)
    try {
      let filename = 'events.xlsx'
      let filters: { year?: number; eventId?: string } = {}

      if (exportMode === 'one') {
        const evId = exportEventId || selectedId
        if (!evId) throw new Error('اختر حدثاً للتصدير')
        filters.eventId = evId
        const ev = events.find(e => e.id === evId)
        const evDate = ev?.event_date?.slice(0,10) || 'event'
        filename = `event_${evDate}_Finance.xlsx`
      } else {
        if (!exportYear) throw new Error('اختر السنة للتصدير')
        filters.year = Number(exportYear)
        filename = `events_${exportYear}.xlsx`
      }

      const { evs, expensesByEvent } = await fetchEventsData(filters)
      if (evs.length === 0) throw new Error('لا توجد أحداث للتصدير وفق الفلاتر')

      // Workbook/Styles
      const wb = new ExcelJS.Workbook()
      const usedNames = new Set<string>()
      const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF59D' } }
      const thinBorder = {
        top: { style: 'thin' as const, color: { argb: 'FFE0E0E0' } },
        left: { style: 'thin' as const, color: { argb: 'FFE0E0E0' } },
        bottom: { style: 'thin' as const, color: { argb: 'FFE0E0E0' } },
        right: { style: 'thin' as const, color: { argb: 'FFE0E0E0' } },
      }

      function addHeader(ws: ExcelJS.Worksheet) {
        ws.views = [{ state: 'frozen', ySplit: 1 }]
        ws.columns = [
          { key: 'expdate', width: 14, style: { numFmt: 'yyyy-mm-dd' } },
          { key: 'item', width: 32 },
          { key: 'qty', width: 10, style: { numFmt: '#,##0.00' } },
          { key: 'unit', width: 14, style: { numFmt: '#,##0.00' } },
          { key: 'line', width: 16, style: { numFmt: '#,##0.00' } },
        ]
        const hr = ws.addRow(['Expense Date','Item','Qty','Unit Price','Line Total'])
        hr.font = { bold: true }
        hr.alignment = { vertical: 'middle' }
        hr.height = 22
        hr.eachCell(c => { c.fill = headerFill; c.border = thinBorder })
      }

      function addDataRow(ws: ExcelJS.Worksheet, values: any[]) {
        const r = ws.addRow(values)
        r.eachCell(c => { c.border = thinBorder })
        return r
      }

      // ترتيب الأحداث بالسنة/التاريخ/الاسم
      evs.sort((a,b) => {
        const ad = a.event_date || '', bd = b.event_date || ''
        if (ad !== bd) return ad.localeCompare(bd)
        return (a.name||'').localeCompare(b.name||'', 'ar')
      })

      for (const ev of evs) {
        const datePart = (ev.event_date || '').slice(0,10)
        const base = `${datePart} — ${ev.name || 'Event'}`
        const wsName = ensureUniqueName(base, usedNames)
        const ws = wb.addWorksheet(wsName)

        addHeader(ws)

        const lines = (expensesByEvent.get(ev.id) || []).slice()
        let total = 0
        for (const l of lines) {
          total += Number(l.total) || 0
          const d = parseDate(l.expense_date)
          const row = addDataRow(ws, [
            d instanceof Date ? d : (l.expense_date || ''),
            l.item_name || '',
            Number(l.qty || 0),
            Number(l.unit_price || 0),
            Number(l.total || (Number(l.qty||0)*Number(l.unit_price||0))),
          ])
          if (d instanceof Date) row.getCell(1).numFmt = 'yyyy-mm-dd'
          row.getCell(3).numFmt = '#,##0.00'
          row.getCell(4).numFmt = '#,##0.00'
          row.getCell(5).numFmt = '#,##0.00'
        }

        if (lines.length === 0) {
          addDataRow(ws, ['No data','','','',''])
        } else {
          const totalRow = addDataRow(ws, ['', 'TOTAL', '', '', total])
          totalRow.font = { bold: true }
        }
      }

      // تنزيل الملف
      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success('تم إنشاء ملف Excel')
    } catch (e:any) {
      console.error(e)
      toast.error(e.message || 'فشل إنشاء ملف Excel')
    } finally {
      setExporting(false)
    }
  }

  /* ==================== Render ==================== */
  if (!rolesReady) {
    return <PageLoader visible text="جارِ التحقق من الصلاحيات..." />
  }
  if (!canManage) {
    return (
      <div className="p-6">
        <h1 className="text-lg font-semibold">الأحداث — مصروفات عامة</h1>
        <div className="mt-3 text-sm text-gray-600">ليست لديك صلاحية الوصول إلى هذه الصفحة.</div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جارِ التحميل..." />

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">الأحداث — تسجيل المصروفات العامة (بدون ميزانية)</h1>
        {selectedId && (
          <button
            className="text-rose-600 hover:underline disabled:opacity-50"
            onClick={softDeleteEvent}
            disabled={deletingEvent}
          >
            {deletingEvent ? 'جارِ الحذف...' : 'حذف الحدث'}
          </button>
        )}
      </div>

      {/* Events selector + create */}
      <section className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm">الحدث</label>
          <select
            className="border rounded-xl p-2 w-full cursor-pointer"
            value={selectedId}
            onChange={e=>setSelectedId(e.target.value)}
          >
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>
                {ev.event_date?.slice(0,10)} — {ev.name}
              </option>
            ))}
          </select>
          <div className="text-xs text-gray-500">اختر حدثًا لاستعراض/تعديل مصروفاته.</div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">إنشاء حدث جديد</div>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div className="md:col-span-2">
              <label className="text-xs">اسم الحدث</label>
              <input className="border rounded-xl p-2 w-full" value={evName} onChange={e=>setEvName(e.target.value)} placeholder="مثلاً: حفلة الوعد" />
            </div>
            <div>
              <label className="text-xs">تاريخ الحدث</label>
              <input type="date" className="border rounded-xl p-2 w-full" value={evDate} onChange={e=>setEvDate(e.target.value)} />
            </div>
            <div className="md:col-span-4">
              <label className="text-xs">ملاحظات</label>
              <input className="border rounded-xl p-2 w-full" value={evNotes} onChange={e=>setEvNotes(e.target.value)} placeholder="اختياري" />
            </div>
            <div className="md:col-span-4 flex justify-end">
              <LoadingButton loading={savingEvent} onClick={createEvent}>إنشاء حدث</LoadingButton>
            </div>
          </div>
        </div>
      </section>

      {/* Summary cards */}
      {selectedId && (
        <div className="grid md:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl border">
            <div className="text-xs text-gray-500">إجمالي المصروفات</div>
            <div className="text-2xl font-bold">{egp(totalSpent)}</div>
          </div>
        </div>
      )}

      {/* Add expense */}
      {selectedId && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">إضافة مصروف للحدث</h2>
          <div className="grid md:grid-cols-5 gap-2 items-end">
            <div>
              <label className="text-sm">التاريخ</label>
              <input type="date" className="border rounded-xl p-2 w-full" value={exDate} onChange={e=>setExDate(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm">البند</label>
              <input className="border rounded-xl p-2 w-full" value={exName} onChange={e=>setExName(e.target.value)} placeholder="مثلاً: إيجار قاعة" />
            </div>
            <div>
              <label className="text-sm">العدد</label>
              <input type="number" min={1} className="border rounded-xl p-2 w-full" value={exQty} onChange={e=>setExQty(e.target.value as any)} />
            </div>
            <div>
              <label className="text-sm">سعر القطعة</label>
              <input type="number" min={0} step={0.01} className="border rounded-xl p-2 w-full" value={exUnit} onChange={e=>setExUnit(e.target.value as any)} />
            </div>
            <div className="md:col-span-5 flex justify-end">
              <LoadingButton loading={savingExp} onClick={addExpense}>إضافة</LoadingButton>
            </div>
          </div>
        </section>
      )}

      {/* Expenses table */}
      {selectedId && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">مصروفات الحدث</h2>
          <div className="border rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-start">التاريخ</th>
                  <th className="p-2 text-start">البند</th>
                  <th className="p-2 text-center">العدد</th>
                  <th className="p-2 text-center">سعر القطعة</th>
                  <th className="p-2 text-center">الإجمالي</th>
                  <th className="p-2 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(x => {
                  const isEdit = editingId === x.id
                  return (
                    <tr key={x.id} className="border-t">
                      <td className="p-2">
                        {isEdit ? (
                          <input type="date" className="border rounded p-1" value={editDate} onChange={e=>setEditDate(e.target.value)} />
                        ) : sanitizeForUI(x.expense_date)}
                      </td>
                      <td className="p-2">
                        {isEdit ? (
                          <input className="border rounded p-1 w-full" value={editName} onChange={e=>setEditName(e.target.value)} />
                        ) : sanitizeForUI(x.item_name)}
                      </td>
                      <td className="p-2 text-center">
                        {isEdit ? (
                          <input type="number" min={1} className="border rounded p-1 w-24 text-center" value={editQty} onChange={e=>setEditQty(e.target.value as any)} />
                        ) : x.qty}
                      </td>
                      <td className="p-2 text-center">
                        {isEdit ? (
                          <input type="number" min={0} step={0.01} className="border rounded p-1 w-28 text-center" value={editUnit} onChange={e=>setEditUnit(e.target.value as any)} />
                        ) : egp(Number(x.unit_price))}
                      </td>
                      <td className="p-2 text-center">{egp(Number(x.total))}</td>
                      <td className="p-2 text-center">
                        {!isEdit ? (
                          <div className="flex gap-2 justify-center">
                            <button className="text-blue-600 hover:underline" onClick={()=>startEditRow(x)}>تعديل</button>
                            <button
                              className="text-rose-600 hover:underline disabled:opacity-50"
                              onClick={()=>deleteRow(x.id)}
                              disabled={deletingExpId === x.id}
                            >
                              {deletingExpId === x.id ? 'جارِ الحذف...' : 'حذف'}
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2 justify-center">
                            <button className="text-green-600 hover:underline disabled:opacity-50" onClick={saveEditRow} disabled={savingExp}>حفظ</button>
                            <button className="text-gray-600 hover:underline" onClick={()=>setEditingId('')}>إلغاء</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {expenses.length === 0 && (
                  <tr>
                    <td className="p-3 text-center text-gray-500" colSpan={6}>لا توجد مصروفات لهذا الحدث</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Export */}
      {(events.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">تصدير Excel (XLSX)</h2>
          <div className="grid md:grid-cols-4 gap-2 items-end">
            <div>
              <label className="text-sm">وضع التصدير</label>
              <select
                className="border rounded-xl p-2 w-full"
                value={exportMode}
                onChange={e=>setExportMode(e.target.value as ExportMode)}
              >
                <option value="one">حدث محدد</option>
                <option value="year">سنة كاملة — ورقة لكل حدث</option>
              </select>
            </div>

            {exportMode === 'one' && (
              <div className="md:col-span-2">
                <label className="text-sm">الحدث</label>
                <select
                  className="border rounded-xl p-2 w-full"
                  value={exportEventId || selectedId}
                  onChange={e=>setExportEventId(e.target.value)}
                >
                  {events.map(ev => (
                    <option key={ev.id} value={ev.id}>
                      {ev.event_date?.slice(0,10)} — {ev.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {exportMode === 'year' && (
              <div>
                <label className="text-sm">السنة</label>
                <select
                  className="border rounded-xl p-2 w-full"
                  value={exportYear}
                  onChange={e=>setExportYear(Number(e.target.value))}
                >
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            )}

            <div className="md:col-span-1 text-end">
              <LoadingButton loading={exporting} onClick={handleExport}>
                {exporting ? 'جارِ التحضير...' : 'تصدير XLSX'}
              </LoadingButton>
            </div>
          </div>

          <div className="text-xs text-gray-500">
            * في وضع السنة: كل حدث في Sheet منفصل داخل نفس الملف. الهيدر أصفر، كل الصفوف بحدود رفيعة، ويوجد صف إجمالي في نهاية كل حدث.
          </div>
        </section>
      )}
    </div>
  )
}
