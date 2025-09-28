import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'
import { LoadingButton } from '../components/ui/LoadingButton'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'

type Team = { id: string; name: string }
type Rank = { id: number; rank_label: string }
type AuthUser = { id: string; email: string }

type RoleScopeChoice = {
  slug: string
  label: string
  allowGlobal: boolean
  allowTeam: boolean
}

const ROLE_CHOICES: RoleScopeChoice[] = [
  { slug: 'admin',                 label: 'Admin (Chef de mouvement)', allowGlobal: true,  allowTeam: false },
  { slug: 'chef_de_legion',        label: 'Chef de legion',            allowGlobal: true,  allowTeam: true  },
  { slug: 'responsable_finance',   label: 'Responsable Finance',       allowGlobal: true,  allowTeam: true  },
  { slug: 'responsable_materials', label: 'Responsable Materials',     allowGlobal: true,  allowTeam: true  },
  { slug: 'responsable_secretary', label: 'Responsable Secretary',     allowGlobal: true,  allowTeam: true  },
  { slug: 'responsable_media',     label: 'Responsable Media',         allowGlobal: true,  allowTeam: true  },
  { slug: 'normal_chef',           label: 'Normal Chef',               allowGlobal: true,  allowTeam: true  },
  { slug: 'equipier',              label: 'Equipier',                  allowGlobal: false, allowTeam: false },
]

