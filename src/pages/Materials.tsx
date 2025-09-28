
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'

type Location = { id: string; name: string; description: string | null; active: boolean }
type Material = {
  id: string
  name: string
  description: string | null
  total_qty: number
  active: boolean
  storage_location_id: string | null
  storage_locations?: { name: string } | null
}
type MatRes = {
  id: string
  material_id: string
  team_id: string
  qty: number
  starts_at: string
  ends_at: string
  created_at: string
  soft_deleted_at: string | null
  materials?: { name: string, storage_location_id: string | null, storage_locations?: { name: string } | null } | null
}
type FieldZone = { id: string; name: string; active: boolean }
type FieldRes = {
  id: string
  field_zone_id: string
  team_id: string
  starts_at: string
  ends_at: string
  soft_deleted_at: string | null
  field_zones?: { name: string } | null
}

export default function Materials() {
  const { myTeamId, roles, user } = useAuth()
  const [tab, setTab] = useState<'reservations'|'inventory'|'field'|'locations'>('reservations')

  const isAdmin = useMemo(() => roles.some(r => r.role_slug === 'admin'), [roles])
  const isRM = useMemo(() => roles.some(r => r.role_slug === 'responsable_materials' && (r.team_id === null || r.team_id === myTeamId)), [roles, myTeamId])
  const canManageInventory = isAdmin || isRM
  const canReserve = !!myTeamId // team-scoped users

  // Inventory
  const [materials, setMaterials] = useState<Material[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [mName, setMName] = useState('')
  const [mDesc, setMDesc] = useState('')
  const [mQty, setMQty] = useState<number>(1)
  const [mLoc, setMLoc] = useState<string>('')
  const [mActive, setMActive] = useState(true)
  const [mEditId, setMEditId] = useState<string | null>(null)

  // Reservations (materials)
  const [res, setRes] = useState<MatRes[]>([])
  const [resMaterialId, setResMaterialId] = useState('')
  const [resQty, setResQty] = useState<number>(1)
  const [resStart, setResStart] = useState('')
  const [resEnd, setResEnd] = useState('')
  const [filterQ, setFilterQ] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Field reservations
  const [zones, setZones] = useState<FieldZone[]>([])
  const [fz, setFz] = useState('')
  const [fzStart, setFzStart] = useState('')
  const [fzEnd, setFzEnd] = useState('')
  const [fres, setFres] = useState<FieldRes[]>([])

  useEffect(() => {
    loadInventory()
    loadLocations()
  }, [])

  useEffect(() => {
    if (myTeamId) {
      loadMatReservations()
      loadFieldZones()
      loadFieldRes()
    }
  }, [myTeamId])

  // ---------- Loaders ----------
  async function loadInventory() {
    const { data, error } = await supabase
      .from('materials')
      .select('id, name, description, total_qty, active, storage_location_id, storage_locations(name)')
      .order('active', { ascending: false })
      .order('name', { ascending: true })
    if (error) { setErr(error.message); return }
    setMaterials(
      (data ?? []).map((m: any) => ({
        ...m,
        storage_locations: Array.isArray(m.storage_locations) && m.storage_locations.length > 0
          ? m.storage_locations[0]
          : null
      }))
    )
  }

  async function loadLocations() {
    const { data, error } = await supabase
      .from('storage_locations')
      .select('id, name, description, active')
      .order('active', { ascending: false })
      .order('name', { ascending: true })
    if (error) { setErr(error.message); return }
    setLocations(data ?? [])
  }

  async function loadMatReservations() {
    if (!myTeamId) return
    const { data, error } = await supabase
      .from('material_reservations')
      .select('id, material_id, team_id, qty, starts_at, ends_at, created_at, soft_deleted_at, materials(name, storage_location_id, storage_locations(name))')
      .eq('team_id', myTeamId)
      .is('soft_deleted_at', null)
      .order('starts_at', { ascending: false })
      .limit(100)
    if (error) { setErr(error.message); return }
    setRes(
      (data ?? []).map((r: any) => ({
        ...r,
        materials: Array.isArray(r.materials) && r.materials.length > 0
          ? {
              ...r.materials[0],
              storage_locations: Array.isArray(r.materials[0]?.storage_locations) && r.materials[0]?.storage_locations.length > 0
                ? r.materials[0].storage_locations[0]
                : null
            }
          : null
      }))
    )
  }

  async function loadFieldZones() {
    const { data, error } = await supabase
      .from('field_zones')
      .select('id, name, active')
      .order('active', { ascending: false })
      .order('name', { ascending: true })
    if (error) { setErr(error.message); return }
    setZones(data ?? [])
  }

  async function loadFieldRes() {
    if (!myTeamId) return
    const { data, error } = await supabase
      .from('field_reservations')
      .select('id, field_zone_id, team_id, starts_at, ends_at, soft_deleted_at, field_zones(name)')
      .eq('team_id', myTeamId)
      .is('soft_deleted_at', null)
      .order('starts_at', { ascending: false })
      .limit(100)
    if (error) { setErr(error.message); return }
    setFres(
      (data ?? []).map((fr: any) => ({
        ...fr,
        field_zones: Array.isArray(fr.field_zones) && fr.field_zones.length > 0
          ? fr.field_zones[0]
          : null
      }))
    )
  }

  // ---------- Inventory CRUD ----------
  async function saveMaterial() {
    setErr(null); setMsg(null)
    if (!canManageInventory) { setErr('ليس لديك صلاحية'); return }
    if (!mName) { setErr('اكتب اسم الأداة'); return }
    const payload: any = {
      name: mName,
      description: mDesc || null,
      total_qty: Number(mQty),
      active: mActive,
      storage_location_id: mLoc || null,
      created_by: user?.id
    }
    if (mEditId) {
      const { error } = await supabase.from('materials').update(payload).eq('id', mEditId)
      if (error) { setErr(error.message); return }
      setMsg('تم تحديث الأداة')
    } else {
      const { error } = await supabase.from('materials').insert(payload).single()
      if (error) { setErr(error.message); return }
      setMsg('تم إضافة الأداة')
    }
    setMEditId(null); setMName(''); setMDesc(''); setMQty(1); setMLoc(''); setMActive(true)
    await loadInventory()
  }

  function editMaterial(m: Material) {
    setMEditId(m.id)
    setMName(m.name)
    setMDesc(m.description ?? '')
    setMQty(m.total_qty)
    setMLoc(m.storage_location_id ?? '')
    setMActive(m.active)
  }

  // ---------- Locations CRUD (Admin/RM) ----------
  const [locName, setLocName] = useState('')
  const [locDesc, setLocDesc] = useState('')
  const [locActive, setLocActive] = useState(true)
  const [locEditId, setLocEditId] = useState<string | null>(null)

  async function saveLocation() {
    setErr(null); setMsg(null)
    if (!canManageInventory) { setErr('ليس لديك صلاحية'); return }
    if (!locName) { setErr('اكتب اسم الدولاب/المكان'); return }
    const payload: any = { name: locName, description: locDesc || null, active: locActive }
    if (locEditId) {
      const { error } = await supabase.from('storage_locations').update(payload).eq('id', locEditId)
      if (error) { setErr(error.message); return }
      setMsg('تم تحديث المكان')
    } else {
      const { error } = await supabase.from('storage_locations').insert(payload).single()
      if (error) { setErr(error.message); return }
      setMsg('تم إضافة المكان')
    }
    setLocEditId(null); setLocName(''); setLocDesc(''); setLocActive(true)
    await loadLocations()
    await loadInventory()
  }

  function editLocation(l: Location) {
    setLocEditId(l.id)
    setLocName(l.name)
    setLocDesc(l.description ?? '')
    setLocActive(l.active)
  }

  // ---------- Material Reservations ----------
  function toISO(dtLocal: string) {
    // datetime-local -> ISO
    if (!dtLocal) return ''
    const d = new Date(dtLocal)
    return d.toISOString()
  }

  async function createReservation() {
    setErr(null); setMsg(null)
    if (!canReserve || !myTeamId) { setErr('لا يمكن الحجز بدون فريق'); return }
    if (!resMaterialId) { setErr('اختر الأداة'); return }
    if (!resStart || !resEnd) { setErr('اختر وقت البداية والنهاية'); return }
    const payload = {
      material_id: resMaterialId,
      team_id: myTeamId,
      qty: Number(resQty),
      starts_at: toISO(resStart),
      ends_at: toISO(resEnd),
      created_by: user?.id
    }
    const { error } = await supabase.from('material_reservations').insert(payload).single()
    if (error) { setErr(error.message); return }
    setMsg('تم الحجز')
    setResMaterialId(''); setResQty(1); setResStart(''); setResEnd('')
    await loadMatReservations()
  }

  async function deleteReservation(id: string) {
    const { error } = await supabase.from('material_reservations').update({ soft_deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) { setErr(error.message); return }
    setMsg('تم إلغاء الحجز')
    await loadMatReservations()
  }

  // ---------- Field Reservations ----------
  async function createFieldReservation() {
    setErr(null); setMsg(null)
    if (!canReserve || !myTeamId) { setErr('لا يمكن الحجز بدون فريق'); return }
    if (!fz) { setErr('اختر القطاع'); return }
    if (!fzStart || !fzEnd) { setErr('اختر المدى الزمني'); return }
    const payload = {
      field_zone_id: fz,
      team_id: myTeamId,
      starts_at: toISO(fzStart),
      ends_at: toISO(fzEnd),
      created_by: user?.id
    }
    const { error } = await supabase.from('field_reservations').insert(payload).single()
    if (error) { setErr(error.message); return }
    setMsg('تم حجز القطاع')
    setFz(''); setFzStart(''); setFzEnd('')
    await loadFieldRes()
  }

  async function deleteFieldReservation(id: string) {
    const { error } = await supabase.from('field_reservations').update({ soft_deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) { setErr(error.message); return }
    setMsg('تم إلغاء حجز القطاع')
    await loadFieldRes()
  }

  // ---------- UI ----------
  const selectedMat = materials.find(m => m.id === resMaterialId)
  const selectedMatLoc = selectedMat?.storage_locations?.name || '—'

  return (
    <div className="p-6 space-y-6">
      <div className="tabs">
        <button className={`tab ${tab==='reservations' ? 'tab-active' : ''}`} onClick={()=>setTab('reservations')}>حجوزات الأدوات</button>
        <button className={`tab ${tab==='field' ? 'tab-active' : ''}`} onClick={()=>setTab('field')}>حجز القطاعات</button>
        <button className={`tab ${tab==='inventory' ? 'tab-active' : ''}`} onClick={()=>setTab('inventory')}>المخزون</button>
        <button className={`tab ${tab==='locations' ? 'tab-active' : ''}`} onClick={()=>setTab('locations')}>أماكن التخزين</button>
      </div>

      {msg && <div className="text-green-700 text-sm">{msg}</div>}
      {err && <div className="text-red-600 text-sm">{err}</div>}

      {tab === 'reservations' && (
        <div className="space-y-6">
          <div className="card space-y-3">
            <h2 className="text-lg font-bold">حجز أداة</h2>
            <div className="grid md:grid-cols-5 gap-3">
              <select className="border rounded-xl p-2" value={resMaterialId} onChange={e=>setResMaterialId(e.target.value)}>
                <option value="">— اختر أداة —</option>
                {materials.filter(m => m.active).map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <input type="number" className="border rounded-xl p-2" placeholder="الكمية" value={resQty} onChange={e=>setResQty(Number(e.target.value))} />
              <input type="datetime-local" className="border rounded-xl p-2" value={resStart} onChange={e=>setResStart(e.target.value)} />
              <input type="datetime-local" className="border rounded-xl p-2" value={resEnd} onChange={e=>setResEnd(e.target.value)} />
              <button className="btn btn-brand" onClick={createReservation} disabled={!canReserve}>حجز</button>
            </div>
            <div className="text-sm text-gray-600">مكان الأداة: <b>{selectedMatLoc}</b></div>
            <div className="text-xs text-gray-500">* في حالة التعارض على الوقت/الكمية، سيظهر خطأ من النظام.</div>
          </div>

          <div className="card space-y-3">
            <h3 className="font-semibold">حجوزات فريقك</h3>
            <input className="border rounded-xl p-2" placeholder="ابحث بالاسم..." value={filterQ} onChange={e=>setFilterQ(e.target.value)} />
            <div className="border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2 text-start">الأداة</th>
                    <th className="p-2 text-start">المكان</th>
                    <th className="p-2">الكمية</th>
                    <th className="p-2">من</th>
                    <th className="p-2">إلى</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {res
                    .filter(r => !filterQ || (r.materials?.name ?? '').toLowerCase().includes(filterQ.toLowerCase()))
                    .map(r => (
                      <tr key={r.id} className="border-t">
                        <td className="p-2">{r.materials?.name ?? r.material_id}</td>
                        <td className="p-2">{r.materials?.storage_locations?.name ?? '—'}</td>
                        <td className="p-2 text-center">{r.qty}</td>
                        <td className="p-2">{new Date(r.starts_at).toLocaleString()}</td>
                        <td className="p-2">{new Date(r.ends_at).toLocaleString()}</td>
                        <td className="p-2 text-center">
                          <button className="text-red-600 text-sm" onClick={()=>deleteReservation(r.id)}>إلغاء</button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'field' && (
        <div className="space-y-6">
          <div className="card space-y-3">
            <h2 className="text-lg font-bold">حجز قطاع من الأرض</h2>
            <div className="grid md:grid-cols-5 gap-3">
              <select className="border rounded-xl p-2" value={fz} onChange={e=>setFz(e.target.value)}>
                <option value="">— اختر قطاع —</option>
                {zones.filter(z => z.active).map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
              <input type="datetime-local" className="border rounded-xl p-2" value={fzStart} onChange={e=>setFzStart(e.target.value)} />
              <input type="datetime-local" className="border rounded-xl p-2" value={fzEnd} onChange={e=>setFzEnd(e.target.value)} />
              <div className="col-span-2 flex items-center">
                <button className="btn btn-brand" onClick={createFieldReservation} disabled={!canReserve}>حجز</button>
              </div>
            </div>
            <div className="text-xs text-gray-500">* يمنع التداخل لنفس القطاع تلقائيًا.</div>
          </div>

          <div className="card space-y-3">
            <h3 className="font-semibold">حجوزات القطاعات لفريقك</h3>
            <div className="border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2 text-start">القطاع</th>
                    <th className="p-2">من</th>
                    <th className="p-2">إلى</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {fres.map(fr => (
                    <tr key={fr.id} className="border-t">
                      <td className="p-2">{fr.field_zones?.name ?? fr.field_zone_id}</td>
                      <td className="p-2">{new Date(fr.starts_at).toLocaleString()}</td>
                      <td className="p-2">{new Date(fr.ends_at).toLocaleString()}</td>
                      <td className="p-2 text-center">
                        <button className="text-red-600 text-sm" onClick={()=>deleteFieldReservation(fr.id)}>إلغاء</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'inventory' && (
        <div className="space-y-6">
          <div className="card space-y-3">
            <h2 className="text-lg font-bold">المخزون (لـ Admin/RM)</h2>
            <div className="grid md:grid-cols-5 gap-3">
              <input className="border rounded-xl p-2" placeholder="اسم الأداة" value={mName} onChange={e=>setMName(e.target.value)} />
              <input className="border rounded-xl p-2" placeholder="وصف" value={mDesc} onChange={e=>setMDesc(e.target.value)} />
              <input type="number" className="border rounded-xl p-2" placeholder="الكمية الكلية" value={mQty} onChange={e=>setMQty(Number(e.target.value))} />
              <select className="border rounded-xl p-2" value={mLoc} onChange={e=>setMLoc(e.target.value)}>
                <option value="">— اختر مكان —</option>
                {locations.filter(l => l.active).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <label className="text-sm">
                  <input type="checkbox" checked={mActive} onChange={e=>setMActive(e.target.checked)} /> نشط
                </label>
                <button className="btn btn-brand" onClick={saveMaterial} disabled={!canManageInventory}>{mEditId ? 'تحديث' : 'إضافة'}</button>
              </div>
            </div>
          </div>

          <div className="card space-y-3">
            <h3 className="font-semibold">قائمة الأدوات</h3>
            <div className="border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2 text-start">الاسم</th>
                    <th className="p-2 text-start">الوصف</th>
                    <th className="p-2">الكمية</th>
                    <th className="p-2 text-start">المكان</th>
                    <th className="p-2">نشط</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {materials.map(m => (
                    <tr key={m.id} className="border-t">
                      <td className="p-2">{m.name}</td>
                      <td className="p-2">{m.description ?? ''}</td>
                      <td className="p-2 text-center">{m.total_qty}</td>
                      <td className="p-2">{m.storage_locations?.name ?? '—'}</td>
                      <td className="p-2 text-center">{m.active ? '✓' : '—'}</td>
                      <td className="p-2 text-center">
                        <button className="text-sm" onClick={()=>editMaterial(m)} disabled={!canManageInventory}>تعديل</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'locations' && (
        <div className="space-y-6">
          <div className="card space-y-3">
            <h2 className="text-lg font-bold">أماكن التخزين (Admin/RM)</h2>
            <div className="grid md:grid-cols-4 gap-3">
              <input className="border rounded-xl p-2" placeholder="اسم المكان (دولاب/لوكر)" value={locName} onChange={e=>setLocName(e.target.value)} />
              <input className="border rounded-xl p-2" placeholder="وصف" value={locDesc} onChange={e=>setLocDesc(e.target.value)} />
              <label className="text-sm flex items-center gap-2">
                <input type="checkbox" checked={locActive} onChange={e=>setLocActive(e.target.checked)} /> نشط
              </label>
              <button className="btn btn-brand" onClick={saveLocation} disabled={!canManageInventory}>{locEditId ? 'تحديث' : 'إضافة'}</button>
            </div>
          </div>

          <div className="card space-y-3">
            <h3 className="font-semibold">القائمة</h3>
            <div className="border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2 text-start">الاسم</th>
                    <th className="p-2 text-start">الوصف</th>
                    <th className="p-2">نشط</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map(l => (
                    <tr key={l.id} className="border-t">
                      <td className="p-2">{l.name}</td>
                      <td className="p-2">{l.description ?? ''}</td>
                      <td className="p-2 text-center">{l.active ? '✓' : '—'}</td>
                      <td className="p-2 text-center">
                        <button className="text-sm" onClick={()=>editLocation(l)} disabled={!canManageInventory}>تعديل</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
