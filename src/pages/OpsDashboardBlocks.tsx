import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'

type Material = { id: string; name: string }
type MatUsageRow = { material_id: string; count: number; hours: number }
type OverdueItem = { material_name: string; overdue_count: number }
type OverdueByTeam = { team_id: string|null; team_name: string; avg_delay_days: number; total_overdue: number }
type HeatCell = { dow: number; hour: number; count: number }
type ZoneCount = { zone_id: string; zone_name: string; count: number }
type BudgetRow = { team_id: string; team_name: string; remaining_percent: number; budget_total?: number|null; spent_total?: number|null }

function cls(...xs: (string|false|undefined)[]) { return xs.filter(Boolean).join(' ') }

export default function OpsDashboardBlocks() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)

  const [start, setStart] = useState<string>(() => {
    const d = new Date(); d.setMonth(d.getMonth()-2)
    return d.toISOString().slice(0,10)
  })
  const [end, setEnd] = useState<string>(() => new Date().toISOString().slice(0,10))

  // المواد
  const [materials, setMaterials] = useState<Material[]>([])
  const [matUsage, setMatUsage] = useState<MatUsageRow[]>([])
  // التأخير
  const [overdueTeams, setOverdueTeams] = useState<OverdueByTeam[]>([])
  const [overdueItems, setOverdueItems] = useState<OverdueItem[]>([])
  // الأرض
  const [heat, setHeat] = useState<HeatCell[]>([])
  const [topZones, setTopZones] = useState<ZoneCount[]>([])
  // الميزانية
  const [budgets, setBudgets] = useState<BudgetRow[]>([])

  useEffect(() => { refresh() }, [])
  async function refresh() {
    setLoading(true)
    try {
      await Promise.all([
        loadMaterials(),
        loadMaterialUsage(),
        loadReturnDelays(),
        loadFieldHeat(),
        loadBudgets()
      ])
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally { setLoading(false) }
  }

  async function loadMaterials() {
    try {
      const { data } = await supabase.from('materials').select('id,name').order('name')
      setMaterials(((data as any[]) ?? []).map(r=>({ id:r.id, name:r.name })))
    } catch { setMaterials([]) }
  }

  // ========= 1) نسبة استخدام الأدوات (عدد الحجوزات + ساعات الاستخدام) =========
  async function loadMaterialUsage() {
    try {
      // عدّل starts_at/ends_at لو مختلفة عندك
      const { data, error } = await supabase
        .from('material_reservations')
        .select('material_id, starts_at, ends_at')
        .gte('starts_at', start).lte('ends_at', `${end} 23:59:59`)
      if (error) throw error

      const map = new Map<string, MatUsageRow>()
      for (const r of (data as any[]) ?? []) {
        const mid = String(r.material_id)
        const s = r.starts_at ? new Date(r.starts_at) : null
        const e = r.ends_at ? new Date(r.ends_at) : null
        const hours = (s && e && !Number.isNaN(+s) && !Number.isNaN(+e)) ? Math.max(0, (+e - +s)/3600000) : 0
        const prev = map.get(mid) || { material_id: mid, count: 0, hours: 0 }
        prev.count += 1
        prev.hours += hours
        map.set(mid, prev)
      }
      setMatUsage(Array.from(map.values()).sort((a,b)=> b.count - a.count))
    } catch {
      setMatUsage([])
    }
  }

  // ========= 2) تأخّر تسليم العهدة =========
  async function loadReturnDelays() {
    try {
      const { data: d1 } = await supabase
        .from('v_material_items_due_today')
        .select('material_name, team_name, days_overdue')
      const itemsMap = new Map<string, number>()
      const teamsMap = new Map<string, { name: string, total: number, sumDays: number }>()
      for (const r of ((d1 as any[]) ?? [])) {
        const key = r.material_name || '—'
        itemsMap.set(key, (itemsMap.get(key)||0) + 1)

        const tname = r.team_name || '—'
        const curr = teamsMap.get(tname) || { name: tname, total: 0, sumDays: 0 }
        curr.total += 1
        curr.sumDays += Number(r.days_overdue||0)
        teamsMap.set(tname, curr)
      }

      const items: OverdueItem[] = Array.from(itemsMap.entries())
        .map(([material_name, overdue_count]) => ({ material_name, overdue_count }))
        .sort((a,b)=> b.overdue_count - a.overdue_count)
        .slice(0, 10)

      const teams: OverdueByTeam[] = Array.from(teamsMap.values())
        .map(t => ({
          team_id: null,
          team_name: t.name,
          total_overdue: t.total,
          avg_delay_days: t.total ? +(t.sumDays / t.total).toFixed(1) : 0
        }))
        .sort((a,b)=> b.avg_delay_days - a.avg_delay_days)

      setOverdueItems(items)
      setOverdueTeams(teams)
    } catch {
      setOverdueItems([])
      setOverdueTeams([])
    }
  }

  // ========= 3) خريطة استخدام الأرض (Heatmap) — باستخدام field_reservations =========
  async function loadFieldHeat() {
    try {
      // لازم يكون فيه FK من field_reservations.field_zone_id -> field_zones.id
      // علشان نقدر نعمل join كده:
      const { data, error } = await supabase
        .from('field_reservations')
        .select('field_zone_id, starts_at, ends_at, field_zones(name)')
        .gte('starts_at', start).lte('ends_at', `${end} 23:59:59`)
      if (error) throw error

      const cellMap = new Map<string, number>() // key: `${dow}-${hour}`
      const zMap = new Map<string, ZoneCount>()

      for (const r of ((data as any[]) ?? [])) {
        const s = r.starts_at ? new Date(r.starts_at) : null
        if (!s || Number.isNaN(+s)) continue
        const dow = s.getDay() // 0 Sun .. 6 Sat
        const hour = s.getHours()
        const key = `${dow}-${hour}`
        cellMap.set(key, (cellMap.get(key)||0) + 1)

        const zid = String(r.field_zone_id)
        const zname = r.field_zones?.name || 'Zone'
        const z = zMap.get(zid) || { zone_id: zid, zone_name: zname, count: 0 }
        z.count += 1
        z.zone_name = zname
        zMap.set(zid, z)
      }

      const heatArr: HeatCell[] = Array.from(cellMap.entries()).map(([k, c]) => {
        const [d, h] = k.split('-').map(Number)
        return { dow: d, hour: h, count: c }
      })
      setHeat(heatArr)
      setTopZones(Array.from(zMap.values()).sort((a,b)=> b.count - a.count).slice(0, 8))
    } catch {
      setHeat([])
      setTopZones([])
    }
  }

  // ========= 4) إنذارات الميزانية =========
  async function getLatestTermId(): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('terms')
      .select('id, year')
      .order('year', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data as any)?.id ?? null
  } catch {
    return null
  }
}

