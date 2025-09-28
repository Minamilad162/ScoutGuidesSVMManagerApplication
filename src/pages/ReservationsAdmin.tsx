
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'

type Team = { id: string; name: string }
type Zone = { id: string; name: string }
type MatRow = {
  id: string
  team_id: string
  material_id: string
  qty: number
  starts_at: string
  ends_at: string
}
type FieldRow = {
  id: string
  team_id: string
  field_zone_id: string
  starts_at: string
  ends_at: string
}

function fmtTimeRange(isoStart: string, isoEnd: string) {
  const s = new Date(isoStart)
  const e = new Date(isoEnd)
  const pad = (n:number)=> String(n).padStart(2,'0')
  const d = `${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())}`
  const t1 = `${pad(s.getHours())}:${pad(s.getMinutes())}`
  const t2 = `${pad(e.getHours())}:${pad(e.getMinutes())}`
  return `${d} ${t1} → ${t2}`
}

export default function ReservationsAdmin() {
  const toast = useToast()

  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState<string>('')
  const [dateStr, setDateStr] = useState<string>(() => {
    const d = new Date()
    const pad = (n:number)=> String(n).padStart(2,'0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  })
  const [materialsMap, setMaterialsMap] = useState<Record<string, { name: string, storage?: string }>>({})
  const [zonesMap, setZonesMap] = useState<Record<string, string>>({})

  const [matRows, setMatRows] = useState<MatRow[]>([])
  const [fieldRows, setFieldRows] = useState<FieldRow[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  const dayStart = useMemo(() => new Date(`${dateStr}T00:00:00`), [dateStr])
  const dayEnd   = useMemo(() => new Date(`${dateStr}T23:59:59`), [dateStr])

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const [{ data: ts, error: te }, { data: mats, error: me }, { data: zs, error: ze }] = await Promise.all([
        supabase.from('teams').select('id,name').order('name'),
        supabase.from('materials').select('id, name, storage_locations:storage_location_id(name)'),
        supabase.from('field_zones').select('id, name').order('name')
      ])
      if (te) throw te
      if (me) throw me
      if (ze) throw ze
      setTeams((ts as any) ?? [])
      const mMap: Record<string, { name: string, storage?: string }> = {}
      for (const m of (mats as any[] ?? [])) mMap[m.id] = { name: m.name, storage: m.storage_locations?.name }
      setMaterialsMap(mMap)
      const zMap: Record<string, string> = {}
      for (const z of (zs as any[] ?? [])) zMap[z.id] = z.name
      setZonesMap(zMap)
      if (!teamId && ts && ts.length) setTeamId(ts[0].id)
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (dateStr) fetchData() }, [dateStr, teamId])
  async function fetchData() {
    setLoading(true)
    try {
      const d0 = new Date(`${dateStr}T00:00:00`)
      const d1 = new Date(`${dateStr}T23:59:59`)

      // materials reservations overlapping the day
      let mq = supabase
        .from('material_reservations')
        .select('id, team_id, material_id, qty, starts_at, ends_at')
        .is('soft_deleted_at', null)
        .lt('starts_at', d1.toISOString())
        .gt('ends_at', d0.toISOString())
      if (teamId) mq = mq.eq('team_id', teamId)
      const [{ data: mrs, error: mre }, { data: frs, error: fre }] = await Promise.all([
        mq.order('starts_at', { ascending: true }),
        // field reservations overlapping the day
        supabase.from('field_reservations')
          .select('id, team_id, field_zone_id, starts_at, ends_at')
          .is('soft_deleted_at', null)
          .lt('starts_at', d1.toISOString())
          .gt('ends_at', d0.toISOString())
          .order('starts_at', { ascending: true })
      ])
      if (mre) throw mre
      if (fre) throw fre
      setMatRows((mrs as any[]) ?? [])
      setFieldRows((frs as any[]) ?? [])
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الحجوزات')
    } finally {
      setLoading(false)
    }
  }

  // Build helper: for each (team, time range) of material reservation, find overlapping zones for same team
  function zonesFor(team_id: string, sIso: string, eIso: string): string[] {
    const s = new Date(sIso).getTime()
    const e = new Date(eIso).getTime()
    const out: string[] = []
    for (const r of fieldRows) {
      if (r.team_id !== team_id) continue
      const rs = new Date(r.starts_at).getTime()
      const re = new Date(r.ends_at).getTime()
      if (rs < e && re > s) {
        const zname = zonesMap[r.field_zone_id] || '—'
        if (!out.includes(zname)) out.push(zname)
      }
    }
    return out
  }

  // Grouped render either by team or by day depending on teamId?
  // We'll render a single table, sorted by time; Each row: time, tool, team, qty, zones
  // And between time windows we print a sticky header "الفريق: X" if team changes when viewing "All teams" (if teamId === '')
  const byTeamThenTime = useMemo(() => {
    const rows = matRows.slice().sort((a,b) => a.team_id.localeCompare(b.team_id) || a.starts_at.localeCompare(b.starts_at))
    return rows
  }, [matRows])

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري تحميل البيانات..." />

      <h1 className="text-xl font-bold">حجوزات الأدوات — عرض الأدمن</h1>

      <div className="grid md:grid-cols-3 gap-3 items-end">
        <div>
          <label className="text-sm">الفريق</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={teamId} onChange={e=>setTeamId(e.target.value)}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm">التاريخ</label>
          <input type="date" className="border rounded-xl p-2 w-full cursor-pointer" value={dateStr} onChange={e=>setDateStr(e.target.value)} />
        </div>
        <div className="text-xs text-gray-600">
          يعرض الحجوزات التي تتقاطع مع اليوم المختار. الصفّ يوضح: <b>اسم الأداة</b> — <b>اسم الفريق</b> — <b>العدد</b> — <b>الأرض المحجوزة</b>.
        </div>
      </div>

      <div className="border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2">الوقت</th>
              <th className="p-2 text-start">اسم الأداة</th>
              <th className="p-2 text-start">الفريق</th>
              <th className="p-2 text-center">العدد</th>
              <th className="p-2 text-start">الأرض المحجوزة</th>
              <th className="p-2 text-start">مكان التخزين</th>
            </tr>
          </thead>
          <tbody>
            {byTeamThenTime.map((r, idx) => {
              const mat = materialsMap[r.material_id]
              const teamName = teams.find(t => t.id === r.team_id)?.name || '—'
              const z = zonesFor(r.team_id, r.starts_at, r.ends_at)
              return (
                <tr key={r.id} className="border-t align-top">
                  <td className="p-2 whitespace-nowrap">{fmtTimeRange(r.starts_at, r.ends_at)}</td>
                  <td className="p-2">
                    <div className="font-medium">{mat?.name || '—'}</div>
                  </td>
                  <td className="p-2">{teamName}</td>
                  <td className="p-2 text-center">{r.qty}</td>
                  <td className="p-2">
                    {z.length ? z.join(', ') : '—'}
                  </td>
                  <td className="p-2">{mat?.storage || '—'}</td>
                </tr>
              )
            })}
            {byTeamThenTime.length === 0 && (
              <tr><td className="p-3 text-center text-gray-500" colSpan={6}>لا توجد حجوزات في هذا اليوم.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
