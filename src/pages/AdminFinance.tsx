
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'
import { LoadingButton } from '../components/ui/LoadingButton'
import { useAuth } from '../components/AuthProvider'

type Team = { id: string; name: string }
type Term = { id: string; name: string; year: number }
type Expense = { id: string; total: number }

export default function AdminFinance() {
  const toast = useToast()
  const { roles } = useAuth()
  const isAdmin = roles.some(r => r.role_slug === 'admin')
  const isGlobalFinance = roles.some(r => r.role_slug === 'responsable_finance' && (r.team_id === null || r.team_id === undefined))

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [teams, setTeams] = useState<Team[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [teamId, setTeamId] = useState<string>('')
  const [termId, setTermId] = useState<string>('')
  const [budget, setBudget] = useState<number | null>(null)

  const [exp, setExp] = useState<Expense[]>([])

  const egp = (v: number) => new Intl.NumberFormat('en-EG', { style: 'currency', currency: 'EGP', maximumFractionDigits: 2 }).format(v)

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const [{ data: ts, error: te }, { data: trs, error: tre }] = await Promise.all([
        supabase.from('teams').select('id,name').order('name'),
        supabase.from('terms').select('id,name,year').order('year', { ascending: false }).order('name', { ascending: true })
      ])
      if (te) throw te
      if (tre) throw tre
      setTeams((ts as any) ?? [])
      setTerms((trs as any) ?? [])
      if (ts && ts.length) setTeamId(ts[0].id)
      if (trs && trs.length) setTermId(trs[0].id)
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (teamId && termId) refresh() }, [teamId, termId])
  async function refresh() {
    setLoading(true)
    try {
      const [{ data: bRow, error: bErr }, { data: exRows, error: eErr }] = await Promise.all([
        supabase.from('team_budgets').select('amount_total').eq('team_id', teamId).eq('term_id', termId).is('soft_deleted_at', null).maybeSingle(),
        supabase.from('expenses').select('id,total').eq('team_id', teamId).eq('term_id', termId).is('soft_deleted_at', null)
      ])
      if (bErr) throw bErr
      if (eErr) throw eErr
      setBudget(bRow?.amount_total ?? null)
      setExp((exRows as any[]) ?? [])
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الميزانية/المصروفات')
    } finally {
      setLoading(false)
    }
  }

  const spent = useMemo(() => (exp ?? []).reduce((s, x:any) => s + (Number(x.total) || 0), 0), [exp])
  const remaining = useMemo(() => (budget ?? 0) - spent, [budget, spent])
  const status: 'ok' | 'low' | 'depleted' = useMemo(() => {
    if (!budget || budget <= 0) return spent > 0 ? 'depleted' : 'ok'
    if (remaining <= 0) return 'depleted'
    if (remaining <= 0.25 * budget) return 'low'
    return 'ok'
  }, [budget, remaining, spent])

  async function saveBudget() {
    if (!(isAdmin || isGlobalFinance)) { toast.error('صلاحية غير كافية'); return }
    if (!teamId || !termId) { toast.error('اختر الفريق والترم'); return }
    const newValRaw = (document.getElementById('budgetInput') as HTMLInputElement | null)?.value
    const newVal = Number(newValRaw)
    if (!isFinite(newVal) || newVal < 0) { toast.error('قيمة الميزانية غير صالحة'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('team_budgets')
        .upsert({ team_id: teamId, term_id: termId, amount_total: newVal }, { onConflict: 'team_id,term_id' })
      if (error) throw error
      toast.success('تم حفظ الميزانية')
      await refresh()
    } catch (e:any) {
      toast.error(e.message || 'تعذر حفظ الميزانية')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />
      <h1 className="text-xl font-bold">المالية (أدمن) — تعيين ميزانية الترم لكل فريق</h1>

      <div className="grid md:grid-cols-3 gap-3 items-end">
        <div>
          <label className="text-sm">الفريق</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={teamId} onChange={e=>setTeamId(e.target.value)}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm">الترم</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={termId} onChange={e=>setTermId(e.target.value)}>
            {terms.map(t => <option key={t.id} value={t.id}>{t.year} — {t.name}</option>)}
          </select>
        </div>
        <div className="text-end">
          <div className="text-xs text-gray-500 mb-1">قيمة الميزانية (EGP)</div>
          <div className="flex gap-2">
            <input id="budgetInput" type="number" min={0} step="0.01" defaultValue={budget ?? 0} className="border rounded-xl p-2 w-full" />
            <LoadingButton loading={saving} onClick={saveBudget}>حفظ</LoadingButton>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <div className="p-4 rounded-2xl border">
          <div className="text-xs text-gray-500">الميزانية الحالية</div>
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

      <div className="text-xs text-gray-500">
        ملاحظة: هذه الصفحة مخصصة للأدمن/المسؤول العام فقط لتعيين الميزانيات. تسجيل المصروفات يتم من صفحة الفريق.
      </div>
    </div>
  )
}
