import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { LoadingButton } from '../components/ui/LoadingButton'
import { useToast } from '../components/ui/Toaster'
import { useRoleGate } from '../hooks/useRoleGate'
import { useAuth } from '../components/AuthProvider'

type Team = { id: string; name: string }
type Material = { id: string; name: string; total_qty: number }
type Resv = { id: string; material_id: string; team_id: string; qty: number; starts_at: string; ends_at: string; }

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
  const [startAt, setStartAt] = useState<string>('')
  const [endAt, setEndAt] = useState<string>('')
  const [saving, setSaving] = useState(false)

  const [list, setList] = useState<Resv[]>([])

  const isAdmin = roles.some(r => r.role_slug === 'admin')

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

      // default team: admin -> first in list; else -> v_me
      if (isAdmin) {
        if (ts && ts.length) setTeamId(ts[0].id)
      } else {
        const { data: meRow, error: meErr } = await supabase.from('v_me').select('team_id').maybeSingle()
        if (meErr) throw meErr
        if (!meRow?.team_id) throw new Error('لا يوجد فريق مرتبط بحسابك')
        setTeamId(meRow.team_id)
      }
      if (ms && ms.length) setMatId(ms[0].id)
      // default time: now to +2h
      const now = new Date(); const two = new Date(now.getTime() + 2*60*60*1000)
      const toLocalInput = (d: Date) => {
        const pad = (n:number)=> String(n).padStart(2,'0')
        return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
      }
      setStartAt(toLocalInput(now))
      setEndAt(toLocalInput(two))
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally {
      setLoading(false)
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
        p_starts: new Date(startAt).toISOString(),
        p_ends: new Date(endAt).toISOString()
      })
      if (error) throw error
      setAvailable((data as any) ?? null)
    } catch (e:any) {
      setAvailable(null)
    }
  }

  async function saveReservation() {
    if (!teamId) return toast.error('اختر الفريق')
    if (!matId) return toast.error('اختر الأداة')
    const q = Number(qty); if (!isFinite(q) || q <= 0) return toast.error('الكمية غير صالحة')
    if (!startAt || !endAt) return toast.error('حدد وقت البداية والنهاية')

    setSaving(true)
    try {
      const { error } = await supabase.from('material_reservations').insert({
        team_id: teamId,
        material_id: matId,
        qty: q,
        starts_at: new Date(startAt).toISOString(),
        ends_at: new Date(endAt).toISOString()
      })
      if (error) throw error
      toast.success('تم الحجز')
      setQty('')
      await refreshList()
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحجز (قد تكون الكمية غير متاحة)')
    } finally {
      setSaving(false)
    }
  }

  async function cancelReservation(id: string) {
    try {
      const { error } = await supabase.from('material_reservations').update({ soft_deleted_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      toast.success('تم إلغاء الحجز')
      await refreshList()
    } catch (e:any) {
      toast.error(e.message || 'تعذر الإلغاء')
    }
  }

  function fmt(iso: string) {
    const d = new Date(iso); const pad = (n:number)=> String(n).padStart(2,'0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const matMap = useMemo(() => new Map(materials.map(m => [m.id, m])), [materials])

  const canBook = gate.canBookReservations(teamId)

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">حجوزات الأدوات — مسؤول الفريق</h1>

      {/* فلاتر ونموذج الحجز */}
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

        <div>
          <label className="text-sm">من</label>
          <input type="datetime-local" className="border rounded-xl p-2 w-full" value={startAt} onChange={e=>setStartAt(e.target.value)} />
        </div>

        <div>
          <label className="text-sm">إلى</label>
          <input type="datetime-local" className="border rounded-xl p-2 w-full" value={endAt} onChange={e=>setEndAt(e.target.value)} />
        </div>

        <div>
          <label className="text-sm">العدد</label>
          <input type="number" min={1} className="border rounded-xl p-2 w-full" value={qty} onChange={e=>setQty(e.target.value as any)} />
          {available !== null && <div className="text-xs mt-1">المتاح: <b>{available}</b></div>}
        </div>

        <div className="md:col-span-3 md:text-end">
          {canBook
            ? <LoadingButton loading={saving} onClick={saveReservation}><span className="w-full md:w-auto inline-block">حجز</span></LoadingButton>
            : <div className="text-xs text-amber-600">ليس لديك صلاحية للحجز</div>
          }
        </div>
      </div>

      {/* ✅ جدول الحجوزات — Scroll أفقي على الموبايل */}
      <div className="rounded-2xl border">
        <div className="block overflow-x-auto" dir="ltr" style={{ WebkitOverflowScrolling: 'touch' as any }}>
          <table className="table-auto w-full min-w-[720px] text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الأداة</th>
                <th className="p-2 text-center">العدد</th>
                <th className="p-2 text-start">من</th>
                <th className="p-2 text-start">إلى</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {list.map(r => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">{matMap.get(r.material_id)?.name || '—'}</td>
                  <td className="p-2 text-center">{r.qty}</td>
                  <td className="p-2">{fmt(r.starts_at)}</td>
                  <td className="p-2">{fmt(r.ends_at)}</td>
                  <td className="p-2 text-end">
                    <button className="btn border text-xs w-full md:w-auto" onClick={()=>cancelReservation(r.id)}>إلغاء</button>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td className="p-3 text-center text-gray-500" colSpan={5}>لا توجد حجوزات</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
