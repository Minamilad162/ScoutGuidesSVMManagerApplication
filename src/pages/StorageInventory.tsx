import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'

type StorageLocation = {
  id: string
  name: string
  description: string | null
}

type Material = {
  id: string
  name: string
  description: string | null
  total_qty: number | null
  storage_location_id: string | null
}

type Group = {
  id: string | null
  name: string
  description: string | null
  items: Material[]
  totalPieces: number
}

function cls(...xs: (string | false | undefined)[]) {
  return xs.filter(Boolean).join(' ')
}

export default function StorageInventory() {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [locations, setLocations] = useState<StorageLocation[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    refresh()
  }, [])

  async function refresh() {
    setLoading(true)
    try {
      const [{ data: locs, error: e1 }, { data: mats, error: e2 }] = await Promise.all([
        supabase.from('storage_locations').select('id,name,description').order('name', { ascending: true }),
        supabase.from('materials').select('id,name,description,total_qty,storage_location_id').order('name', { ascending: true }),
      ])
      if (e1) throw e1
      if (e2) throw e2
      setLocations((locs as any) ?? [])
      setMaterials((mats as any) ?? [])
    } catch (e: any) {
      toast.error(e.message || 'تعذر تحميل المخازن/الأدوات')
    } finally {
      setLoading(false)
    }
  }

  const groups = useMemo<Group[]>(() => {
    const byId = new Map<string, Group>()

    // حط كل المخازن المعروفة (حتى لو فاضية)
    locations.forEach((l) => {
      byId.set(l.id, { id: l.id, name: l.name, description: l.description, items: [], totalPieces: 0 })
    })

    // أدوات غير مخصصة لمكان
    const unassignedKey = '__unassigned__'
    const ensureUnassigned = () => {
      if (!byId.has(unassignedKey)) {
        byId.set(unassignedKey, {
          id: null,
          name: 'غير مخصّص',
          description: 'أدوات بدون مكان تخزين محدد',
          items: [],
          totalPieces: 0,
        })
      }
    }

    // وزّع الأدوات على المجموعات
    materials.forEach((m) => {
      const qty = Number(m.total_qty ?? 0)
      if (m.storage_location_id && byId.has(m.storage_location_id)) {
        const g = byId.get(m.storage_location_id)!
        g.items.push(m)
        g.totalPieces += qty
      } else {
        // غير مخصّص
        ensureUnassigned()
        const g = byId.get(unassignedKey)!
        g.items.push(m)
        g.totalPieces += qty
      }
    })

    // حوّلها لمصفوفة مرتّبة (الإسم)
    const arr = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'ar'))

    // فلترة بالبحث (على اسم المخزن أو اسم الأداة)
    if (search.trim()) {
      const s = search.toLowerCase()
      return arr
        .map((g) => {
          const matchGroup = g.name.toLowerCase().includes(s) || (g.description ?? '').toLowerCase().includes(s)
          const filteredItems = matchGroup
            ? g.items
            : g.items.filter(
                (it) =>
                  it.name.toLowerCase().includes(s) ||
                  (it.description ?? '').toLowerCase().includes(s)
              )
          const totalPieces = filteredItems.reduce((sum, it) => sum + Number(it.total_qty ?? 0), 0)
          return { ...g, items: filteredItems, totalPieces }
        })
        .filter((g) => g.items.length > 0 || g.name.toLowerCase().includes(s))
    }

    return arr
  }, [locations, materials, search])

  const grandTotalPieces = useMemo(
    () => groups.reduce((sum, g) => sum + g.totalPieces, 0),
    [groups]
  )
  const grandTotalItems = useMemo(
    () => groups.reduce((sum, g) => sum + g.items.length, 0),
    [groups]
  )

  return (
    <div className="p-6 space-y-5">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold">جرد أماكن التخزين</h1>
        <div className="flex items-center gap-2">
          <input
            className="border rounded-xl p-2 w-[240px]"
            placeholder="ابحث (مخزن/أداة)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn border" onClick={refresh}>تحديث</button>
        </div>
      </div>

      {/* ملخّص سريع */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">عدد المخازن</div>
          <div className="text-2xl font-extrabold">{locations.length}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">عدد الأصناف</div>
          <div className="text-2xl font-extrabold">{grandTotalItems}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">إجمالي القطع</div>
          <div className="text-2xl font-extrabold">{grandTotalPieces}</div>
        </div>
      </div>

      {/* الجدول */}
      <div className="rounded-2xl border">
        <div className="block overflow-x-auto" dir="ltr" style={{ WebkitOverflowScrolling: 'touch' as any }}>
          <table className="table-auto w-full min-w-[900px] text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start w-[240px]">مكان التخزين</th>
                <th className="p-2 text-start">الوصف</th>
                <th className="p-2 text-start">الأدوات (الإسم × الكمية)</th>
                <th className="p-2 text-center w-[120px]">إجمالي القطع</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id ?? 'unassigned'} className="border-t align-top">
                  <td className="p-2 font-semibold">{g.name}</td>
                  <td className="p-2 text-gray-600">{g.description || '—'}</td>
                  <td className="p-2">
                    {g.items.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {g.items.map((m) => (
                          <span
                            key={m.id}
                            className={cls(
                              'px-2 py-1 rounded-full border bg-white text-xs',
                              Number(m.total_qty ?? 0) === 0 && 'opacity-60'
                            )}
                            title={m.description || ''}
                          >
                            {m.name} <b dir="ltr">×{Number(m.total_qty ?? 0)}</b>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-500">لا توجد أدوات</span>
                    )}
                  </td>
                  <td className="p-2 text-center font-semibold">{g.totalPieces}</td>
                </tr>
              ))}
              {groups.length === 0 && (
                <tr>
                  <td className="p-3 text-center text-gray-500" colSpan={4}>
                    لا توجد بيانات لعرضها
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
