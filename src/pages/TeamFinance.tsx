import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ui/Toaster'
import { LoadingButton } from '../components/ui/LoadingButton'
import { PageLoader } from '../components/ui/PageLoader'
import { useRoleGate } from '../hooks/useRoleGate'
import { useAuth } from '../components/AuthProvider'
import ExcelJS from 'exceljs'

type Team = { id: string; name: string }
type Term = { id: string; name: string; year: number; start_date?: string | null; end_date?: string | null }
type Expense = { id: string; expense_date: string; item_name: string; qty: number; unit_price: number; total: number; is_delivered: boolean }
type TermDateRow = { id: string; meeting_date: string }

export default function TeamFinance() {
  const toast = useToast()
  const gate = useRoleGate()
  const { roles } = useAuth()

  const isAdmin = roles.some(r => r.role_slug === 'admin')
  const isGlobalFinance = roles.some(r => r.role_slug === 'responsable_finance' && (r.team_id === null || r.team_id === undefined))

  const [teams, setTeams] = useState<Team[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [teamId, setTeamId] = useState<string>('')
  const [termId, setTermId] = useState<string>('')

  // تواريخ الترم
  const [termDates, setTermDates] = useState<TermDateRow[]>([])
  const hasTermDates = termDates.length > 0

  const [budget, setBudget] = useState<number | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [savingExp, setSavingExp] = useState(false)

  // Expense form
  const [exDate, setExDate] = useState<string>('')                 // التاريخ المحفوظ
  const [useCustomDate, setUseCustomDate] = useState<boolean>(false)
  const [exName, setExName] = useState<string>('')
  const [exQty, setExQty] = useState<number | ''>('')
  const [exUnit, setExUnit] = useState<number | ''>('')
  const [exDelivered, setExDelivered] = useState<boolean>(false)    // ⬅️ جديد: حالة التسليم وقت الإدخال

  // Export state
  const [exporting, setExporting] = useState(false)
  type ExportMode = 'all' | 'term' | 'year'
  const [exportMode, setExportMode] = useState<ExportMode>('term')
  const years = useMemo(() => Array.from(new Set(terms.map(t => t.year))).sort((a,b)=>a-b), [terms])
  const [exportYear, setExportYear] = useState<number | ''>('')
  const [exportTeamScope, setExportTeamScope] = useState<'all'|'one'>('all')
  const [exportTeamId, setExportTeamId] = useState<string>('')

  const egp = (v: number) => new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(v)

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
  /* ==================================================== */

  // ===== Helpers: term range + dates =====
  const termMeta = useMemo(() => terms.find(t => t.id === termId) || null, [terms, termId])
  const termMin = termMeta?.start_date || ''
  const termMax = termMeta?.end_date || ''
  const clampToTerm = (d: string) => {
    if (!d) return d
    if (!termMin && !termMax) return d
    const asDate = new Date(d)
    if (termMin && asDate < new Date(termMin)) return termMin
    if (termMax && asDate > new Date(termMax)) return termMax
    return d
  }
  const fmtDate = (dt: Date) => {
    const pad = (n:number)=>String(n).padStart(2,'0')
    return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`
  }

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const { data: tm, error: te } = await supabase
        .from('terms').select('id,name,year,start_date,end_date')
        .order('year', { ascending: false })
        .order('name', { ascending: true })
      if (te) throw te
      setTerms((tm as any) ?? [])
      if (tm && tm.length) {
        setTermId(tm[0].id)
        setExportYear(tm[0].year)
      }

      let myTeamId: string | null = null
      const { data: meRow, error: meErr } = await supabase.from('v_me').select('team_id').maybeSingle()
      if (meErr) throw meErr
      if (meRow?.team_id) myTeamId = meRow.team_id

      if (isAdmin || isGlobalFinance) {
        const { data: ts, error: tse } = await supabase.from('teams').select('id,name').order('name')
        if (tse) throw tse
        setTeams((ts as any) ?? [])
        if (myTeamId && ts?.some(t => t.id === myTeamId)) setTeamId(myTeamId)
        else if (ts && ts.length) setTeamId(ts[0].id)
        setExportTeamId(myTeamId || (ts?.[0]?.id ?? ''))
      } else {
        if (!myTeamId) throw new Error('لا يوجد فريق مرتبط بحسابك')
        setTeamId(myTeamId)
        const { data: tName } = await supabase.from('teams').select('id,name').eq('id', myTeamId)
        setTeams((tName as any) ?? [])
        setExportTeamId(myTeamId)
      }

      const today = new Date()
      setExDate(fmtDate(today))
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }

  // حمّل تواريخ الترم المختار + اضبط exDate
  useEffect(() => { if (termId) loadTermDates(termId) }, [termId])
  async function loadTermDates(tid: string) {
    try {
      const { data, error } = await supabase
        .from('term_meeting_dates')
        .select('id, meeting_date')
        .eq('term_id', tid)
        .order('meeting_date', { ascending: true })
      if (error) throw error
      const list = (data as any as TermDateRow[]) ?? []
      setTermDates(list)

      if (list.length > 0) {
        setUseCustomDate(false)
        setExDate(list[0].meeting_date)
      } else {
        setUseCustomDate(true)
        if (termMeta?.start_date) setExDate(termMeta.start_date)
        else setExDate(prev => clampToTerm(prev) || prev)
      }
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل تواريخ الترم')
    }
  }

  useEffect(() => { if (teamId && termId) refreshData() }, [teamId, termId])
  async function refreshData() {
    setLoading(true)
    try {
      const [{ data: bRow, error: bErr }, { data: expRows, error: eErr }] = await Promise.all([
        supabase.from('team_budgets').select('amount_total').eq('team_id', teamId).eq('term_id', termId).is('soft_deleted_at', null).maybeSingle(),
        supabase.from('expenses').select('id, expense_date, item_name, qty, unit_price, total, is_delivered').eq('team_id', teamId).eq('term_id', termId).is('soft_deleted_at', null).order('expense_date', { ascending: false })
      ])
      if (bErr) throw bErr
      if (eErr) throw eErr
      setBudget(bRow?.amount_total ?? null)

      const fixed = (expRows as any[] ?? []).map(row => ({
        ...row,
        expense_date: sanitizeForUI(row.expense_date),
        item_name: sanitizeForUI(row.item_name),
        is_delivered: !!row.is_delivered
      }))
      setExpenses(fixed as Expense[])
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الميزانية/المصروفات')
    } finally {
      setLoading(false)
    }
  }

  const spent = useMemo(() => expenses.reduce((s, x) => s + (Number(x.total) || 0), 0), [expenses])
  const remaining = useMemo(() => (budget ?? 0) - spent, [budget, spent])
  const status: 'ok' | 'low' | 'depleted' = useMemo(() => {
    if (!budget || budget <= 0) return spent > 0 ? 'depleted' : 'ok'
    if (remaining <= 0) return 'depleted'
    if (remaining <= 0.25 * budget) return 'low'
    return 'ok'
  }, [budget, remaining, spent])

  // تاريخ المصروف: Select من تواريخ الترم أو input داخل نطاق الترم
  function onSelectDateChange(v: string) {
    if (v === '__custom__') {
      setUseCustomDate(true)
      setExDate(prev => clampToTerm(prev) || prev)
    } else {
      setUseCustomDate(false)
      setExDate(v)
    }
  }

  async function addExpense() {
    if (!teamId || !termId) return toast.error('اختر الفريق والترم')
    if (!gate.canWriteExpense(teamId)) { toast.error('ليست لديك صلاحية إضافة مصروف'); return }
    const q = Number(exQty); const u = Number(exUnit)
    if (!isFinite(q) || q <= 0) return toast.error('العدد غير صالح')
    if (!isFinite(u) || u < 0) return toast.error('سعر القطعة غير صالح')
    if (!exName.trim()) return toast.error('ادخل اسم المنتج')
    if (!exDate) return toast.error('اختر التاريخ')

    const clamped = clampToTerm(exDate)
    if ((termMin || termMax) && clamped !== exDate) {
      return toast.error('التاريخ خارج نطاق الترم المحدد')
    }

    setSavingExp(true)
    try {
      const cleanName = stripMarks(exName.trim())
      const { error } = await supabase.from('expenses').insert({
        team_id: teamId, term_id: termId,
        expense_date: stripMarks(exDate),
        item_name: cleanName,
        qty: q, unit_price: u,
        is_delivered: !!exDelivered // ⬅️ يسجّل حسب اختيار المستخدم
      })
      if (error) throw error
      toast.success('تم إضافة المصروف')
      setExName(''); setExQty(''); setExUnit(''); setExDelivered(false)
      await refreshData()
    } catch (e:any) {
      toast.error(e.message || 'تعذر إضافة المصروف')
    } finally {
      setSavingExp(false)
    }
  }

  /* =============================== Export (كما هو) =============================== */

  async function fetchFinanceData(filters: {
    termIds?: string[]
    year?: number
    teamIds?: string[]
  }) {
    const [teamsRes, termsRes] = await Promise.all([
      supabase.from('teams').select('id,name'),
      supabase.from('terms').select('id,name,year')
    ])
    if (teamsRes.error) throw teamsRes.error
    if (termsRes.error) throw termsRes.error
    const teamsMap = new Map<string,string>((teamsRes.data ?? []).map(t => [t.id, t.name]))
    const termsArr = (termsRes.data ?? []) as Term[]
    const termsMap = new Map<string,{name:string, year:number}>(
      termsArr.map(t => [t.id, { name: t.name, year: t.year }])
    )

    let termFilterIds: string[] | undefined = filters.termIds
    if (filters.year && !termFilterIds) {
      const yearTerms = termsArr.filter(t => t.year === filters.year).map(t => t.id)
      termFilterIds = yearTerms
    }

    let bq = supabase.from('team_budgets').select('team_id, term_id, amount_total').is('soft_deleted_at', null)
    if (termFilterIds?.length) bq = bq.in('term_id', termFilterIds)
    if (filters.teamIds?.length) bq = bq.in('team_id', filters.teamIds)
    const { data: budgets, error: bErr } = await bq
    if (bErr) throw bErr

    let eq = supabase.from('expenses')
      .select('team_id, term_id, expense_date, item_name, qty, unit_price, total')
      .is('soft_deleted_at', null)
    if (termFilterIds?.length) eq = eq.in('term_id', termFilterIds)
    if (filters.teamIds?.length) eq = eq.in('team_id', filters.teamIds)
    const { data: exps, error: eErr } = await eq
    if (eErr) throw eErr

    return { teamsMap, termsMap, termsArr, budgets: budgets ?? [], exps: exps ?? [] }
  }

  function parseDate(d?: string) {
    if (!d) return ''
    const parts = String(d).slice(0,10).split('-').map(Number)
    if (parts.length === 3 && !parts.some(isNaN)) return new Date(parts[0], parts[1]-1, parts[2])
    return d as any
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

  async function handleExport() {
    if (!(isAdmin || isGlobalFinance)) return
    setExporting(true)
    try {
      let filters: { termIds?: string[]; year?: number; teamIds?: string[] } = {}
      let filename = 'finance.xlsx'

      if (exportMode === 'all') {
        filename = `finance_all_terms.xlsx`
      } else if (exportMode === 'term') {
        if (!termId) throw new Error('اختر الترم أولاً')
        filters.termIds = [termId]
        filename = `finance_term_${termId}.xlsx`
      } else if (exportMode === 'year') {
        if (!exportYear) throw new Error('اختر السنة')
        filters.year = Number(exportYear)
        if (exportTeamScope === 'one' && exportTeamId) {
          filters.teamIds = [exportTeamId]
          filename = `finance_year_${exportYear}_team_${exportTeamId}.xlsx`
        } else {
          filename = `finance_year_${exportYear}.xlsx`
        }
      }

      const { teamsMap, termsMap, termsArr, budgets, exps } = await fetchFinanceData(filters)
      type Key = string
      const keyOf = (t:string, r:string) => `${t}|${r}`
      const budgetMap = new Map<Key, number>()
      const expensesMap = new Map<Key, Expense[]>()

      budgets.forEach((b:any) => {
        const k = keyOf(b.team_id, b.term_id)
        budgetMap.set(k, Number(b.amount_total) || 0)
      })
      exps.forEach((e:any) => {
        const k = keyOf(e.team_id, e.term_id)
        const arr = expensesMap.get(k) || []
        arr.push({
          id: '',
          expense_date: sanitizeForUI(e.expense_date),
          item_name: sanitizeForUI(e.item_name),
          qty: Number(e.qty) || 0,
          unit_price: Number(e.unit_price) || 0,
          total: Number(e.total) || (Number(e.qty||0) * Number(e.unit_price||0)),
          is_delivered: true
        })
        expensesMap.set(k, arr)
      })

      let termIdsSet = new Set<string>()
      if (filters.termIds?.length) {
        filters.termIds.forEach(id => termIdsSet.add(id))
      } else if (filters.year) {
        termsArr.filter(t => t.year === filters.year).forEach(t => termIdsSet.add(t.id))
      } else {
        budgets.forEach((b:any)=> termIdsSet.add(b.term_id))
        exps.forEach((e:any)=> termIdsSet.add(e.term_id))
      }
      if (termIdsSet.size === 0) termsArr.forEach(t => termIdsSet.add(t.id))

      const wb = new ExcelJS.Workbook()
      const usedNames = new Set<string>()

      const headerFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF59D' } }
      const thinBorder: ExcelJS.Borders = {
        top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        diagonal: {},
      }
      const teamFills = ['FFF8F9FA', 'FFF3F4F6']

      function addHeader(ws: ExcelJS.Worksheet) {
        ws.views = [{ state: 'frozen', ySplit: 1 }]
        ws.columns = [
          { key: 'team', width: 24 },
          { key: 'budget', width: 14, style: { numFmt: '#,##0.00' } },
          { key: 'spent', width: 14, style: { numFmt: '#,##0.00' } },
          { key: 'remaining', width: 14, style: { numFmt: '#,##0.00' } },
          { key: 'expdate', width: 14, style: { numFmt: 'yyyy-mm-dd' } },
          { key: 'item', width: 28 },
          { key: 'qty', width: 8, style: { numFmt: '#,##0' } },
          { key: 'unit', width: 12, style: { numFmt: '#,##0.00' } },
          { key: 'line', width: 12, style: { numFmt: '#,##0.00' } },
        ]
        const headers = ['Team','Budget(EGP)','Spent(EGP)','Remaining(EGP)','Expense Date','Item','Qty','Unit Price','Total']
        const hr = ws.addRow(headers)
        hr.font = { bold: true }
        hr.alignment = { vertical: 'middle' }
        hr.height = 22
        hr.eachCell(cell => {
          cell.fill = headerFill
          cell.border = thinBorder
        })
      }
      function addDataRow(ws: ExcelJS.Worksheet, values: any[], fillArgb?: string, withBorder = true) {
        const r = ws.addRow(values)
        r.eachCell(cell => {
          if (fillArgb) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } }
          if (withBorder) cell.border = thinBorder
        })
        return r
      }

      const termIds = Array.from(termIdsSet)
      termIds.sort((a,b) => {
        const ta = termsMap.get(a), tb = termsMap.get(b)
        if (!ta || !tb) return 0
        if (ta.year !== tb.year) return ta.year - tb.year
        return (ta.name || '').localeCompare(tb.name || '', 'ar')
      })

      for (const rId of termIds) {
        const tMeta = termsMap.get(rId)
        if (!tMeta) continue
        const baseName = `${tMeta.year} — ${tMeta.name}`
        const sheetName = ensureUniqueName(baseName, usedNames)
        const ws = wb.addWorksheet(sheetName)
        addHeader(ws)

        const teamIdsSet = new Set<string>()
        budgets.filter((b:any)=> b.term_id === rId).forEach(b => teamIdsSet.add(b.team_id))
        exps.filter((e:any)=> e.term_id === rId).forEach(e => teamIdsSet.add(e.team_id))
        const teamIds = Array.from(teamIdsSet).sort((a,b)=>{
          const na = (teamsMap.get(a) || a)
          const nb = (teamsMap.get(b) || b)
          return na.localeCompare(nb, 'ar')
        })

        let teamAlt = 0
        for (const tId of teamIds) {
          const teamName = teamsMap.get(tId) || tId
          const k = `${tId}|${rId}`
          const lines = (expensesMap.get(k) || []).sort((a,b)=> (a.expense_date||'').localeCompare(b.expense_date||''))

          const budgetVal = Number(budgetMap.get(k) || 0)
          const spentVal = lines.reduce((s, x) => s + (Number(x.total)||0), 0)
          const remainingVal = budgetVal - spentVal

          const fill = teamFills[teamAlt % teamFills.length]
          teamAlt++

          addDataRow(ws, [
            teamName,
            budgetVal,
            spentVal,
            remainingVal,
            '', '', '', '', ''
          ], fill)

          for (const l of lines) {
            const d = parseDate(l.expense_date)
            const row = addDataRow(ws, [
              '',
              '', '', '',
              d instanceof Date ? d : (l.expense_date || ''),
              l.item_name || '',
              Number(l.qty||0),
              Number(l.unit_price||0),
              Number(l.total|| (Number(l.qty||0)*Number(l.unit_price||0)))
            ], fill)
            const cExpDate = row.getCell(5)
            if (d instanceof Date) cExpDate.numFmt = 'yyyy-mm-dd'
            row.getCell(7).numFmt = '#,##0'
            row.getCell(8).numFmt = '#,##0.00'
            row.getCell(9).numFmt = '#,##0.00'
          }

          ws.addRow(['','','','','','','','',''])
        }

        if (teamIds.length === 0) {
          addDataRow(ws, ['No data','','','','','','','',''])
        }
      }

      const safe = filename.toLowerCase().endsWith('.xlsx') ? filename : filename.replace(/\.csv$/i,'') + '.xlsx'
      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = safe
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

  /* ===== تعديل/حذف/تبديل التسليم ===== */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ expense_date: string; item_name: string; qty: number | ''; unit_price: number | '' } | null>(null)
  const [savingEditId, setSavingEditId] = useState<string | null>(null)
  const [deletingId,   setDeletingId]   = useState<string | null>(null)
  const [togglingId,   setTogglingId]   = useState<string | null>(null)

  const canModify = (teamId && gate.canWriteExpense(teamId)) || isAdmin || isGlobalFinance

  function startEditRow(x: Expense) {
    setEditingId(x.id)
    setEditDraft({
      expense_date: (x.expense_date || '').slice(0,10),
      item_name: x.item_name || '',
      qty: Number(x.qty) || 0,
      unit_price: Number(x.unit_price) || 0
    })
  }
  function cancelEditRow() {
    setEditingId(null)
    setEditDraft(null)
  }

  async function saveEditRow(id: string) {
    if (!editDraft) return
    const q = Number(editDraft.qty)
    const u = Number(editDraft.unit_price)
    const d = (editDraft.expense_date || '').trim()
    if (!isFinite(q) || q <= 0) return toast.error('العدد غير صالح')
    if (!isFinite(u) || u < 0) return toast.error('سعر القطعة غير صالح')
    if (!d) return toast.error('اختر التاريخ')
    if (!editDraft.item_name.trim()) return toast.error('ادخل اسم المنتج')

    const clamped = clampToTerm(d)
    if ((termMin || termMax) && clamped !== d) {
      return toast.error('التاريخ خارج نطاق الترم المحدد')
    }

    setSavingEditId(id)
    try {
      const payload = {
        expense_date: stripMarks(d),
        item_name: stripMarks(editDraft.item_name.trim()),
        qty: q,
        unit_price: u,
        total: q * u
      }
      const { error } = await supabase.from('expenses').update(payload).eq('id', id)
      if (error) throw error
      toast.success('تم حفظ التعديل')
      cancelEditRow()
      await refreshData()
    } catch (e:any) {
      toast.error(e.message || 'تعذر حفظ التعديل')
    } finally {
      setSavingEditId(null)
    }
  }

  async function deleteRow(id: string) {
    if (!canModify) return
    if (!confirm('هل أنت متأكد من حذف هذا المصروف؟')) return
    setDeletingId(id)
    try {
      const { error } = await supabase.from('expenses')
        .update({ soft_deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
      toast.success('تم حذف المصروف')
      await refreshData()
    } catch (e:any) {
      toast.error(e.message || 'تعذر حذف المصروف')
    } finally {
      setDeletingId(null)
    }
  }

  async function toggleDelivered(id: string, to: boolean) {
    if (!canModify) return
    setTogglingId(id)
    try {
      const { error } = await supabase.from('expenses').update({ is_delivered: to }).eq('id', id)
      if (error) throw error
      await refreshData()
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحديث حالة التسليم')
    } finally {
      setTogglingId(null)
    }
  }
  /* ============================================================================ */

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري تحميل البيانات..." />
      <h1 className="text-xl font-bold">الميزانية (الفريق) — تسجيل المصروفات</h1>

      {/* فلاتر أعلى الصفحة */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 items-end">
        <div className={`${(isAdmin || isGlobalFinance) ? '' : 'opacity-60 pointer-events-none'}`}>
          <label className="text-sm">الفريق</label>
          <select className="border rounded-xl p-2 w-full min-w-0 cursor-pointer" value={teamId} onChange={e=>setTeamId(e.target.value)}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {!(isAdmin || isGlobalFinance) && <div className="text-xs text-gray-500">لا يمكن تغيير الفريق إلا للأدمن/المسؤول العام</div>}
        </div>

        <div>
          <label className="text-sm">الترم</label>
          <select className="border rounded-xl p-2 w-full min-w-0 cursor-pointer" value={termId} onChange={e=>setTermId(e.target.value)}>
            {terms.map(t => <option key={t.id} value={t.id}>{t.year} — {t.name}</option>)}
          </select>
          {termMeta?.start_date && termMeta?.end_date && (
            <div className="text-[11px] text-gray-500 mt-1">
              نطاق الترم: {termMeta.start_date} → {termMeta.end_date}
            </div>
          )}
        </div>
      </div>

      {/* بطاقات الميزانية */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-4 rounded-2xl border">
          <div className="text-xs text-gray-500">ميزانية الترم</div>
          <div className="text-2xl font-bold">{budget !== null ? egp(budget) : '—'}</div>
        </div>
        <div className="p-4 rounded-2xl border">
          <div className="text-xs text-gray-500">المصروف</div>
          <div className="text-2xl font-bold">{egp(spent)}</div>
        </div>
        <div className={`p-4 rounded-2xl border ${status==='low'?'border-amber-400 bg-amber-50': status==='depleted'?'border-rose-400 bg-rose-50':''}`}>
          <div className="text-xs text-gray-500">المتبقي</div>
          <div className="text-2xl font-bold">{egp(remaining)}</div>
          {status==='low' && <div className="text-xs text-amber-700 mt-1">تحذير: أقل من 25%</div>}
          {status==='depleted' && <div className="text-xs text-rose-700 mt-1">انتهت الميزانية</div>}
        </div>
      </div>

      {/* Form */}
      {gate.canWriteExpense(teamId) && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">إضافة مصروف</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-2 items-end">
            <div className="md:col-span-2">
              <label className="text-sm">التاريخ</label>
              {hasTermDates && !useCustomDate ? (
                <>
                  <select
                    className="border rounded-xl p-2 w-full min-w-0 cursor-pointer"
                    value={exDate}
                    onChange={e=>onSelectDateChange(e.target.value)}
                  >
                    {termDates.map(d => (
                      <option key={d.id} value={d.meeting_date}>{d.meeting_date}</option>
                    ))}
                    <option value="__custom__">— تاريخ آخر (داخل نطاق الترم) —</option>
                  </select>
                  <div className="text-[11px] text-gray-500 mt-1">اختر تاريخًا من جدول الترم أو اختر “تاريخ آخر”.</div>
                </>
              ) : (
                <>
                  <input
                    type="date"
                    className="border rounded-xl p-2 w-full min-w-0"
                    value={exDate}
                    min={termMin || undefined}
                    max={termMax || undefined}
                    onChange={e=>setExDate(e.target.value)}
                  />
                  {hasTermDates && (
                    <button
                      type="button"
                      className="text-[12px] underline mt-1"
                      onClick={()=>{
                        if (termDates.length) { setUseCustomDate(false); setExDate(termDates[0].meeting_date) }
                      }}
                    >
                      الرجوع لاختيار من جدول الترم
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="sm:col-span-2 md:col-span-2">
              <label className="text-sm">اسم المنتج</label>
              <input
                className="border rounded-xl p-2 w-full min-w-0"
                value={exName}
                onChange={e=>setExName(e.target.value)}
                placeholder="مثلاً: أدوات..."
              />
            </div>

            <div>
              <label className="text-sm">العدد</label>
              <input type="number" min={1} className="border rounded-xl p-2 w-full min-w-0" value={exQty} onChange={e=>setExQty(e.target.value as any)} />
            </div>

            <div>
              <label className="text-sm">سعر القطعة</label>
              <input type="number" min={0} step={0.01} className="border rounded-xl p-2 w-full min-w-0" value={exUnit} onChange={e=>setExUnit(e.target.value as any)} />
            </div>

            {/* جديد: تمّ التسليم؟ */}
            <div className="md:col-span-2">
              <label className="text-sm">تمّ التسليم؟</label>
              <div className="flex items-center gap-2 p-2 border rounded-xl">
                <input
                  type="checkbox"
                  checked={exDelivered}
                  onChange={e=>setExDelivered(e.target.checked)}
                />
                <span className="text-sm text-gray-700">مُسلّم</span>
              </div>
              <div className="text-[11px] text-gray-500 mt-1">يُمكن تعديلها لاحقًا من الجدول.</div>
            </div>

            <div className="sm:col-span-2 md:col-span-6 flex justify-end">
              <LoadingButton loading={savingExp} onClick={addExpense}>إضافة مصروف</LoadingButton>
            </div>
          </div>
        </section>
      )}

      {/* Export */}
      {(isAdmin || isGlobalFinance) && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">تصدير Excel (XLSX)</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 items-end">
            <div>
              <label className="text-sm">محتوى الExcel</label>
              <select className="border rounded-xl p-2 w-full min-w-0" value={exportMode} onChange={e=>setExportMode(e.target.value as ExportMode)}>
                <option value="term">الترم الحالي — شيت للترم</option>
                <option value="year">سنة معيّنة — شيت لكل ترم</option>
                <option value="all">كل الترمات — شيت لكل ترم</option>
              </select>
            </div>

            {exportMode === 'term' && (
              <div>
                <label className="text-sm">الترم </label>
                <select className="border rounded-xl p-2 w-full min-w-0" value={termId} onChange={e=>setTermId(e.target.value)}>
                  {terms.map(t => <option key={t.id} value={t.id}>{t.year} — {t.name}</option>)}
                </select>
              </div>
            )}

            {exportMode === 'year' && (
              <>
                <div>
                  <label className="text-sm">السنة</label>
                  <select className="border rounded-xl p-2 w-full min-w-0" value={exportYear} onChange={e=>setExportYear(Number(e.target.value))}>
                    {years.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm">نطاق الفرق</label>
                  <select className="border rounded-xl p-2 w-full min-w-0" value={exportTeamScope} onChange={e=>setExportTeamScope(e.target.value as any)}>
                    <option value="all">كل الفرق</option>
                    <option value="one">فريق واحد</option>
                  </select>
                </div>
                {exportTeamScope === 'one' && (
                  <div>
                    <label className="text-sm">الفريق</label>
                    <select className="border rounded-xl p-2 w-full min-w-0" value={exportTeamId} onChange={e=>setExportTeamId(e.target.value)}>
                      {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                )}
              </>
            )}

            <div className="md:col-span-1 text-end">
              <LoadingButton className="w-full sm:w-auto" loading={exporting} onClick={handleExport}>
                {exporting ? 'جارِ التحضير...' : 'تصدير XLSX'}
              </LoadingButton>
            </div>
          </div>

          <div className="text-xs text-gray-500">
            * كل ترم في شيت منفصل بعنوانه، وبين كل فريق سطر فاضي، وجميع صفوف البيانات والهيدر بحدود.
          </div>
        </section>
      )}

      {/* Table */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">المصروفات</h2>
        <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
          <table className="w-full min-w-[1000px] text-xs sm:text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start whitespace-nowrap">التاريخ</th>
                <th className="p-2 text-start">المنتج</th>
                <th className="p-2 text-center whitespace-nowrap">العدد</th>
                <th className="p-2 text-center whitespace-nowrap">سعر القطعة</th>
                <th className="p-2 text-center whitespace-nowrap">الإجمالي</th>
                <th className="p-2 text-center whitespace-nowrap">تمّ التسليم؟</th>{/* جديد */}
                <th className="p-2 text-center whitespace-nowrap">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map(x => {
                const isEditing = editingId === x.id
                const totalDisp = egp(Number(isEditing ? (Number(editDraft?.qty||0) * Number(editDraft?.unit_price||0)) : x.total))
                const canToggle = !!canModify
                return (
                  <tr key={x.id} className="border-t">
                    <td className="p-2">
                      {!isEditing ? (
                        sanitizeForUI(x.expense_date)
                      ) : (
                        <input
                          type="date"
                          className="border rounded-xl p-1"
                          value={editDraft?.expense_date ?? (x.expense_date || '').slice(0,10)}
                          min={termMin || undefined}
                          max={termMax || undefined}
                          onChange={e => setEditDraft(d => d ? { ...d, expense_date: e.target.value } :
                            { expense_date: e.target.value, item_name: x.item_name, qty: x.qty, unit_price: x.unit_price })}
                        />
                      )}
                    </td>

                    <td className="p-2">
                      {!isEditing ? (
                        sanitizeForUI(x.item_name)
                      ) : (
                        <input
                          className="border rounded-xl p-1 w-full"
                          value={editDraft?.item_name ?? x.item_name}
                          onChange={e => setEditDraft(d => d ? { ...d, item_name: e.target.value } :
                            { expense_date: (x.expense_date||'').slice(0,10), item_name: e.target.value, qty: x.qty, unit_price: x.unit_price })}
                        />
                      )}
                    </td>

                    <td className="p-2 text-center">
                      {!isEditing ? (
                        x.qty
                      ) : (
                        <input
                          type="number"
                          min={1}
                          className="border rounded-xl p-1 w-24 text-center"
                          value={editDraft?.qty ?? x.qty}
                          onChange={e => setEditDraft(d => d ? { ...d, qty: e.target.value as any } :
                            { expense_date: (x.expense_date||'').slice(0,10), item_name: x.item_name, qty: e.target.value as any, unit_price: x.unit_price })}
                        />
                      )}
                    </td>

                    <td className="p-2 text-center">
                      {!isEditing ? (
                        egp(Number(x.unit_price))
                      ) : (
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="border rounded-xl p-1 w-28 text-center"
                          value={editDraft?.unit_price ?? x.unit_price}
                          onChange={e => setEditDraft(d => d ? { ...d, unit_price: e.target.value as any } :
                            { expense_date: (x.expense_date||'').slice(0,10), item_name: x.item_name, qty: x.qty, unit_price: e.target.value as any })}
                        />
                      )}
                    </td>

                    <td className="p-2 text-center">{totalDisp}</td>

                    {/* عمود تمّ التسليم */}
                    <td className="p-2 text-center">
                      <label className={`inline-flex items-center gap-2 px-2 py-1 rounded-full border ${x.is_delivered?'bg-emerald-50 border-emerald-300 text-emerald-700':'bg-gray-50 border-gray-300 text-gray-700'}`}>
                        <input
                          type="checkbox"
                          checked={!!x.is_delivered}
                          disabled={!canToggle || togglingId===x.id}
                          onChange={e=>toggleDelivered(x.id, e.target.checked)}
                        />
                        <span className="text-[12px]">{x.is_delivered ? 'مُسلّم' : 'غير مُسلَّم'}</span>
                      </label>
                    </td>

                    <td className="p-2 text-center">
                      {!canModify ? (
                        <span className="text-gray-400 text-xs">—</span>
                      ) : !isEditing ? (
                        <div className="flex items-center justify-center gap-2">
                          {/* <button className="btn border" onClick={()=>startEditRow(x)}>تعديل</button> */}
                          <button
                            className="btn border"
                            disabled={deletingId===x.id}
                            onClick={()=>deleteRow(x.id)}
                          >
                            {deletingId===x.id ? '...' : 'حذف'}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-2">
                          <LoadingButton
                            loading={savingEditId===x.id}
                            onClick={()=>saveEditRow(x.id)}
                          >
                            حفظ
                          </LoadingButton>
                          <button className="btn border" onClick={cancelEditRow}>إلغاء</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {expenses.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={7}>لا توجد مصروفات</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
