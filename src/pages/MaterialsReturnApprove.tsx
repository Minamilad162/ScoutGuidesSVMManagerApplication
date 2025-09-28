// src/pages/MaterialsReturnApprove.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ui/Toaster'
import { PageLoader } from '../components/ui/PageLoader'
import { LoadingButton } from '../components/ui/LoadingButton'
import { useAuth } from '../components/AuthProvider'

type RoleRow = { role_slug: string; team_id?: string | null }

type DueItem = {
  reservation_id: string
  team_id: string
  due_date: string | null
  material_id: string
  material_name: string
  qty: number
}

type ApprovalRow = {
  reservation_id: string
  qty_returned: number
  note: string | null
  approved_at: string
}

type Team = { id: string; name: string }

function todayCairoYYYYMMDD() {
  // نفترض المتصفح على توقيت القاهرة. لو لأ، ممكن تثبّت +02:00 هنا.
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth()+1).padStart(2,'0')
  const dd = String(d.getDate()).padStart(2,'0')
  return `${y}-${m}-${dd}`
}

function cairoRangeISO(dateStr: string) {
  // نحسب حدود اليوم بتوقيت القاهرة (+02:00) ونحوّل لـ ISO (UTC) عشان فلاتر Supabase
  const start = new Date(`${dateStr}T00:00:00+02:00`)
  const end   = new Date(`${dateStr}T23:59:59.999+02:00`)
  return { from: start.toISOString(), to: end.toISOString() }
}