async function fallbackBudgetsFromTeamBudgets() {
  try {
    const latestTermId = await getLatestTermId()
    // لو مفيش terms هنعرض كل الميزانيات المتاحة
    let q = supabase.from('team_budgets')
      .select('team_id, term_id, amount_total, teams(name)')
      .order('team_id') as any
    if (latestTermId) q = q.eq('term_id', latestTermId)

    const { data, error } = await q
    if (error) throw error

    const rows = ((data as any[]) ?? []).map(r => ({
      team_id: String(r.team_id ?? ''),
      team_name: r.teams?.name ?? '—',
      budget_total: Number(r.amount_total ?? 0),
      spent_total: 0,                // لحد ما نربطها بمصاريف فعلية
      remaining_percent: 100         // بما إننا مش حاسبين المصروف هنا
    }))

    setBudgets(rows.sort((a,b)=> a.remaining_percent - b.remaining_percent))
  } catch {
    setBudgets([])
  }
}

async function loadBudgets() {
  // 1) جرّب الـ view لو متاح
  try {
    const { data, error } = await supabase
      .from('v_finance_summary')
      .select('team_id, team_name, remaining_percent, budget_total, spent_total')
    if (error) throw error

    const rows = ((data as any[]) ?? []).map(r => ({
      team_id: String(r.team_id ?? ''),
      team_name: r.team_name ?? '—',
      remaining_percent: Number(r.remaining_percent ?? 0),
      budget_total: r.budget_total ?? null,
      spent_total: r.spent_total ?? null
    }))

    // لو الـ view راجع فاضي استخدم fallback
    if (!rows.length) {
      await fallbackBudgetsFromTeamBudgets()
      return
    }

    setBudgets(rows.sort((a,b)=> a.remaining_percent - b.remaining_percent))
  } catch {
    // 2) لو الـ view مش موجود/وقع: استخدم fallback من team_budgets
    await fallbackBudgetsFromTeamBudgets()
  }
}

  // ======= Derived / helpers =======
  const matName = (id: string) => materials.find(m=>m.id===id)?.name || id
  const maxHeat = useMemo(()=> heat.reduce((m,x)=> Math.max(m, x.count), 0) || 1, [heat])
  const days = ['أحد','إثن','ثلث','أربع','خمس','جمع','سبت']

  return (
    <div className="space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold">لوحة المتابعة — المواد / الأرض / الميزانية</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm">الفترة</label>
          <input type="date" className="border rounded-xl p-2" value={start} onChange={e=>setStart(e.target.value)} />
          <span>—</span>
          <input type="date" className="border rounded-xl p-2" value={end} onChange={e=>setEnd(e.target.value)} />
          <button className="btn border" onClick={refresh}>تحديث</button>
        </div>
      </div>

      {/* 1) استخدام الأدوات */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">نسبة استخدام الأدوات</h3>
        </div>
        <div className="rounded-2xl border overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الأداة</th>
                <th className="p-2 text-center">عدد الحجوزات</th>
                <th className="p-2 text-center">ساعات الاستخدام (الإجمالي)</th>
              </tr>
            </thead>
            <tbody>
              {matUsage.map(r => (
                <tr key={r.material_id} className="border-t">
                  <td className="p-2">{matName(r.material_id)}</td>
                  <td className="p-2 text-center">{r.count}</td>
                  <td className="p-2 text-center">{r.hours.toFixed(1)}</td>
                </tr>
              ))}
              {matUsage.length===0 && <tr><td className="p-3 text-center text-gray-500" colSpan={3}>لا يوجد استخدام في الفترة المحددة</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2) تأخّر تسليم العهدة */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">تأخر تسليم العهدة</h3>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border overflow-hidden">
            <div className="bg-gray-50 p-2 text-sm font-semibold">متوسط التأخير لكل فريق (أيام)</div>
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-start">الفريق</th>
                  <th className="p-2 text-center">متوسط التأخير</th>
                  <th className="p-2 text-center">إجمالي العناصر المتأخرة</th>
                </tr>
              </thead>
              <tbody>
                {overdueTeams.map((t,i)=>(
                  <tr key={i} className="border-t">
                    <td className="p-2">{t.team_name}</td>
                    <td className="p-2 text-center">{t.avg_delay_days}</td>
                    <td className="p-2 text-center">{t.total_overdue}</td>
                  </tr>
                ))}
                {overdueTeams.length===0 && <tr><td className="p-3 text-center text-gray-500" colSpan={3}>لا توجد بيانات متأخرة</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border overflow-hidden">
            <div className="bg-gray-50 p-2 text-sm font-semibold">أكثر عناصر يتأخر تسليمها</div>
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-start">العنصر</th>
                  <th className="p-2 text-center">مرات التأخير</th>
                </tr>
              </thead>
              <tbody>
                {overdueItems.map((x,i)=>(
                  <tr key={i} className="border-t">
                    <td className="p-2">{x.material_name}</td>
                    <td className="p-2 text-center">{x.overdue_count}</td>
                  </tr>
                ))}
                {overdueItems.length===0 && <tr><td className="p-3 text-center text-gray-500" colSpan={2}>لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 3) خريطة استخدام الأرض */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">خريطة استخدام الأرض (حسب اليوم/الساعة)</h3>
        </div>

        <div className="grid md:grid-cols-[1fr,280px] gap-4">
          <div className="rounded-2xl border p-3 overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="grid"
                   style={{ gridTemplateColumns: `80px repeat(24, 1fr)` }}>
                <div></div>
                {Array.from({length:24}).map((_,h)=>(
                  <div key={h} className="text-[11px] text-center text-gray-600">{h}:00</div>
                ))}
                {Array.from({length:7}).map((_,d)=>(
                  <>
                    <div key={`dlabel-${d}`} className="py-2 text-xs font-medium text-gray-700">{days[d]}</div>
                    {Array.from({length:24}).map((__,h)=>{
                      const c = heat.find(x=>x.dow===d && x.hour===h)?.count || 0
                      const alpha = c ? (0.15 + 0.85 * (c/maxHeat)) : 0
                      return (
                        <div key={`cell-${d}-${h}`} className="h-6 border"
                          style={{ backgroundColor: c ? `rgba(59,130,246,${alpha})` : 'transparent' }}
                          title={`${days[d]} ${h}:00 — ${c}`} />
                      )
                    })}
                  </>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border overflow-hidden">
            <div className="bg-gray-50 p-2 text-sm font-semibold">أعلى المناطق استخدامًا</div>
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-start">المنطقة</th>
                  <th className="p-2 text-center">عدد الحجوزات</th>
                </tr>
              </thead>
              <tbody>
                {topZones.map(z=>(
                  <tr key={z.zone_id} className="border-t">
                    <td className="p-2">{z.zone_name}</td>
                    <td className="p-2 text-center">{z.count}</td>
                  </tr>
                ))}
                {topZones.length===0 && <tr><td className="p-3 text-center text-gray-500" colSpan={2}>لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* 4) إنذارات الميزانية */}
      <section className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">التزام الفرق بالميزانية</h3>
        </div>
        <div className="rounded-2xl border overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الفريق</th>
                <th className="p-2 text-center">المتبقي %</th>
                <th className="p-2 text-center">الميزانية</th>
                <th className="p-2 text-center">المصروف</th>
                <th className="p-2 text-center">حالة</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map(b => (
                <tr key={b.team_id} className="border-t">
                  <td className="p-2">{b.team_name}</td>
                  <td className="p-2 text-center">{b.remaining_percent?.toFixed?.(0)}%</td>
                  <td className="p-2 text-center">{b.budget_total ?? '—'}</td>
                  <td className="p-2 text-center">{b.spent_total ?? '—'}</td>
                  <td className="p-2 text-center">
                    <span className={cls(
                      'inline-flex items-center justify-center min-w-[56px] px-2 py-1 rounded-full text-xs border',
                      b.remaining_percent < 10 ? 'bg-rose-50 border-rose-300 text-rose-700'
                      : b.remaining_percent < 25 ? 'bg-amber-50 border-amber-300 text-amber-700'
                      : 'bg-emerald-50 border-emerald-300 text-emerald-700'
                    )}>
                      {b.remaining_percent < 10 ? 'خطر' : b.remaining_percent < 25 ? 'إنذار' : 'جيد'}
                    </span>
                  </td>
                </tr>
              ))}
              {budgets.length===0 && <tr><td className="p-3 text-center text-gray-500" colSpan={5}>لا توجد بيانات</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
