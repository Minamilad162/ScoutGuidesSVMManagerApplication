import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'
import { LoadingButton } from '../components/ui/LoadingButton'
import { useAuth } from '../components/AuthProvider'

// ===== Types =====
type Team = { id: string; name: string }
type Equipier = { id: string; full_name: string }

type MemberRel = { full_name: string | null }
type MemberRelMaybe = MemberRel | MemberRel[] | null | undefined

type CaseRow = {
  id: string
  team_id: string
  member_id: string
  case_type: 'medical' | 'attendance' | 'other' | string
  title: string
  details: string | null
  severity: 'low'|'medium'|'high'|string
  effective_from: string // YYYY-MM-DD
  effective_to: string | null
  status: 'open'|'archived'|string
  pinned: boolean
  created_at: string
  // Supabase nested select may return OBJECT or ARRAY depending on relation inference
  members?: MemberRelMaybe
}

function memberName(members: MemberRelMaybe): string {
  if (!members) return '—'
  if (Array.isArray(members)) return members[0]?.full_name ?? '—'
  return members.full_name ?? '—'
}

export default function TeamCases(){
  const toast = useToast()
  const { roles } = useAuth()
  const isAdmin = roles.some(r => r.role_slug === 'admin')
  const isGlobalSec = roles.some(
    r => r.role_slug === 'responsable_secretary' && (r.team_id === null || r.team_id === undefined)
  )

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState('')
  const [teamName, setTeamName] = useState('')

  const [members, setMembers] = useState<Equipier[]>([])

  // form fields
  const [memberId, setMemberId] = useState('')
  const [caseType, setCaseType] = useState<'medical'|'attendance'|'other'>('medical')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [severity, setSeverity] = useState<'low'|'medium'|'high'>('low')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [pinned, setPinned] = useState(false)

  // listing
  const [query, setQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<'open'|'archived'|'all'>('open')
  const [filterType, setFilterType] = useState<'all'|'medical'|'attendance'|'other'>('all')

  const [rows, setRows] = useState<CaseRow[]>([])
  const [listLoading, setListLoading] = useState(false)

  useEffect(()=>{ init() }, [])
  async function init(){
    setLoading(true)
    try{
      // teams & logged user team
      if (isAdmin || isGlobalSec){
        const { data: ts, error: terr } = await supabase.from('teams').select('id,name').order('name')
        if (terr) throw terr
        setTeams(ts ?? [])
        if (ts && ts.length){ setTeamId(ts[0].id); setTeamName(ts[0].name) }
      } else {
        const { data: me, error: meErr } = await supabase.from('v_me').select('team_id').maybeSingle()
        if (meErr) throw meErr
        if (!me?.team_id) throw new Error('لا يوجد فريق مرتبط بحسابك')
        setTeamId(me.team_id)
        const { data: t } = await supabase.from('teams').select('name').eq('id', me.team_id).maybeSingle()
        setTeamName(t?.name || '—')
      }

      // default dates
      const now = new Date(); const pad=(n:number)=>String(n).padStart(2,'0')
      const d = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
      setFromDate(d)
    } catch(e:any){
      toast.error(e.message || 'تعذر التحميل')
    } finally { setLoading(false) }
  }

  // load members + cases when team changes
  useEffect(()=>{ if(teamId){ loadMembers(); refresh() } }, [teamId])

  async function loadMembers(){
    try{
      const { data, error } = await supabase
        .from('members')
        .select('id, full_name')
        .eq('team_id', teamId)
        .eq('is_equipier', true)
        .order('full_name')
      if (error) throw error
      setMembers((data as any) ?? [])
      if (data && data.length) setMemberId(data[0].id)
    }catch(e:any){ toast.error(e.message || 'تعذر تحميل الأعضاء') }
  }

  async function refresh(){
    setListLoading(true)
    try{
      // Base query — members may come as object or array
      let q = supabase
        .from('member_cases')
        .select('id, team_id, member_id, case_type, title, details, severity, effective_from, effective_to, status, pinned, created_at, members:member_id(full_name)')
        .eq('team_id', teamId)
        .order('pinned', { ascending: false })
        .order('status', { ascending: true })
        .order('created_at', { ascending: false })

      if (filterStatus !== 'all') q = q.eq('status', filterStatus)
      if (filterType !== 'all') q = q.eq('case_type', filterType)

      const { data, error } = await q
      if (error) throw error

      // 👇 حل تحذير TS2352: نزق لـ unknown ثم CaseRow[]
      const list = (data as unknown as CaseRow[]) ?? []
      const s = query.trim().toLowerCase()

      const filtered = s
        ? list.filter(r => {
            const name = memberName(r.members).toLowerCase()
            return (
              r.title.toLowerCase().includes(s) ||
              (r.details || '').toLowerCase().includes(s) ||
              name.includes(s)
            )
          })
        : list

      setRows(filtered)
    } catch(e:any){
      toast.error(e.message || 'تعذر تحميل الحالات')
    } finally { setListLoading(false) }
  }

  // اعمل refresh عند تغيير الفلاتر
  useEffect(()=>{ if(teamId) refresh() }, [filterStatus, filterType])
  // لو عايز بحث لحظي: ممكن تضيف useEffect على query مع debounce

  function clearForm(){
    setCaseType('medical'); setTitle(''); setDetails(''); setSeverity('low'); setPinned(false); setToDate('')
  }

  async function addCase(){
    if (!teamId) return toast.error('لم يتم تحديد الفريق')
    if (!memberId) return toast.error('اختر الطالب')
    if (!title.trim()) return toast.error('العنوان مطلوب')
    if (!fromDate) return toast.error('حدد تاريخ بداية')
    setSaving(true)
    try{
      const { error } = await supabase.from('member_cases').insert({
        team_id: teamId,
        member_id: memberId,
        case_type: caseType,
        title: title.trim(),
        details: details.trim() || null,
        severity,
        effective_from: fromDate,
        effective_to: toDate || null,
        status: 'open',
        pinned
      })
      if (error) throw error
      toast.success('تم إضافة الحالة')
      clearForm()
      await refresh()
    }catch(e:any){
      toast.error(e.message || 'تعذر إضافة الحالة')
    }finally{ setSaving(false) }
  }

  async function toggleArchive(row: CaseRow){
    try{
      const to = row.status === 'open' ? 'archived' : 'open'
      const { error } = await supabase.from('member_cases').update({ status: to }).eq('id', row.id)
      if (error) throw error
      await refresh()
    }catch(e:any){ toast.error(e.message || 'تعذر التحديث') }
  }

  async function togglePin(row: CaseRow){
    try{
      const to = !row.pinned
      const { error } = await supabase.from('member_cases').update({ pinned: to }).eq('id', row.id)
      if (error) throw error
      await refresh()
    }catch(e:any){ toast.error(e.message || 'تعذر التحديث') }
  }

  // حذف فعلي — Admin فقط. (UI حالياً يستخدم الأرشفة كـ "حذف")
  // لو عايز زرار حذف نهائي، فعّله تحت وتأكد من RLS للسماح للـadmin.
  /*
  async function removeCase(row: CaseRow){
    if (!isAdmin) {
      toast.error('لا تملك صلاحية الحذف — يمكنك أرشفة الحالة بدلًا من ذلك')
      return
    }
    if (!confirm('حذف هذه الحالة نهائيًا؟')) return
    try{
      const { data, error } = await supabase
        .from('member_cases')
        .delete()
        .eq('id', row.id)
        .select('id') // verify RLS deleted something
      if (error) throw error
      if (!data || data.length === 0) throw new Error('تعذر الحذف (RLS؟)')
      toast.success('تم الحذف')
      await refresh()
    }catch(e:any){ toast.error(e.message || 'تعذر الحذف') }
  }
  */

  const severityColor: Record<string,string> = {
    low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200',
    high: 'bg-rose-50 text-rose-700 border-rose-200'
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />
      <h1 className="text-xl font-bold">حالات/أعذار الفريق</h1>

      {(isAdmin || isGlobalSec) ? (
        <div className="mb-3">
          <label className="text-sm">الفريق</label>
          <select
            className="border rounded-xl p-2 w-full min-w-0 cursor-pointer"
            value={teamId}
            onChange={e=>{
              const id = e.target.value; setTeamId(id)
              const t = teams.find(x=>x.id===id); setTeamName(t?.name || '')
            }}
          >
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      ) : (
        <div className="mb-3 text-sm">
          <span className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-50 border">
            فريقك: <b>{teamName}</b>
          </span>
        </div>
      )}

      {/* Add form */}
      <section className="card p-3 space-y-3">
        <h2 className="text-lg font-semibold">إضافة حالة/عذر</h2>
        <div className="grid md:grid-cols-6 gap-2 items-end">
          <div className="md:col-span-2">
            <label className="text-sm">الطالب</label>
            <select className="border rounded-xl p-2 w-full cursor-pointer" value={memberId} onChange={e=>setMemberId(e.target.value)}>
              {members.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm">النوع</label>
            <select className="border rounded-xl p-2 w-full cursor-pointer" value={caseType} onChange={e=>setCaseType(e.target.value as any)}>
              <option value="medical">طبي</option>
              <option value="attendance">غياب/ظروف</option>
              <option value="other">أخرى</option>
            </select>
          </div>
          <div>
            <label className="text-sm">درجة الأهمية</label>
            <select className="border rounded-xl p-2 w-full cursor-pointer" value={severity} onChange={e=>setSeverity(e.target.value as any)}>
              <option value="low">منخفض</option>
              <option value="medium">متوسط</option>
              <option value="high">مرتفع</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-sm">العنوان</label>
            <input className="border rounded-xl p-2 w-full" value={title} onChange={e=>setTitle(e.target.value)} placeholder="مثال: مريض سكري — يحتاج متابعة" />
          </div>

          <div className="md:col-span-3">
            <label className="text-sm">الوصف/التفاصيل</label>
            <textarea className="border rounded-xl p-2 w-full" rows={2} value={details} onChange={e=>setDetails(e.target.value)} placeholder="تفاصيل مختصرة (أدوية، تعليمات، ظروف السفر...)"></textarea>
          </div>
          <div>
            <label className="text-sm">من تاريخ</label>
            <input type="date" className="border rounded-xl p-2 w-full" value={fromDate} onChange={e=>setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">إلى تاريخ (اختياري)</label>
            <input type="date" className="border rounded-xl p-2 w-full" value={toDate} onChange={e=>setToDate(e.target.value)} />
          </div>
          <div>
            <label className="text-sm">تثبيت أعلى القائمة</label>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={pinned} onChange={e=>setPinned(e.target.checked)} />
              <span className="text-xs text-gray-600">إظهار هذه الحالة أولاً</span>
            </div>
          </div>
          <div className="md:col-span-6 text-end">
            <LoadingButton loading={saving} onClick={addCase}>إضافة الحالة</LoadingButton>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="flex flex-wrap items-end gap-2">
        <div className="grow md:grow-0">
          <label className="text-sm">بحث</label>
          <input
            className="border rounded-xl p-2 w-full md:w-[260px]"
            placeholder="ابحث بالاسم/العنوان/التفاصيل"
            value={query}
            onChange={e=>setQuery(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') refresh() }}
          />
        </div>
        <div>
          <label className="text-sm">الحالة</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={filterStatus} onChange={e=>setFilterStatus(e.target.value as any)}>
            <option value="open">نشطة</option>
            <option value="archived">محذوفة</option>
            <option value="all">الكل</option>
          </select>
        </div>
        <div>
          <label className="text-sm">النوع</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={filterType} onChange={e=>setFilterType(e.target.value as any)}>
            <option value="all">الكل</option>
            <option value="medical">طبي</option>
            <option value="attendance">غياب/ظروف</option>
            <option value="other">أخرى</option>
          </select>
        </div>
        <div className="md:ml-auto">
          <button className="btn border" onClick={refresh} disabled={listLoading}>{listLoading ? '…' : 'تحديث'}</button>
        </div>
      </section>

      {/* Cards list */}
      <section className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {rows.map(r => (
          <article key={r.id} className={`border rounded-2xl p-3 ${r.pinned ? 'ring-1 ring-blue-200' : ''}`}>
            <div className="flex items-start gap-2">
              <div className={`px-2 py-1 rounded-full border text-xs ${severityColor[r.severity] || 'bg-gray-50 text-gray-700 border-gray-200'}`}>
                {r.severity === 'high' ? 'مرتفع' : r.severity === 'medium' ? 'متوسط' : 'منخفض'}
              </div>
              <div className="px-2 py-1 rounded-full bg-gray-50 border text-xs">
                {r.case_type === 'medical' ? 'طبي' : r.case_type === 'attendance' ? 'غياب/ظروف' : 'أخرى'}
              </div>
              {r.status === 'archived' && (
                <div className="px-2 py-1 rounded-full bg-gray-100 border text-[11px]">مؤرشفة</div>
              )}
              {r.pinned && (
                <div className="px-2 py-1 rounded-full bg-blue-50 border border-blue-200 text-[11px]">مثبّت</div>
              )}
              <div className="ml-auto text-[11px] text-gray-500">
                {r.effective_from}{r.effective_to ? ` → ${r.effective_to}` : ''}
              </div>
            </div>

            <h3 className="mt-2 font-semibold text-base">{r.title}</h3>
            <div className="text-sm text-gray-700">{memberName(r.members)}</div>
            {r.details && (
              <p className="mt-2 text-sm whitespace-pre-wrap">{r.details}</p>
            )}

            <div className="mt-3 flex items-center gap-2">
              <button className="btn border text-xs text-rose-700" onClick={()=>toggleArchive(r)}>
                {r.status === 'open' ? 'حذف' : 'استرجاع'}
              </button>
              <button className="btn border text-xs" onClick={()=>togglePin(r)}>
                {r.pinned ? 'إلغاء التثبيت' : 'تثبيت'}
              </button>
              {/* زرار حذف نهائي (Admin فقط) — فعّله لو محتاج
              {isAdmin && (
                <button className="btn border text-xs text-rose-700" onClick={()=>removeCase(r)}>حذف نهائي</button>
              )} */}
            </div>
          </article>
        ))}
        {rows.length === 0 && (
          <div className="col-span-full text-center text-gray-500 border rounded-2xl p-6">لا توجد حالات مطابقة</div>
        )}
      </section>
    </div>
  )
}
