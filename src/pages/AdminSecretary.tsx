import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'
import { useAuth } from '../components/AuthProvider'
import { LoadingButton } from '../components/ui/LoadingButton'

type Team = { id: string; name: string }
type Term = { id: string; name: string; year: number; start_date: string|null; end_date: string|null }
type Member = {
  id: string
  auth_user_id: string | null
  full_name: string
  is_equipier: boolean
  personal_phone: string|null
  guardian_name: string|null
  guardian_phone: string|null
  birth_date: string|null
  rank?: { rank_label: string|null } | null
}
type RoleRow = { user_id: string; role_slug: string; team_id: string | null }

type Counts = { present: number; total: number; absent_excused: number; absent_unexcused: number }

export default function AdminSecretary() {
  const toast = useToast()
  const { roles } = useAuth()
  const isAdmin = roles.some(r => r.role_slug === 'admin')
  const isGlobalSec = roles.some(r => r.role_slug === 'responsable_secretary' && (r.team_id === null || r.team_id === undefined))

  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [teams, setTeams] = useState<Team[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [teamId, setTeamId] = useState<string>('')
  const [termId, setTermId] = useState<string>('')
  const [rows, setRows] = useState<Member[]>([])
  const [rolesMap, setRolesMap] = useState<Record<string, RoleRow[]>>({})
  const [att, setAtt] = useState<Record<string, Counts>>({})

  const [edit, setEdit] = useState<Record<string, Partial<Member>>>({})

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const [{ data: ts }, { data: tm }] = await Promise.all([
        supabase.from('teams').select('id,name').order('name'),
        supabase.from('terms').select('id,name,year,start_date,end_date').order('year', { ascending: false }).order('name', { ascending: true })
      ])
      setTeams((ts as any) ?? [])
      setTerms((tm as any) ?? [])
      if (ts && ts.length) setTeamId(ts[0].id)
      if (tm && tm.length) setTermId(tm[0].id)
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally { setLoading(false) }
  }

  useEffect(() => { if (teamId && termId) refresh() }, [teamId, termId])
  async function refresh() {
    setLoading(true)
    try {
      const { data: ms, error: me } = await supabase
        .from('members')
        .select(`
          id, auth_user_id, full_name, is_equipier, personal_phone, guardian_name, guardian_phone, birth_date,
          rank:ranks!left(rank_label)
        `).eq('team_id', teamId)
        .order('is_equipier', { ascending: true })
        .order('full_name', { ascending: true })
      if (me) throw me
      const members = (ms as any[]) ?? []
      setRows(members)

      const userIds = members.map(m => m.auth_user_id).filter(Boolean) as string[]
      if (userIds.length) {
        const { data: ur, error: re } = await supabase
          .from('user_roles_view')
          .select('user_id, role_slug, team_id')
          .in('user_id', userIds)
        if (re) throw re
        const map: Record<string, RoleRow[]> = {}
        ;(ur as RoleRow[] ?? []).forEach(r => {
          members.forEach(m => {
            if (m.auth_user_id === r.user_id) {
              if (!map[m.id]) map[m.id] = []
              map[m.id].push(r)
            }
          })
        })
        setRolesMap(map)
      } else {
        setRolesMap({})
      }

      const term = terms.find(t => t.id === termId)
      const gte = term?.start_date
      const lte = term?.end_date
      if (gte && lte) {
        const { data: attRows, error: ae } = await supabase
          .from('attendance')
          .select(`member_id, is_present, absence_reason, meetings!inner(mtype, meeting_date, team_id)`)
          .eq('meetings.team_id', teamId)
          .eq('meetings.mtype', 'meeting')
          .gte('meetings.meeting_date', gte)
          .lte('meetings.meeting_date', lte)
        if (ae) throw ae
        const map: Record<string, Counts> = {}
        ;(attRows as any[] ?? []).forEach(r => {
          const id = r.member_id as string
          if (!map[id]) map[id] = { present: 0, total: 0, absent_excused: 0, absent_unexcused: 0 }
          map[id].total += 1
          if (r.is_present) map[id].present += 1
          else {
            if (r.absence_reason && String(r.absence_reason).trim() !== '') map[id].absent_excused += 1
            else map[id].absent_unexcused += 1
          }
        })
        setAtt(map)
      } else {
        setAtt({})
      }
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل البيانات')
    } finally { setLoading(false) }
  }

  const chefs = useMemo(() => rows.filter(r => !r.is_equipier), [rows])
  const equipiers = useMemo(() => rows.filter(r => r.is_equipier), [rows])

  const roleChip = (m: Member) => {
    const rr = rolesMap[m.id] || []
    if (rr.length === 0) return <span className="px-2 py-1 rounded-full bg-gray-100 border text-xs">—</span>
    return (
      <div className="flex flex-wrap gap-1">
        {rr.map((x, i) => (
          <span key={i} className="px-2 py-1 rounded-full bg-white border text-xs">
            {x.role_slug.replace(/_/g,' ')} {x.team_id ? '' : '(عام)'}
          </span>
        ))}
      </div>
    )
  }

  async function saveEquipier(m: Member) {
    const e = edit[m.id] || {}
    setSavingId(m.id)
    try {
      const payload: any = {}
      if (typeof e.full_name !== 'undefined') payload.full_name = e.full_name
      if (typeof e.guardian_name !== 'undefined') payload.guardian_name = e.guardian_name
      if (typeof e.guardian_phone !== 'undefined') payload.guardian_phone = e.guardian_phone
      if (typeof e.birth_date !== 'undefined') payload.birth_date = e.birth_date || null
      if (Object.keys(payload).length === 0) { setSavingId(null); return }
      const { error } = await supabase.from('members').update(payload).eq('id', m.id).eq('is_equipier', true)
      if (error) throw error
      toast.success('تم الحفظ')
      setEdit(prev => { const p = { ...prev }; delete p[m.id]; return p })
      await refresh()
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحفظ (تحقق من صلاحيات RLS)')
    } finally {
      setSavingId(null)
    }
  }

  async function deleteEquipier(m: Member) {
    if (!confirm(`هل أنت متأكد من حذف ${m.full_name}؟`)) return
    setDeletingId(m.id)
    try {
      const { error } = await supabase.from('members').delete().eq('id', m.id).eq('is_equipier', true)
      if (error) throw error
      toast.success('تم الحذف')
      await refresh()
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحذف (تحقق من صلاحيات RLS)')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />
      <h1 className="text-xl font-bold">السيكرتارية — عرض وإدارة (أدمن/مسؤول عام)</h1>

      {/* فلاتر أعلى الصفحة — مرنة */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 items-end">
        <div className="min-w-0">
          <label className="text-sm">الفريق</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={teamId} onChange={e=>setTeamId(e.target.value)}>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label className="text-sm">الترم</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={termId} onChange={e=>setTermId(e.target.value)}>
            {terms.map(t => <option key={t.id} value={t.id}>{t.year} — {t.name}</option>)}
          </select>
        </div>
      </div>

      {/* القادة */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">القادة (Chefs)</h2>
        <div
          className="rounded-2xl border overflow-x-auto"
          dir="ltr"
          style={{ WebkitOverflowScrolling: 'touch' as any }}
        >
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الاسم</th>
                <th className="p-2 text-start">الرتبة</th>
                <th className="p-2 text-start">المسؤوليات</th>
                <th className="p-2 text-start whitespace-nowrap">الهاتف</th>
              </tr>
            </thead>
            <tbody>
              {chefs.map(m => (
                <tr key={m.id} className="border-t">
                  <td className="p-2 break-words">{m.full_name}</td>
                  <td className="p-2">{m.rank?.rank_label || '—'}</td>
                  <td className="p-2">{roleChip(m)}</td>
                  <td className="p-2 whitespace-nowrap">{m.personal_phone || '—'}</td>
                </tr>
              ))}
              {chefs.length === 0 && (
                <tr><td className="p-3 text-center text-gray-500" colSpan={4}>لا يوجد قادة في هذا الفريق</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* الأولاد */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">الأولاد (Equipiers)</h2>
        <div
          className="rounded-2xl border overflow-x-auto"
          dir="ltr"
          style={{ WebkitOverflowScrolling: 'touch' as any }}
        >
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 text-start">الاسم</th>
                <th className="p-2 text-start">ولي الأمر</th>
                <th className="p-2 text-start whitespace-nowrap">هاتف ولي الأمر</th>
                <th className="p-2 text-start whitespace-nowrap">تاريخ الميلاد</th>
                <th className="p-2 text-center whitespace-nowrap">حضور الاجتماعات</th>
                <th className="p-2 text-center whitespace-nowrap">الغياب (بعذر/بدون)</th>
                <th className="p-2 text-center">حفظ</th>
                <th className="p-2 text-center">حذف</th>
              </tr>
            </thead>
            <tbody>
              {equipiers.map(m => {
                const a = att[m.id] || { present: 0, total: 0, absent_excused: 0, absent_unexcused: 0 }
                const e = edit[m.id] || {}
                return (
                  <tr key={m.id} className="border-t align-top">
                    <td className="p-2 align-top">
                      <input
                        className="border rounded-xl p-1 w-full"
                        defaultValue={m.full_name}
                        onChange={ev=>setEdit(p=>({...p, [m.id]: {...p[m.id], full_name: ev.target.value}}))}
                      />
                    </td>
                    <td className="p-2 align-top">
                      <input
                        className="border rounded-xl p-1 w-full"
                        defaultValue={m.guardian_name || ''}
                        onChange={ev=>setEdit(p=>({...p, [m.id]: {...p[m.id], guardian_name: ev.target.value}}))}
                      />
                    </td>
                    <td className="p-2 align-top">
                      <input
                        className="border rounded-xl p-1 w-full"
                        defaultValue={m.guardian_phone || ''}
                        onChange={ev=>setEdit(p=>({...p, [m.id]: {...p[m.id], guardian_phone: ev.target.value}}))}
                      />
                    </td>
                    <td className="p-2 align-top">
                      <input
                        type="date"
                        className="border rounded-xl p-1 w-full"
                        defaultValue={m.birth_date || ''}
                        onChange={ev=>setEdit(p=>({...p, [m.id]: {...p[m.id], birth_date: ev.target.value}}))}
                      />
                    </td>
                    <td className="p-2 text-center align-top">
                      <span className="px-2 py-1 rounded-full bg-white border text-xs">{a.present} من {a.total}</span>
                    </td>
                    <td className="p-2 text-center align-top">
                      <span className="px-2 py-1 rounded-full bg-white border text-xs">{a.absent_excused} / {a.absent_unexcused}</span>
                    </td>
                    <td className="p-2 text-center align-top">
                      <LoadingButton loading={savingId===m.id} onClick={()=>saveEquipier(m)}>حفظ</LoadingButton>
                    </td>
                    <td className="p-2 text-center align-top">
                      <button className="btn border" disabled={deletingId===m.id} onClick={()=>deleteEquipier(m)}>
                        {deletingId===m.id?'...':'حذف'}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {equipiers.length === 0 && (
                <tr><td className="p-3 text-center text-gray-500" colSpan={8}>لا يوجد أولاد في هذا الفريق</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
