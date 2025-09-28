
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ui/Toaster'
import { LoadingButton } from '../components/ui/LoadingButton'
import { PageLoader } from '../components/ui/PageLoader'
import { useRoleGate } from '../hooks/useRoleGate'
import { useAuth } from '../components/AuthProvider'

type Team = { id: string; name: string }
type Term = { id: string; name: string; year: number; start_date: string | null; end_date: string | null }
type Expense = { id: string; expense_date: string; item_name: string; qty: number; unit_price: number; total: number }

export default function Finance() {
  const toast = useToast()
  const gate = useRoleGate()
  const { roles } = useAuth()

  const [teams, setTeams] = useState<Team[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [teamId, setTeamId] = useState<string>('')
  const [termId, setTermId] = useState<string>('')

  const [budget, setBudget] = useState<number | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [saving, setSaving] = useState<boolean>(false)

  // Expense form
  const [exDate, setExDate] = useState<string>('')
  const [exName, setExName] = useState<string>('')
  const [exQty, setExQty] = useState<number | ''>('')
  const [exUnit, setExUnit] = useState<number | ''>('')
  const [savingExp, setSavingExp] = useState(false)

  const isAdmin = roles.some(r => r.role_slug === 'admin')
  const isGlobalFinance = roles.some(r => r.role_slug === 'responsable_finance' && (r.team_id === null || r.team_id === undefined))

  const egp = (v: number) => new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(v)

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const [{ data: tm, error: te }, { data: ts, error: tse }] = await Promise.all([
        supabase.from('terms').select('id,name,year,start_date,end_date').order('year', { ascending: false }).order('name', { ascending: true }),
        supabase.from('teams').select('id,name').order('name')
      ])
      if (te) throw te
      if (tse) throw tse
      setTerms((tm as any) ?? [])
      setTeams((ts as any) ?? [])

      // default term
      if (!termId && tm && tm.length) setTermId(tm[0].id)

      // default team: global finance/admin → first; else → v_me
      if (isAdmin || isGlobalFinance) {
        if (ts && ts.length) setTeamId(ts[0].id)
      } else {
        const { data: meRow, error: meErr } = await supabase.from('v_me').select('team_id').maybeSingle()
        if (meErr) throw meErr
        if (!meRow?.team_id) throw new Error('لا يوجد فريق مرتبط بحسابك')
        setTeamId(meRow.team_id)
      }

      // default expense date = today
      const today = new Date()
      const pad = (n:number)=>String(n).padStart(2,'0')
      setExDate(`${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`)
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (teamId && termId) refreshData() }, [teamId, termId])
  async function refreshData() {
    setLoading(true)
    try {
      const [{ data: bRow, error: bErr }, { data: expRows, error: eErr }] = await Promise.all([
        supabase.from('team_budgets').select('amount_total').eq('team_id', teamId).eq('term_id', termId).is('soft_deleted_at', null).maybeSingle(),
        supabase.from('expenses').select('id, expense_date, item_name, qty, unit_price, total').eq('team_id', teamId).eq('term_id', termId).is('soft_deleted_at', null).order('expense_date', { ascending: false })
      ])
      if (bErr) throw bErr
      if (eErr) throw eErr
      setBudget(bRow?.amount_total ?? null)
      setExpenses((expRows as any[]) ?? [])
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الميزانية/المصروفات')
    } finally {
      setLoading(false)
    }
  }

  const spent = useMemo(() => expenses.reduce((s, x) => s + (Number(x.total) || 0), 0), [expenses])
  const remaining = useMemo(() => (budget ?? 0) - spent, [budget, spent])
  const pct = useMemo(() => (budget && budget > 0 ? Math.min(100, Math.max(0, (spent / budget) * 100)) : 0), [budget, spent])
  const status: 'ok' | 'low' | 'depleted' = useMemo(() => {
    if (!budget || budget <= 0) return spent > 0 ? 'depleted' : 'ok'
    if (remaining <= 0) return 'depleted'
    if (remaining <= 0.25 * budget) return 'low'
    return 'ok'
  }, [budget, remaining, spent])

  async function saveBudget() {
    if (!gate.canEditBudget(teamId)) { toast.error('ليس لديك صلاحية تعديل الميزانية'); return }
    if (!teamId || !termId) { toast.error('اختر الفريق والترم'); return }
    const val = Number(prompt('ادخل قيمة الميزانية الجديدة (EGP):', String(budget ?? 0)))
    if (!isFinite(val) || val < 0) return

    setSaving(true)
    try {
      const { error } = await supabase
        .from('team_budgets')
        .upsert({ team_id: teamId, term_id: termId, amount_total: val }, { onConflict: 'team_id,term_id' })
      if (error) throw error
      toast.success('تم حفظ الميزانية')
      await refreshData()
    } catch (e:any) {
      toast.error(e.message || 'تعذر حفظ الميزانية')
    } finally {
      setSaving(false)
    }
  }

  async function addExpense() {
    if (!gate.canWriteExpense(teamId)) { toast.error('ليست لديك صلاحية إضافة مصروف'); return }
    if (!teamId || !termId) return toast.error('اختر الفريق والترم')
    const q = Number(exQty); const u = Number(exUnit)
    if (!isFinite(q) || q <= 0) return toast.error('العدد غير صالح')
    if (!isFinite(u) || u < 0) return toast.error('سعر القطعة غير صالح')
    if (!exName.trim()) return toast.error('ادخل اسم المنتج')

    setSavingExp(true)
    try {
      const { error } = await supabase.from('expenses').insert({
        team_id: teamId, term_id: termId,
        expense_date: exDate,
        item_name: exName.trim(),
        qty: q, unit_price: u
      })
      if (error) throw error
      toast.success('تم إضافة المصروف')
      setExName(''); setExQty(''); setExUnit('')
      await refreshData()
    } catch (e:any) {
      toast.error(e.message || 'تعذر إضافة المصروف')
    } finally {
      setSavingExp(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري تحميل البيانات..." />

      <h1 className="text-xl font-bold">الميزانية — عرض وإدارة</h1>

      <div className="grid md:grid-cols-3 gap-3 items-end">
        <div className={`${(isAdmin || isGlobalFinance) ? '' : 'opacity-60 pointer-events-none'}`}>
          <label className="text-sm">الفريق</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={teamId} onChange={e=>setTeamId(e.target.value)}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {!(isAdmin || isGlobalFinance) && <div className="text-xs text-gray-500">لا يمكن تغيير الفريق إلا للأدمن/المسؤول العام</div>}
        </div>

        <div>
          <label className="text-sm">الترم</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={termId} onChange={e=>setTermId(e.target.value)}>
            {terms.map(t => <option key={t.id} value={t.id}>{t.year} — {t.name}</option>)}
          </select>
        </div>

        <div className="text-end">
          {(gate.canEditBudget(teamId)) && <LoadingButton loading={saving} onClick={saveBudget}>تعديل الميزانية</LoadingButton>}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">المصروفات</h2>
        {gate.canWriteExpense(teamId) && (
          <div className="grid md:grid-cols-5 gap-2 items-end">
            <div>
              <label className="text-sm">التاريخ</label>
              <input type="date" className="border rounded-xl p-2 w-full" value={exDate} onChange={e=>setExDate(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm">اسم المنتج</label>
              <input className="border rounded-xl p-2 w-full" value={exName} onChange={e=>setExName(e.target.value)} placeholder="مثلاً: أدوات..." />
            </div>
            <div>
              <label className="text-sm">العدد</label>
              <input type="number" min={1} className="border rounded-xl p-2 w-full" value={exQty} onChange={e=>setExQty(e.target.value as any)} />
            </div>
            <div>
              <label className="text-sm">سعر القطعة</label>
              <input type="number" min={0} step="0.01" className="border rounded-xl p-2 w-full" value={exUnit} onChange={e=>setExUnit(e.target.value as any)} />
            </div>
            <div className="md:col-span-5 flex justify-end">
              <LoadingButton loading={savingExp} onClick={addExpense}>إضافة مصروف</LoadingButton>
            </div>
          </div>
        )}

        <div className="border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">التاريخ</th>
                <th className="p-2 text-start">المنتج</th>
                <th className="p-2 text-center">العدد</th>
                <th className="p-2 text-center">سعر القطعة</th>
                <th className="p-2 text-center">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map(x => (
                <tr key={x.id} className="border-t">
                  <td className="p-2">{x.expense_date}</td>
                  <td className="p-2">{x.item_name}</td>
                  <td className="p-2 text-center">{x.qty}</td>
                  <td className="p-2 text-center">{egp(Number(x.unit_price))}</td>
                  <td className="p-2 text-center">{egp(Number(x.total))}</td>
                </tr>
              ))}
              {expenses.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={5}>لا توجد مصروفات</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