export default function MaterialsReturnApprove() {
  const toast = useToast()
  const { roles, user } = useAuth()

  const isAdmin = roles.some((r: RoleRow) => r.role_slug === 'admin')
  const globalMaterials = roles.some((r: RoleRow) => r.role_slug === 'responsable_materials' && (r.team_id == null))
  const teamMaterialsIds = roles
    .filter((r: RoleRow) => r.role_slug === 'responsable_materials' && r.team_id != null)
    .map(r => String(r.team_id))
  const canSeeAllTeams = isAdmin || globalMaterials

  const [loading, setLoading] = useState(true)
  const [teamsMap, setTeamsMap] = useState<Map<string, string>>(new Map())

  // فلتر التاريخ
  const [filterDate, setFilterDate] = useState<string>(todayCairoYYYYMMDD())

  // بيانات
  const [dueItems, setDueItems] = useState<DueItem[]>([])
  const [approvals, setApprovals] = useState<Map<string, ApprovalRow>>(new Map()) // key = reservation_id

  // فلتر الفريق
  const teamIdsInData = useMemo(() => Array.from(new Set(dueItems.map(d => d.team_id))), [dueItems])
  const [filterTeamId, setFilterTeamId] = useState<string>('all')

  // تعديل
  const [editReservationId, setEditReservationId] = useState<string>('')
  const [editQty, setEditQty] = useState<number | ''>('')
  const [editNote, setEditNote] = useState<string>('')

  const [saving, setSaving] = useState(false)
  const [unapprovingId, setUnapprovingId] = useState<string>('')

  // تنبيهات
  const [sendingNotif, setSendingNotif] = useState(false)

  useEffect(() => { init() }, [])
  useEffect(() => { loadByDate(filterDate) }, [filterDate]) // لما التاريخ يتغيّر

  async function init() {
    setLoading(true)
    try {
      await loadTeams()
      await loadByDate(filterDate)
    } catch (e: any) {
      toast.error(e.message || 'تعذر تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }

  async function loadTeams() {
    const { data, error } = await supabase.from('teams').select('id,name')
    if (error) throw error
    setTeamsMap(new Map((data ?? []).map((t: Team) => [t.id, t.name])))
  }

  async function loadByDate(dateStr: string) {
    const { from, to } = cairoRangeISO(dateStr)

    // حجوزات اليوم المحدد
    const { data, error } = await supabase
      .from('material_reservations')
      .select('id, team_id, ends_at, material_id, qty')
      .gte('ends_at', from)
      .lte('ends_at', to)
    if (error) throw error

    let rows = (data ?? []) as any[]

    // فلترة صلاحيات العرض على الواجهة (مسؤول عهدة فريقه فقط)
    if (!canSeeAllTeams) {
      rows = rows.filter(r => teamMaterialsIds.includes(String(r.team_id)))
    }

    // هات أسماء الأدوات
    const matIds = Array.from(new Set(rows.map(r => r.material_id))).filter(Boolean)
    const nameMap = new Map<string, string>()
    if (matIds.length) {
      const { data: mats, error: merr } = await supabase
        .from('materials').select('id, name').in('id', matIds)
      if (merr) throw merr
      for (const m of (mats ?? []) as any[]) {
        nameMap.set(String(m.id), m.name || '')
      }
    }

    const items: DueItem[] = rows.map(r => ({
      reservation_id: r.id,
      team_id: r.team_id,
      due_date: r.ends_at,
      material_id: r.material_id,
      material_name: nameMap.get(String(r.material_id)) || String(r.material_id),
      qty: Number(r.qty) || 0
    }))
    setDueItems(items)

    // الموافقات
    const ids = items.map(i => i.reservation_id)
    if (ids.length) {
      const { data: ap, error: aerr } = await supabase
        .from('material_return_approvals')
        .select('reservation_id, qty_returned, note, approved_at')
        .in('reservation_id', ids)
        .is('soft_deleted_at', null)
      if (aerr) throw aerr
      const map = new Map<string, ApprovalRow>()
      for (const r of (ap ?? []) as any[]) map.set(r.reservation_id, r as ApprovalRow)
      setApprovals(map)
    } else {
      setApprovals(new Map())
    }
  }

  // تجميع العرض: Team -> Date -> Reservations
  const grouped = useMemo(() => {
    const source = filterTeamId === 'all' ? dueItems : dueItems.filter(d => d.team_id === filterTeamId)

    const sorted = source.slice().sort((a, b) => {
      const ta = teamsMap.get(a.team_id) || '', tb = teamsMap.get(b.team_id) || ''
      if (ta !== tb) return ta.localeCompare(tb, 'ar')
      const da = (a.due_date || ''), db = (b.due_date || '')
      if (da !== db) return da.localeCompare(db)
      const na = a.material_name || '', nb = b.material_name || ''
      if (na !== nb) return na.localeCompare(nb, 'ar')
      return a.reservation_id.localeCompare(b.reservation_id)
    })

    type TeamBlock = {
      team_id: string
      team_name: string
      dates: Array<{ due_date: string | null; reservations: DueItem[] }>
    }
    const out: TeamBlock[] = []
    let i = 0
    while (i < sorted.length) {
      const curTeam = sorted[i].team_id
      const team_name = teamsMap.get(curTeam) || '—'
      const block: TeamBlock = { team_id: curTeam, team_name, dates: [] }
      let j = i
      while (j < sorted.length && sorted[j].team_id === curTeam) {
        const curDate = sorted[j].due_date
        const items: DueItem[] = []
        let k = j
        while (k < sorted.length && sorted[k].team_id === curTeam && sorted[k].due_date === curDate) {
          items.push(sorted[k]); k++
        }
        block.dates.push({ due_date: curDate, reservations: items })
        j = k
      }
      out.push(block); i = j
    }
    return out
  }, [dueItems, filterTeamId, teamsMap])

  function startEdit(item: DueItem) {
    setEditReservationId(item.reservation_id)
    const ap = approvals.get(item.reservation_id)
    setEditQty(typeof ap?.qty_returned === 'number' ? ap!.qty_returned : item.qty)
    setEditNote(ap?.note || '')
  }
  function cancelEdit() { setEditReservationId(''); setEditQty(''); setEditNote('') }

  async function saveApproval(item: DueItem) {
    const qtyNum = Number(editQty)
    if (!isFinite(qtyNum) || qtyNum < 0) return toast.error('كمية مرتجعة غير صالحة')
    if (qtyNum > Number(item.qty)) return toast.error('الكمية المرتجعة أكبر من المحجوزة')

    setSaving(true)
    try {
      if (!user?.id) { toast.error('غير مسجّل الدخول'); return }

      const payload = {
        reservation_id: item.reservation_id,
        qty_returned: qtyNum,
        note: (editNote || '').trim(),
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        soft_deleted_at: null
      }

      const { error } = await supabase
        .from('material_return_approvals')
        .upsert([payload], { onConflict: 'reservation_id' })
      if (error) throw error

      toast.success('تم حفظ الاعتماد')
      cancelEdit()
      await loadByDate(filterDate)
    } catch (e: any) {
      toast.error(e.message || 'تعذر حفظ الاعتماد')
    } finally {
      setSaving(false)
    }
  }

  async function unapprove(item: DueItem) {
    setUnapprovingId(item.reservation_id)
    try {
      const { error } = await supabase
        .from('material_return_approvals')
        .update({ soft_deleted_at: new Date().toISOString() })
        .eq('reservation_id', item.reservation_id)
        .is('soft_deleted_at', null)
      if (error) throw error
      toast.success('تم إلغاء الاعتماد')
      await loadByDate(filterDate)
    } catch (e: any) {
      toast.error(e.message || 'تعذر إلغاء الاعتماد')
    } finally {
      setUnapprovingId('')
    }
  }

  

  async function runOverdueNotifications() {
    setSendingNotif(true)
    try {
      const { error } = await supabase.rpc('send_overdue_material_returns', { force: true })
      if (error) throw error
      toast.success('تم تشغيل فحص التنبيهات')
    } catch (e: any) {
      toast.error(e.message || 'تعذر تشغيل الفحص')
    } finally {
      setSendingNotif(false)
    }
  }

  if (loading) return <PageLoader visible text="جارِ التحميل..." />

  const showTeamFilter = (canSeeAllTeams || teamIdsInData.length > 1)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">اعتماد تسليم الأدوات</h1>
        {(isAdmin || globalMaterials) && (
          <LoadingButton loading={sendingNotif} onClick={runOverdueNotifications}>
            {sendingNotif ? 'جارِ التشغيل...' : 'تشغيل تنبيهات التأخير الآن'}
          </LoadingButton>
        )}
      </div>

      {/* Filters */}
      <div className="grid md:grid-cols-3 gap-3 items-end">
        <div>
          <label className="text-sm">التاريخ</label>
          <input
            type="date"
            className="border rounded-xl p-2 w-full"
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
          />
        </div>

        {showTeamFilter && (
          <div>
            <label className="text-sm">فريق</label>
            <select
              className="border rounded-xl p-2 w-full"
              value={filterTeamId}
              onChange={e => setFilterTeamId(e.target.value)}
            >
              <option value="all">الكل</option>
              {Array.from(new Set(teamIdsInData)).map(tid => (
                <option key={tid} value={tid}>{teamsMap.get(tid) || tid}</option>
              ))}
            </select>
          </div>
        )}

        <div className="text-end">
          <button className="btn border rounded-xl px-4 py-2" onClick={() => loadByDate(filterDate)}>تحديث</button>
        </div>
      </div>

      {/* Content */}
      {grouped.length === 0 ? (
        <div className="text-gray-600 text-sm">لا توجد حجوزات في هذا التاريخ.</div>
      ) : (
        <div className="space-y-6">
          {grouped.map(team => (
            <div key={team.team_id} className="border rounded-2xl">
              <div className="p-3 font-semibold bg-gray-50 rounded-t-2xl">
                الفريق: {team.team_name}
              </div>

              {team.dates.map(dateBlock => (
                <div key={team.team_id + (dateBlock.due_date || '')} className="border-t">
                  <div className="px-3 py-2 text-sm text-gray-700 bg-gray-50 flex items-center justify-between">
                    <div>تاريخ الاستحقاق: {dateBlock.due_date ? String(dateBlock.due_date).slice(0, 10) : '—'}</div>
                    <div>عدد البنود: {dateBlock.reservations.length}</div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="p-2 text-start">الحجز</th>
                          <th className="p-2 text-start">الأداة</th>
                          <th className="p-2 text-center">المحجوز</th>
                          <th className="p-2 text-center">المعتمد</th>
                          <th className="p-2 text-start">ملاحظة</th>
                          <th className="p-2 text-center">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dateBlock.reservations.map(item => {
                          const ap = approvals.get(item.reservation_id)
                          const isEditing = editReservationId === item.reservation_id
                          const approved = !!ap
                          return (
                            <tr key={item.reservation_id} className="border-t">
                              <td className="p-2">{item.reservation_id}</td>
                              <td className="p-2">{item.material_name}</td>
                              <td className="p-2 text-center">{Number(item.qty)}</td>
                              <td className="p-2 text-center">
                                {!isEditing ? (
                                  approved ? Number(ap!.qty_returned) : '—'
                                ) : (
                                  <input
                                    type="number"
                                    min={0}
                                    max={Number(item.qty)}
                                    step={0.01}
                                    className="border rounded p-1 w-28 text-center"
                                    value={editQty}
                                    onChange={e => setEditQty(e.target.value as any)}
                                  />
                                )}
                              </td>
                              <td className="p-2">
                                {!isEditing ? (
                                  ap?.note || '—'
                                ) : (
                                  <input
                                    className="border rounded p-1 w-full"
                                    value={editNote}
                                    onChange={e => setEditNote(e.target.value)}
                                    placeholder="اختياري"
                                  />
                                )}
                              </td>
                              <td className="p-2 text-center">
                                {!isEditing ? (
                                  <div className="flex gap-2 justify-center">
                                    <button className="text-blue-600 hover:underline" onClick={() => startEdit(item)}>
                                      {approved ? 'تعديل' : 'اعتماد'}
                                    </button>
                                    {approved && (
                                      <button
                                        className="text-rose-600 hover:underline disabled:opacity-50"
                                        onClick={() => unapprove(item)}
                                        disabled={unapprovingId === item.reservation_id}
                                      >
                                        {unapprovingId === item.reservation_id ? 'جارٍ الإلغاء...' : 'إلغاء الاعتماد'}
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <div className="flex gap-2 justify-center">
                                    <button className="text-green-600 hover:underline disabled:opacity-50" onClick={() => saveApproval(item)} disabled={saving}>
                                      حفظ
                                    </button>
                                    <button className="text-gray-600 hover:underline" onClick={cancelEdit}>
                                      إلغاء
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
