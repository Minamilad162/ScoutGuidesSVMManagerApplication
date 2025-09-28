
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { LoadingButton } from '../components/ui/LoadingButton'
import { useToast } from '../components/ui/Toaster'
import { useRoleGate } from '../hooks/useRoleGate'

type Material = { id: string; name: string; description: string | null; total_qty: number; active: boolean; storage_location_id: string | null, storage_locations?: { name: string } }
type StorLoc = { id: string; name: string; description: string | null; active: boolean }
type Zone = { id: string; name: string; active: boolean }

export default function MaterialsAdmin() {
  const toast = useToast()
  const gate = useRoleGate()

  const [loading, setLoading] = useState(true)

  const [materials, setMaterials] = useState<Material[]>([])
  const [storLocs, setStorLocs] = useState<StorLoc[]>([])
  const [zones, setZones] = useState<Zone[]>([])

  // new/edit material
  const [mName, setMName] = useState('')
  const [mQty, setMQty] = useState<number | ''>('')
  const [mStor, setMStor] = useState<string>('')
  const [mDesc, setMDesc] = useState('')
  const [savingM, setSavingM] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  // new stor loc
  const [sName, setSName] = useState('')
  const [sDesc, setSDesc] = useState('')
  const [savingS, setSavingS] = useState(false)

  // new zone
  const [zName, setZName] = useState('')
  const [savingZ, setSavingZ] = useState(false)

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const [{ data: mats, error: me }, { data: sl, error: se }, { data: zs, error: ze }] = await Promise.all([
        supabase.from('materials').select('id,name,description,total_qty,active,storage_location_id, storage_locations:storage_location_id(name)').order('name'),
        supabase.from('storage_locations').select('id,name,description,active').order('name'),
        supabase.from('field_zones').select('id,name,active').order('name')
      ])
      if (me) throw me
      if (se) throw se
      if (ze) throw ze
      setMaterials((mats as any) ?? [])
      setStorLocs((sl as any) ?? [])
      setZones((zs as any) ?? [])
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الداتا')
    } finally {
      setLoading(false)
    }
  }

  function resetMaterialForm() {
    setEditId(null); setMName(''); setMQty(''); setMStor(''); setMDesc('')
  }

  async function saveMaterial() {
    if (!gate.canManageInventory()) { toast.error('ليست لديك صلاحية إدارة المخزون'); return }
    if (!mName.trim()) return toast.error('ادخل اسم الأداة')
    const qty = Number(mQty)
    if (!isFinite(qty) || qty < 0) return toast.error('الكمية غير صالحة')

    setSavingM(true)
    try {
      if (editId) {
        const { error } = await supabase.from('materials')
          .update({ name: mName.trim(), total_qty: qty, storage_location_id: mStor || null, description: mDesc || null })
          .eq('id', editId)
        if (error) throw error
        toast.success('تم تعديل الأداة')
      } else {
        const { error } = await supabase.from('materials')
          .insert({ name: mName.trim(), total_qty: qty, storage_location_id: mStor || null, description: mDesc || null })
        if (error) throw error
        toast.success('تم إضافة الأداة')
      }
      resetMaterialForm()
      await init()
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحفظ')
    } finally {
      setSavingM(false)
    }
  }

  async function toggleMaterialActive(id: string, current: boolean) {
    if (!gate.canManageInventory()) return
    const { error } = await supabase.from('materials').update({ active: !current }).eq('id', id)
    if (error) toast.error(error.message); else { toast.success('تم التحديث'); init() }
  }

  async function saveStorLoc() {
    if (!gate.canManageInventory()) { toast.error('ليست لديك صلاحية'); return }
    if (!sName.trim()) return toast.error('ادخل اسم المكان')
    setSavingS(true)
    try {
      const { error } = await supabase.from('storage_locations').insert({ name: sName.trim(), description: sDesc || null })
      if (error) throw error
      setSName(''); setSDesc('')
      toast.success('تم إضافة المكان')
      await init()
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحفظ')
    } finally {
      setSavingS(false)
    }
  }

  async function toggleStorActive(id: string, current: boolean) {
    if (!gate.canManageInventory()) return
    const { error } = await supabase.from('storage_locations').update({ active: !current }).eq('id', id)
    if (error) toast.error(error.message); else { toast.success('تم التحديث'); init() }
  }

  async function saveZone() {
    if (!gate.canManageInventory()) { toast.error('ليست لديك صلاحية'); return }
    if (!zName.trim()) return toast.error('ادخل اسم القطاع')
    setSavingZ(true)
    try {
      const { error } = await supabase.from('field_zones').insert({ name: zName.trim() })
      if (error) throw error
      setZName('')
      toast.success('تم إضافة القطاع')
      await init()
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحفظ')
    } finally {
      setSavingZ(false)
    }
  }

  async function toggleZoneActive(id: string, current: boolean) {
    if (!gate.canManageInventory()) return
    const { error } = await supabase.from('field_zones').update({ active: !current }).eq('id', id)
    if (error) toast.error(error.message); else { toast.success('تم التحديث'); init() }
  }

  return (
    <div className="p-6 space-y-8">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">إدارة الأدوات والأماكن (أدمن/مسؤول عام)</h1>
      {!gate.canManageInventory() && <div className="text-sm text-amber-700">عرض فقط — يسمح بالإدارة للأدمن أو المسؤول العام للأدوات.</div>}

      {/* Materials */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">الأدوات</h2>

        <div className="grid md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="text-sm">اسم الأداة</label>
            <input className="border rounded-xl p-2 w-full" value={mName} onChange={e=>setMName(e.target.value)} placeholder="مثلاً: حبل، خيمة..." />
          </div>
          <div>
            <label className="text-sm">الكمية</label>
            <input type="number" min={0} className="border rounded-xl p-2 w-full" value={mQty} onChange={e=>setMQty(e.target.value as any)} />
          </div>
          <div>
            <label className="text-sm">مكان التخزين</label>
            <select className="border rounded-xl p-2 w-full cursor-pointer" value={mStor} onChange={e=>setMStor(e.target.value)}>
              <option value="">— بدون —</option>
              {storLocs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-4">
            <label className="text-sm">الوصف</label>
            <input className="border rounded-xl p-2 w-full" value={mDesc} onChange={e=>setMDesc(e.target.value)} />
          </div>
          <div className="md:col-span-4 flex gap-2 justify-end">
            <LoadingButton loading={savingM} onClick={saveMaterial}>{editId ? 'تعديل' : 'إضافة'}</LoadingButton>
            {editId && <button className="btn border" onClick={resetMaterialForm}>إلغاء التعديل</button>}
          </div>
        </div>

        <div className="border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الأداة</th>
                <th className="p-2 text-start">المكان</th>
                <th className="p-2 text-center">الكمية</th>
                <th className="p-2 text-center">الحالة</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {materials.map(m => (
                <tr key={m.id} className="border-t">
                  <td className="p-2">
                    <div className="font-medium">{m.name}</div>
                    {m.description && <div className="text-xs text-gray-500">{m.description}</div>}
                  </td>
                  <td className="p-2">{m.storage_locations?.name || '—'}</td>
                  <td className="p-2 text-center">{m.total_qty}</td>
                  <td className="p-2 text-center">
                    <button
                      className={`px-2 py-1 rounded-xl text-xs border ${m.active?'bg-emerald-50 border-emerald-200':'bg-gray-50'}`}
                      onClick={()=>toggleMaterialActive(m.id, m.active)}
                      disabled={!gate.canManageInventory()}
                    >
                      {m.active ? 'مفعّل' : 'موقوف'}
                    </button>
                  </td>
                  <td className="p-2 text-end">
                    <button className="btn border text-xs"
                      onClick={()=>{ setEditId(m.id); setMName(m.name); setMQty(m.total_qty); setMStor(m.storage_location_id || ''); setMDesc(m.description || '') }}>
                      تعديل
                    </button>
                  </td>
                </tr>
              ))}
              {materials.length === 0 && <tr><td colSpan={5} className="p-3 text-center text-gray-500">لا توجد أدوات</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Storage locations */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">أماكن التخزين (دواليب/خزائن)</h2>
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <label className="text-sm">الاسم</label>
            <input className="border rounded-xl p-2 w-full" value={sName} onChange={e=>setSName(e.target.value)} placeholder="Cupboard A" />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm">الوصف</label>
            <input className="border rounded-xl p-2 w-full" value={sDesc} onChange={e=>setSDesc(e.target.value)} />
          </div>
          <div className="md:col-span-3 flex justify-end">
            <LoadingButton loading={savingS} onClick={saveStorLoc}>إضافة المكان</LoadingButton>
          </div>
        </div>

        <div className="border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الاسم</th>
                <th className="p-2 text-start">الوصف</th>
                <th className="p-2 text-center">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {storLocs.map(s => (
                <tr key={s.id} className="border-t">
                  <td className="p-2">{s.name}</td>
                  <td className="p-2">{s.description || '—'}</td>
                  <td className="p-2 text-center">
                    <button className={`px-2 py-1 rounded-xl text-xs border ${s.active?'bg-emerald-50 border-emerald-200':'bg-gray-50'}`}
                      onClick={()=>toggleStorActive(s.id, s.active)} disabled={!gate.canManageInventory()}>
                      {s.active ? 'مفعّل' : 'موقوف'}
                    </button>
                  </td>
                </tr>
              ))}
              {storLocs.length === 0 && <tr><td colSpan={3} className="p-3 text-center text-gray-500">لا توجد أماكن</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Field zones */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">قطاعات الأرض</h2>
        <div className="grid md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="text-sm">اسم القطاع</label>
            <input className="border rounded-xl p-2 w-full" value={zName} onChange={e=>setZName(e.target.value)} placeholder="A1 / B2 ..." />
          </div>
          <div className="md:col-span-1 flex items-end justify-end">
            <LoadingButton loading={savingZ} onClick={saveZone}>إضافة قطاع</LoadingButton>
          </div>
        </div>

        <div className="border rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الاسم</th>
                <th className="p-2 text-center">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {zones.map(s => (
                <tr key={s.id} className="border-t">
                  <td className="p-2">{s.name}</td>
                  <td className="p-2 text-center">
                    <button className={`px-2 py-1 rounded-xl text-xs border ${s.active?'bg-emerald-50 border-emerald-200':'bg-gray-50'}`}
                      onClick={()=>toggleZoneActive(s.id, s.active)} disabled={!gate.canManageInventory()}>
                      {s.active ? 'مفعّل' : 'موقوف'}
                    </button>
                  </td>
                </tr>
              ))}
              {zones.length === 0 && <tr><td colSpan={2} className="p-3 text-center text-gray-500">لا توجد قطاعات</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
