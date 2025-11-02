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
type EventBudget = { id: string; item_name: string; qty: number; unit_price: number; line_total: number }

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

  // فورم إضافة بند مصروف
  const [exDate, setExDate] = useState('')
  const [exName, setExName] = useState('')
  const [exQty, setExQty] = useState<number | ''>('')
  const [exUnit, setExUnit] = useState<number | ''>('')

  // تعديل صف مصروف موجود
  const [editingId, setEditingId] = useState<string>('') // expense id
  const [editDate, setEditDate] = useState('')
  const [editName, setEditName] = useState('')
  const [editQty, setEditQty] = useState<number | ''>('')
  const [editUnit, setEditUnit] = useState<number | ''>('')

  // بنود الميزانية
  const [budgets, setBudgets] = useState<EventBudget[]>([])
  const [savingBudget, setSavingBudget] = useState(false)
  const [deletingBudgetId, setDeletingBudgetId] = useState<string>('')

  // فورم إضافة بند ميزانية
  const [bTitle, setBTitle] = useState('')
  const [bQty, setBQty] = useState<number | ''>('')
  const [bUnit, setBUnit] = useState<number | ''>('')

  // تعديل بند ميزانية
  const [editingBudgetId, setEditingBudgetId] = useState<string>('') // budget id
  const [editBTitle, setEditBTitle] = useState('')
  const [editBQty, setEditBQty] = useState<number | ''>('')
  const [editBUnit, setEditBUnit] = useState<number | ''>('')

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
  const budgetTotal = useMemo(
    () => budgets.reduce((s, b) => {
      const lt = Number(b.line_total) || ((Number(b.qty)||0) * (Number(b.unit_price)||0))
      return s + lt
    }, 0),
    [budgets]
  )
  const remaining = useMemo(() => budgetTotal - totalSpent, [budgetTotal, totalSpent])

  /* ==================== Init ==================== */
  useEffect(() => { init() }, [canManage])

  async function init() {
    if (!canManage) { setLoading(false); return }
    setLoading(true)
    try {
      await loadEvents()
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

    if (cleaned.length === 0) {
      setSelectedId('')
      setExpenses([])
      setBudgets([])
    } else if (!cleaned.some(ev => ev.id === selectedId)) {
      setSelectedId(cleaned[0].id)
    }
  }

  useEffect(() => {
    if (selectedId) {
      loadExpenses(selectedId)
      loadBudgets(selectedId)
    }
  }, [selectedId])

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

  async function loadBudgets(eventId: string) {
    const { data, error } = await supabase
      .from('finance_event_budgets')
      .select('id, item_name, qty, unit_price, line_total')
      .eq('event_id', eventId)
      .is('soft_deleted_at', null)
      .order('id', { ascending: true })

    if (error) { toast.error(error.message || 'تعذر تحميل بنود الميزانية'); return }
    const rows = (data ?? []).map((r:any) => ({
      id: r.id,
      item_name: sanitizeForUI(r.item_name ?? ''),
      qty: Number(r.qty) || 0,
      unit_price: Number(r.unit_price) || 0,
      line_total: Number(r.line_total) || ((Number(r.qty)||0) * (Number(r.unit_price)||0))
    })) as EventBudget[]
    setBudgets(rows)
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
      const now = new Date().toISOString()

      const { data, error } = await supabase
        .from('finance_events')
        .update({ soft_deleted_at: now })
        .eq('id', selectedId)
        .is('soft_deleted_at', null)
        .select('id')
        .limit(1)

      if (error) throw error
      if (!data || data.length === 0) {
        toast.error('لم يتم حذف الحدث (لا توجد صلاحية أو تم حذفه مسبقًا).')
        return
      }

      await supabase
        .from('finance_event_expenses')
        .update({ soft_deleted_at: now })
        .eq('event_id', selectedId)
        .is('soft_deleted_at', null)

      await supabase
        .from('finance_event_budgets')
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

  /* ==================== Budgets CRUD ==================== */
  async function addBudgetLine() {
    if (!selectedId) return toast.error('اختر حدثاً أولاً')
    const q = Number(bQty), u = Number(bUnit)
    if (!bTitle.trim()) return toast.error('ادخل اسم بند الميزانية')
    if (!isFinite(q) || q <= 0) return toast.error('العدد غير صالح')
    if (!isFinite(u) || u < 0) return toast.error('سعر الفرد غير صالح')

    setSavingBudget(true)
    try {
      const line_total = q * u
      const { error } = await supabase
        .from('finance_event_budgets')
        .insert({
          event_id: selectedId,
          item_name: stripMarks(bTitle.trim()),
          qty: q,
          unit_price: u,          // ← مهم: unit_price
          line_total
        })
      if (error) throw error
      setBTitle(''); setBQty(''); setBUnit('')
      await loadBudgets(selectedId)
      toast.success('تم إضافة بند الميزانية')
    } catch (e:any) {
      toast.error(e.message || 'تعذر إضافة بند الميزانية')
    } finally {
      setSavingBudget(false)
    }
  }

  function startEditBudgetRow(b: EventBudget) {
    setEditingBudgetId(b.id)
    setEditBTitle(b.item_name || '')
    setEditBQty(Number(b.qty) || 0)
    setEditBUnit(Number(b.unit_price) || 0)
  }

  async function saveEditBudgetRow() {
    if (!editingBudgetId) return
    const q = Number(editBQty), u = Number(editBUnit)
    if (!editBTitle.trim()) return toast.error('ادخل اسم بند الميزانية')
    if (!isFinite(q) || q <= 0) return toast.error('العدد غير صالح')
    if (!isFinite(u) || u < 0) return toast.error('سعر الفرد غير صالح')

    setSavingBudget(true)
    try {
      const line_total = q * u
      const { error } = await supabase
        .from('finance_event_budgets')
        .update({
          item_name: stripMarks(editBTitle.trim()),
          qty: q,
          unit_price: u,    // ← مهم
          line_total
        })
        .eq('id', editingBudgetId)

      if (error) throw error
      setEditingBudgetId('')
      await loadBudgets(selectedId)
      toast.success('تم حفظ تعديل بند الميزانية')
    } catch (e:any) {
      toast.error(e.message || 'تعذر حفظ التعديل')
    } finally {
      setSavingBudget(false)
    }
  }

  async function deleteBudgetRow(id: string) {
    if (!id) return
    setDeletingBudgetId(id)
    try {
      const { error } = await supabase
        .from('finance_event_budgets')
        .update({ soft_deleted_at: new Date().toISOString() })
        .eq('id', id)
        .is('soft_deleted_at', null)

      if (error) throw error
      await loadBudgets(selectedId)
      toast.success('تم حذف بند الميزانية')
    } catch (e:any) {
      toast.error(e.message || 'تعذر حذف بند الميزانية')
    } finally {
      setDeletingBudgetId('')
    }
  }

  /* ==================== Export XLSX (Expenses + Budgets) ==================== */
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

    evs = evs.map(e => ({
      ...e,
      name: sanitizeForUI(e.name),
      event_date: sanitizeForUI(e.event_date),
      notes: sanitizeForUI(e.notes)
    }))

    const expensesByEvent = new Map<string, EventExpense[]>()
    const budgetsByEvent = new Map<string, EventBudget[]>()
    const ids = evs.map(e => e.id)

    if (ids.length) {
      const { data: expData, error: expErr } = await supabase
        .from('finance_event_expenses')
        .select('id, event_id, expense_date, item_name, qty, unit_price, total')
        .in('event_id', ids)
        .is('soft_deleted_at', null)
        .order('expense_date', { ascending: true })
        .order('id', { ascending: true })
      if (expErr) throw expErr
      for (const row of (expData ?? [])) {
        const arr = expensesByEvent.get(row.event_id) || []
        arr.push({
          id: row.id,
          expense_date: sanitizeForUI(row.expense_date),
          item_name: sanitizeForUI(row.item_name),
          qty: Number(row.qty) || 0,
          unit_price: Number(row.unit_price) || 0,
          total: Number(row.total) || ((Number(row.qty)||0) * (Number(row.unit_price)||0))
        })
        expensesByEvent.set(row.event_id, arr)
      }

      const { data: budData, error: budErr } = await supabase
        .from('finance_event_budgets')
        .select('id, event_id, item_name, qty, unit_price, line_total')
        .in('event_id', ids)
        .is('soft_deleted_at', null)
        .order('id', { ascending: true })
      if (budErr) throw budErr
      for (const row of (budData ?? [])) {
        const arr = budgetsByEvent.get(row.event_id) || []
        arr.push({
          id: row.id,
          item_name: sanitizeForUI(row.item_name ?? ''),
          qty: Number(row.qty) || 0,
          unit_price: Number(row.unit_price) || 0,
          line_total: Number(row.line_total) || ((Number(row.qty)||0) * (Number(row.unit_price)||0))
        })
        budgetsByEvent.set(row.event_id, arr)
      }
    }
    return { evs, expensesByEvent, budgetsByEvent }
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

      const { evs, expensesByEvent, budgetsByEvent } = await fetchEventsData(filters)
      if (evs.length === 0) throw new Error('لا توجد أحداث للتصدير وفق الفلاتر')

      const wb = new ExcelJS.Workbook()
      const usedNames = new Set<string>()
      const headerFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF59D' } }
      const thinBorder = {
        top: { style: 'thin' as const, color: { argb: 'FFE0E0E0' } },
        left: { style: 'thin' as const, color: { argb: 'FFE0E0E0' } },
        bottom: { style: 'thin' as const, color: { argb: 'FFE0E0E0' } },
        right: { style: 'thin' as const, color: { argb: 'FFE0E0E0' } },
      }

      function addHeader(ws: ExcelJS.Worksheet, headers: string[], widths: number[], numFmts: (string|undefined)[]) {
        ws.views = [{ state: 'frozen', ySplit: 1 }]
        ws.columns = headers.map((_, i) => ({
          key: `c${i}`, width: widths[i] || 14, style: numFmts[i] ? { numFmt: numFmts[i] } : {}
        }))
        const hr = ws.addRow(headers)
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

      // ترتيب الأحداث
      evs.sort((a,b) => {
        const ad = a.event_date || '', bd = b.event_date || ''
        if (ad !== bd) return ad.localeCompare(bd)
        return (a.name||'').localeCompare(b.name||'', 'ar')
      })

      for (const ev of evs) {
        const datePart = (ev.event_date || '').slice(0,10)

        // Sheet المصروفات
        {
          const base = `${datePart} — ${ev.name || 'Event'}`
          const wsName = ensureUniqueName(base, usedNames)
          const ws = wb.addWorksheet(wsName)

          addHeader(
            ws,
            ['Expense Date','Item','Qty','Unit Price','Line Total'],
            [14, 32, 10, 14, 16],
            ['yyyy-mm-dd', undefined, '#,##0.00', '#,##0.00', '#,##0.00']
          )

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
              Number(l.total || ((Number(l.qty)||0)*(Number(l.unit_price)||0))),
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

        // Sheet الميزانية
        {
          const base = `Budget — ${datePart} — ${ev.name || 'Event'}`
          const wsName = ensureUniqueName(base, usedNames)
          const ws = wb.addWorksheet(wsName)

          addHeader(
            ws,
            ['Item (Budget)', 'Qty', 'Unit Price', 'Line Total'],
            [32, 12, 14, 16],
            [undefined, '#,##0.00', '#,##0.00', '#,##0.00']
          )

          const rows = (budgetsByEvent.get(ev.id) || []).slice()
          let sum = 0
          for (const b of rows) {
            const line = Number(b.line_total) || ((Number(b.qty)||0) * (Number(b.unit_price)||0))
            sum += line
            addDataRow(ws, [
              b.item_name || '',
              Number(b.qty || 0),
              Number(b.unit_price || 0),
              line
            ])
          }

          if (rows.length === 0) {
            addDataRow(ws, ['No budget','','',''])
          } else {
            const totalRow = addDataRow(ws, ['TOTAL', '', '', sum])
            totalRow.font = { bold: true }
          }
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

      {/* الهيدر */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold">تسجيل المصروفات العامة</h1>
        {selectedId && (
          <button
            className="text-rose-600 hover:underline disabled:opacity-50 w-full sm:w-auto text-start sm:text-right"
            onClick={softDeleteEvent}
            disabled={deletingEvent}
          >
            {deletingEvent ? 'جارِ الحذف...' : 'حذف الحدث'}
          </button>
        )}
      </div>

      {/* Events selector + create */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm">الحدث</label>
          <select
            className="border rounded-xl p-2 w-full min-w-0 cursor-pointer"
            value={selectedId}
            onChange={e=>setSelectedId(e.target.value)}
          >
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>
                {ev.event_date?.slice(0,10)} — {ev.name}
              </option>
            ))}
          </select>
          <div className="text-xs text-gray-500">اختر حدثًا لاستعراض/تعديل ميزانيته ومصروفاته.</div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">إنشاء حدث جديد</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 items-end">
            <div className="sm:col-span-2 md:col-span-2">
              <label className="text-xs">اسم الحدث</label>
              <input className="border rounded-xl p-2 w-full min-w-0" value={evName} onChange={e=>setEvName(e.target.value)} placeholder="مثلاً: رحلة الفيوم" />
            </div>
            <div>
              <label className="text-xs">تاريخ الحدث</label>
              <input type="date" className="border rounded-xl p-2 w-full min-w-0" value={evDate} onChange={e=>setEvDate(e.target.value)} />
            </div>
            <div className="sm:col-span-2 md:col-span-4">
              <label className="text-xs">ملاحظات</label>
              <input className="border rounded-xl p-2 w-full min-w-0" value={evNotes} onChange={e=>setEvNotes(e.target.value)} placeholder="اختياري" />
            </div>
            <div className="sm:col-span-2 md:col-span-4 flex justify-end">
              <LoadingButton loading={savingEvent} onClick={createEvent}>إنشاء حدث</LoadingButton>
            </div>
          </div>
        </div>
      </section>

      {/* Summary cards */}
      {selectedId && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl border">
            <div className="text-xs text-gray-500">إجمالي الميزانية</div>
            <div className="text-2xl font-bold">{egp(budgetTotal)}</div>
          </div>
          <div className="p-4 rounded-2xl border">
            <div className="text-xs text-gray-500">إجمالي المصروف</div>
            <div className="text-2xl font-bold">{egp(totalSpent)}</div>
          </div>
          <div className={`p-4 rounded-2xl border ${remaining < 0 ? 'border-rose-400 bg-rose-50' : remaining <= budgetTotal*0.25 ? 'border-amber-400 bg-amber-50' : ''}`}>
            <div className="text-xs text-gray-500">المتبقي (ميزانية - مصروف)</div>
            <div className="text-2xl font-bold">{egp(remaining)}</div>
            {remaining < 0 && <div className="text-xs text-rose-700 mt-1">تجاوزت الميزانية</div>}
            {remaining >= 0 && budgetTotal > 0 && remaining <= 0.25*budgetTotal && <div className="text-xs text-amber-700 mt-1">تحذير: أقل من 25%</div>}
          </div>
        </div>
      )}

      {/* Budget section */}
      {selectedId && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">بنود الميزانية</h2>

          {/* إضافة بند ميزانية */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 items-end">
            <div className="sm:col-span-2">
              <label className="text-sm">العنصر</label>
              <input className="border rounded-xl p-2 w-full min-w-0" value={bTitle} onChange={e=>setBTitle(e.target.value)} placeholder="مثلاً: مشترك الطلبة" />
            </div>
            <div>
              <label className="text-sm">العدد</label>
              <input type="number" min={1} className="border rounded-xl p-2 w-full min-w-0" value={bQty} onChange={e=>setBQty(e.target.value as any)} />
            </div>
            <div>
              <label className="text-sm">سعر الفرد</label>
              <input type="number" min={0} step={0.01} className="border rounded-xl p-2 w-full min-w-0" value={bUnit} onChange={e=>setBUnit(e.target.value as any)} />
            </div>
            <div className="sm:col-span-2 md:col-span-5 flex justify-end">
              <LoadingButton loading={savingBudget} onClick={addBudgetLine}>إضافة بند ميزانية</LoadingButton>
            </div>
          </div>

          {/* جدول الميزانية */}
          <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs sm:text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-start">العنصر</th>
                  <th className="p-2 text-center whitespace-nowrap">العدد</th>
                  <th className="p-2 text-center whitespace-nowrap">سعر الفرد</th>
                  <th className="p-2 text-center whitespace-nowrap">الإجمالي</th>
                  <th className="p-2 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {budgets.map(b => {
                  const isEdit = editingBudgetId === b.id
                  const calcTotal = Number(b.qty||0) * Number(b.unit_price||0)
                  return (
                    <tr key={b.id} className="border-t">
                      <td className="p-2">
                        {isEdit ? (
                          <input className="border rounded p-1 w-full min-w-0" value={editBTitle} onChange={e=>setEditBTitle(e.target.value)} />
                        ) : sanitizeForUI(b.item_name)}
                      </td>
                      <td className="p-2 text-center">
                        {isEdit ? (
                          <input type="number" min={1} className="border rounded p-1 w-full sm:w-24 text-center"
                                 value={editBQty} onChange={e=>setEditBQty(e.target.value as any)} />
                        ) : Number(b.qty)}
                      </td>
                      <td className="p-2 text-center">
                        {isEdit ? (
                          <input type="number" min={0} step={0.01} className="border rounded p-1 w-full sm:w-28 text-center"
                                 value={editBUnit} onChange={e=>setEditBUnit(e.target.value as any)} />
                        ) : egp(Number(b.unit_price || 0))}
                      </td>
                      <td className="p-2 text-center">{egp(Number(b.line_total || calcTotal))}</td>
                      <td className="p-2 text-center">
                        {!isEdit ? (
                          <div className="flex gap-2 justify-center">
                            <button className="text-blue-600 hover:underline" onClick={()=>startEditBudgetRow(b)}>تعديل</button>
                            <button
                              className="text-rose-600 hover:underline disabled:opacity-50"
                              onClick={()=>deleteBudgetRow(b.id)}
                              disabled={deletingBudgetId === b.id}
                            >
                              {deletingBudgetId === b.id ? 'جارِ الحذف...' : 'حذف'}
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2 justify-center">
                            <button className="text-green-600 hover:underline disabled:opacity-50" onClick={saveEditBudgetRow} disabled={savingBudget}>حفظ</button>
                            <button className="text-gray-600 hover:underline" onClick={()=>setEditingBudgetId('')}>إلغاء</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {budgets.length === 0 && (
                  <tr>
                    <td className="p-3 text-center text-gray-500" colSpan={5}>لا توجد بنود ميزانية لهذا الحدث</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Add expense */}
      {selectedId && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">إضافة مصروف للحدث</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 items-end">
            <div>
              <label className="text-sm">التاريخ</label>
              <input type="date" className="border rounded-xl p-2 w-full min-w-0" value={exDate} onChange={e=>setExDate(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm">البند</label>
              <input className="border rounded-xl p-2 w-full min-w-0" value={exName} onChange={e=>setExName(e.target.value)} placeholder="مثلاً: إيجار قاعة" />
            </div>
            <div>
              <label className="text-sm">العدد</label>
              <input type="number" min={1} className="border rounded-xl p-2 w-full min-w-0" value={exQty} onChange={e=>setExQty(e.target.value as any)} />
            </div>
            <div>
              <label className="text-sm">سعر القطعة</label>
              <input type="number" min={0} step={0.01} className="border rounded-xl p-2 w-full min-w-0" value={exUnit} onChange={e=>setExUnit(e.target.value as any)} />
            </div>
            <div className="sm:col-span-2 md:col-span-5 flex justify-end">
              <LoadingButton loading={savingExp} onClick={addExpense}>إضافة</LoadingButton>
            </div>
          </div>
        </section>
      )}

      {/* Expenses table */}
      {selectedId && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">مصروفات الحدث</h2>
          <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
            <table className="w-full min-w-[820px] text-xs sm:text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-start whitespace-nowrap">التاريخ</th>
                  <th className="p-2 text-start">البند</th>
                  <th className="p-2 text-center whitespace-nowrap">العدد</th>
                  <th className="p-2 text-center whitespace-nowrap">سعر القطعة</th>
                  <th className="p-2 text-center whitespace-nowrap">الإجمالي</th>
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
                          <input type="date" className="border rounded p-1 w-full sm:w-auto min-w-0" value={editDate} onChange={e=>setEditDate(e.target.value)} />
                        ) : sanitizeForUI(x.expense_date)}
                      </td>
                      <td className="p-2">
                        {isEdit ? (
                          <input className="border rounded p-1 w-full min-w-0" value={editName} onChange={e=>setEditName(e.target.value)} />
                        ) : sanitizeForUI(x.item_name)}
                      </td>
                      <td className="p-2 text-center">
                        {isEdit ? (
                          <input type="number" min={1} className="border rounded p-1 w-full sm:w-24 text-center" value={editQty} onChange={e=>setEditQty(e.target.value as any)} />
                        ) : x.qty}
                      </td>
                      <td className="p-2 text-center">
                        {isEdit ? (
                          <input type="number" min={0} step={0.01} className="border rounded p-1 w-full sm:w-28 text-center" value={editUnit} onChange={e=>setEditUnit(e.target.value as any)} />
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
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 items-end">
            <div>
              <label className="text-sm">وضع التصدير</label>
              <select
                className="border rounded-xl p-2 w-full min-w-0"
                value={exportMode}
                onChange={e=>setExportMode(e.target.value as any)}
              >
                <option value="one">حدث محدد (مصروفات + ميزانية)</option>
                <option value="year">سنة كاملة — ورقتان لكل حدث</option>
              </select>
            </div>

            {exportMode === 'one' && (
              <div className="md:col-span-2">
                <label className="text-sm">الحدث</label>
                <select
                  className="border rounded-xl p-2 w-full min-w-0"
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
                  className="border rounded-xl p-2 w-full min-w-0"
                  value={exportYear}
                  onChange={e=>setExportYear(Number(e.target.value))}
                >
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            )}

            <div className="md:col-span-1 text-end">
              <LoadingButton className="w-full sm:w-auto" loading={exporting} onClick={handleExport}>
                {exporting ? 'جارِ التحضير...' : 'تصدير XLSX'}
              </LoadingButton>
            </div>
          </div>

          <div className="text-xs text-gray-500">
            * يتم إنشاء ورقتين لكل حدث: واحدة للمصروفات وواحدة لبنود الميزانية، مع صف إجمالي في النهاية.
          </div>
        </section>
      )}
    </div>
  )
}