export default function AdminMembers() {
  const { roles } = useAuth()
  const isAdmin = roles.some(r => r.role_slug === 'admin')
  const toast = useToast()

  const [loading, setLoading] = useState(true)

  const [teams, setTeams] = useState<Team[]>([])
  const [ranks, setRanks] = useState<Rank[]>([])

  const [tab, setTab] = useState<'chef'|'equipier'>('chef')

  // Chef form
  const [chefFullName, setChefFullName] = useState('')
  const [chefPhone, setChefPhone] = useState('')
  const [chefTeamId, setChefTeamId] = useState('')
  const [chefRankId, setChefRankId] = useState<number | ''>('')
  const [userSearch, setUserSearch] = useState('')
  const [userResults, setUserResults] = useState<AuthUser[]>([])
  const [selectedUser, setSelectedUser] = useState<AuthUser | null>(null)
  const [chefAvatar, setChefAvatar] = useState<File | null>(null) // ⬅️ جديد

  // Per-role scoped selection
  const [selectedGlobal, setSelectedGlobal] = useState<string[]>([])
  const [selectedTeamRoles, setSelectedTeamRoles] = useState<string[]>([])

  const [savingChef, setSavingChef] = useState(false)
  const [searching, setSearching] = useState(false)

  // Equipier form
  const [eqFullName, setEqFullName] = useState('')
  const [eqTeamId, setEqTeamId] = useState('')
  const [eqGuardianName, setEqGuardianName] = useState('')
  const [eqGuardianPhone, setEqGuardianPhone] = useState('')
  const [eqBirthDate, setEqBirthDate] = useState('')
  const [savingEq, setSavingEq] = useState(false)
const AVATARS_BUCKET = 'avatars';

// لو الباكت مش موجودة هيرجع null وينبّه فقط، بدون ما يوقف بقية الحفظ
async function uploadAvatarOrWarn(file: File, teamId: string, memberId: string, toast?: any) {
  try {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${teamId}/${memberId}-${Date.now()}.${ext}`
    const { error: upErr } = await supabase
      .storage.from(AVATARS_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type })

    if (upErr) {
      if (/bucket not found/i.test(upErr.message)) {
        toast?.error?.('Bucket باسم "avatars" غير موجود في Storage — أنشئه ثم أعد المحاولة.')
        return null
      }
      throw upErr
    }
    const { data: pub } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(path)
    return pub.publicUrl as string
  } catch (e:any) {
    toast?.error?.(e.message || 'تعذر رفع الصورة')
    return null
  }
}

  useEffect(()=>{ init() },[])
  async function init() {
    if (!isAdmin) { setLoading(false); return }
    setLoading(true)
    try {
      const [{ data: ts, error: te }, { data: rk, error: re }] = await Promise.all([
        supabase.from('teams').select('id,name').order('name'),
        supabase.from('ranks').select('id,rank_label').order('id')
      ])
      if (te) throw te
      if (re) throw re
      setTeams((ts as any) ?? [])
      setRanks((rk as any) ?? [])
      if (!chefTeamId && ts && ts.length) setChefTeamId(ts[0].id)
      if (!eqTeamId && ts && ts.length) setEqTeamId(ts[0].id)
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally {
      setLoading(false)
    }
  }

  // search auth users via RPC search_auth_users(q text)
  useEffect(() => {
    const h = setTimeout(async () => {
      setSelectedUser(null)
      if (!userSearch || userSearch.length < 2) { setUserResults([]); return }
      setSearching(true)
      try {
        const { data, error } = await supabase.rpc('search_auth_users', { q: userSearch })
        if (error) throw error
        const rows = (data as any[] ?? [])
        setUserResults(rows)
        if (rows.length === 1) setSelectedUser(rows[0])
      } catch (e:any) {
        toast.error(e.message || 'تعذر البحث')
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(h)
  }, [userSearch])

  function toggleGlobal(slug: string) {
    setSelectedGlobal(prev => prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug])
  }
  function toggleTeam(slug: string) {
    setSelectedTeamRoles(prev => prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug])
  }

async function saveChef() {
  if (!isAdmin) { toast.error('أذونات غير كافية'); return }
  if (!chefFullName.trim()) return toast.error('أدخل الاسم')
  if (!chefTeamId) return toast.error('اختر الفريق')
  if (!chefRankId) return toast.error('اختر الرتبة')
  if (!selectedUser) return toast.error('اختر مستخدم (Auth user)')

  setSavingChef(true)
  try {
    // 1) هل يوجد عضو مسبقًا بنفس الـ auth_user_id ؟
    const { data: existing, error: exErr } = await supabase
      .from('members')
      .select('id, full_name, team_id, is_equipier')
      .eq('auth_user_id', selectedUser.id)
      .maybeSingle()
    if (exErr) throw exErr

    let memberId: string | null = null

    if (existing?.id) {
      // 2) موجود → تحديثه بدل الإنشاء
      const { error: upErr } = await supabase
        .from('members')
        .update({
          full_name: chefFullName.trim(),
          team_id: chefTeamId,
          rank_id: chefRankId,
          personal_phone: chefPhone || null,
          is_equipier: false,           // تحويله لقائد إن كان Equipier
        })
        .eq('id', existing.id)
      if (upErr) throw upErr
      memberId = existing.id
    } else {
      // 3) غير موجود → إدراج جديد
      const { data: ins, error: em } = await supabase
        .from('members')
        .insert({
          full_name: chefFullName.trim(),
          team_id: chefTeamId,
          rank_id: chefRankId,
          personal_phone: chefPhone || null,
          auth_user_id: selectedUser.id,
          is_equipier: false
        })
        .select('id')
        .single()
      if (em) throw em
      memberId = ins?.id ?? null
    }

    // 4) تعيين الأدوار (عام/على فريق)
    const items: { role_slug: string; team_id: string | null }[] = []
    ROLE_CHOICES.forEach(rc => {
      if (rc.slug === 'equipier') return
      if (selectedGlobal.includes(rc.slug)) items.push({ role_slug: rc.slug, team_id: null })
      if (selectedTeamRoles.includes(rc.slug)) items.push({ role_slug: rc.slug, team_id: chefTeamId })
    })
    if (items.length) {
      const { error: rerr } = await supabase.rpc('admin_assign_roles_batch', {
        p_user_id: selectedUser.id,
        p_items: items
      })
      if (rerr) throw rerr
    }

    toast.success(existing ? 'تم تحديث بيانات القائد وربط الأدوار' : 'تم إضافة القائد وتعيين الأدوار')
    // reset الفورم
    setChefFullName('')
    setChefPhone('')
    setUserSearch('')
    setUserResults([])
    setSelectedUser(null)
    setSelectedGlobal([])
    setSelectedTeamRoles([])
  } catch (e:any) {
    // لو حصلت أي محاولة Insert موازية أو تعارض، الرسالة دي هتظهر بدل الـ  duplicate error الخام
    toast.error(e.message || 'تعذر الحفظ — قد يكون المستخدم مُسجلاً بالفعل كعضو.')
  } finally {
    setSavingChef(false)
  }
}


  async function saveEquipier() {
    if (!isAdmin) { toast.error('أذونات غير كافية'); return }
    if (!eqFullName.trim()) return toast.error('أدخل الاسم')
    if (!eqTeamId) return toast.error('اختر الفريق')

    setSavingEq(true)
    try {
      const { error } = await supabase
        .from('members')
        .insert({
          full_name: eqFullName.trim(),
          team_id: eqTeamId,
          is_equipier: true,
          guardian_name: eqGuardianName || null,
          guardian_phone: eqGuardianPhone || null,
          birth_date: eqBirthDate || null
        })
      if (error) throw error
      toast.success('تم إضافة الـ Equipier')
      setEqFullName(''); setEqGuardianName(''); setEqGuardianPhone(''); setEqBirthDate('')
    } catch (e:any) {
      toast.error(e.message || 'تعذر الإضافة')
    } finally {
      setSavingEq(false)
    }
  }

  if (!isAdmin) return <div className="p-6">هذه الصفحة مخصصة للأدمن فقط.</div>

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري تحميل البيانات..." />

      <h1 className="text-xl font-bold">لوحة الإدارة — إضافة الأعضاء وتحديد نطاق الأدوار</h1>

      <div className="flex gap-2">
        <button className={`px-4 py-2 rounded-xl border ${tab==='chef'?'bg-gray-100':''}`} onClick={()=>setTab('chef')}>إضافة قائد (Chef)</button>
        <button className={`px-4 py-2 rounded-xl border ${tab==='equipier'?'bg-gray-100':''}`} onClick={()=>setTab('equipier')}>إضافة Equipier</button>
      </div>

      {tab === 'chef' && (
        <section className="card space-y-4">
          <h2 className="text-lg font-bold">بيانات القائد</h2>
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="text-sm">الاسم الكامل</label>
              <input className="border rounded-xl p-2 w-full" value={chefFullName} onChange={e=>setChefFullName(e.target.value)} placeholder="مثلاً: أحمد علي" />
            </div>
            <div>
              <label className="text-sm">الهاتف</label>
              <input className="border rounded-xl p-2 w-full" value={chefPhone} onChange={e=>setChefPhone(e.target.value)} placeholder="010..." />
            </div>
            <div>
              <label className="text-sm">الفريق</label>
              <select className="border rounded-xl p-2 w-full cursor-pointer" value={chefTeamId} onChange={e=>setChefTeamId(e.target.value)}>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm">الرتبة</label>
              <select className="border rounded-xl p-2 w-full cursor-pointer" value={chefRankId} onChange={e=>setChefRankId(Number(e.target.value))}>
                <option value="">— اختر —</option>
                {ranks.map(r => <option key={r.id} value={r.id}>{r.rank_label}</option>)}
              </select>
            </div>

            {/* ⬇️ صورة شخصية (اختياري) */}
            <div className="md:col-span-2">
              <label className="text-sm">صورة شخصية (اختياري)</label>
              <input type="file" accept="image/*" onChange={e=>setChefAvatar(e.target.files?.[0] ?? null)} />
              {chefAvatar && <div className="text-xs text-gray-500 mt-1">الحجم: { (chefAvatar.size/1024/1024).toFixed(2) } MB</div>}
            </div>

            <div className="md:col-span-2">
              <label className="text-sm">المستخدم (Auth user) — ابحث بالبريد</label>
              <input className="border rounded-xl p-2 w-full" value={userSearch} onChange={e=>setUserSearch(e.target.value)} placeholder="user@example.com" />
              {searching && <div className="text-xs text-gray-500 mt-1">جاري البحث…</div>}
              {userResults.length > 0 && (
                <div className="mt-2 border rounded-2xl max-h-48 overflow-auto bg-white">
                  {userResults.map(u => (
                    <div key={u.id}
                      className={`p-2 cursor-pointer hover:bg-gray-50 ${selectedUser?.id === u.id ? 'bg-gray-100' : ''}`}
                      onClick={()=>setSelectedUser(u)}>
                      {u.email} <span className="text-xs text-gray-500">({u.id.slice(0,8)})</span>
                    </div>
                  ))}
                </div>
              )}
              {selectedUser && <div className="text-xs text-emerald-700 mt-1">تم اختيار: {selectedUser.email}</div>}
            </div>
          </div>

          <div className="mt-4">
            <div className="text-sm font-semibold mb-1">الأدوار ونطاقها</div>
            <div className="border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 text-start">الدور</th>
                    <th className="p-2 text-center">عام (Global)</th>
                    <th className="p-2 text-center">على الفريق المختار</th>
                  </tr>
                </thead>
                <tbody>
                  {ROLE_CHOICES.map(rc => (
                    <tr key={rc.slug} className="border-t">
                      <td className="p-2">{rc.label}</td>
                      <td className="p-2 text-center">
                        <input type="checkbox" disabled={!rc.allowGlobal} checked={selectedGlobal.includes(rc.slug)} onChange={()=>toggleGlobal(rc.slug)} />
                      </td>
                      <td className="p-2 text-center">
                        <input type="checkbox" disabled={!rc.allowTeam} checked={selectedTeamRoles.includes(rc.slug)} onChange={()=>toggleTeam(rc.slug)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <LoadingButton loading={savingChef} onClick={saveChef}>حفظ القائد والأدوار</LoadingButton>
          </div>
        </section>
      )}

      {tab === 'equipier' && (
        <section className="card space-y-4">
          <h2 className="text-lg font-bold">إضافة Equipier</h2>
          <div className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="text-sm">الاسم الكامل</label>
              <input className="border rounded-xl p-2 w-full" value={eqFullName} onChange={e=>setEqFullName(e.target.value)} placeholder="مثلاً: كريم محمد" />
            </div>
            <div>
              <label className="text-sm">الفريق</label>
              <select className="border rounded-xl p-2 w-full cursor-pointer" value={eqTeamId} onChange={e=>setEqTeamId(e.target.value)}>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm">اسم ولي الأمر</label>
              <input className="border rounded-xl p-2 w-full" value={eqGuardianName} onChange={e=>setEqGuardianName(e.target.value)} />
            </div>
            <div>
              <label className="text-sm">هاتف ولي الأمر</label>
              <input className="border rounded-xl p-2 w-full" value={eqGuardianPhone} onChange={e=>setEqGuardianPhone(e.target.value)} placeholder="010..." />
            </div>
            <div>
              <label className="text-sm">تاريخ الميلاد</label>
              <input type="date" className="border rounded-xl p-2 w-full" value={eqBirthDate} onChange={e=>setEqBirthDate(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end">
            <LoadingButton loading={savingEq} onClick={saveEquipier}>حفظ الـ Equipier</LoadingButton>
          </div>
        </section>
      )}
    </div>
  )
}
