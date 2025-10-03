// src/pages/TeamSecretary.tsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'
import { LoadingButton } from '../components/ui/LoadingButton'
import { useAuth } from '../components/AuthProvider'

type Team = { id: string; name: string }
type Term = { id: string; name: string; year: number; start_date: string|null; end_date: string|null }
type Equipier = { id: string; full_name: string; guardian_name: string|null; guardian_phone: string|null; birth_date: string|null; avatar_url?: string|null }
type Counts = { present: number; total: number; absent_excused: number; absent_unexcused: number }

export default function TeamSecretary() {
  const toast = useToast()
  const { roles } = useAuth()
  const isAdmin = roles.some(r => r.role_slug === 'admin')
  const isGlobalSec = roles.some(r => r.role_slug === 'responsable_secretary' && (r.team_id === null || r.team_id === undefined))

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'equipiers'|'attendance'>('equipiers')

  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState<string>('')
  const [teamName, setTeamName] = useState<string>('')

  const [terms, setTerms] = useState<Term[]>([])
  const [termId, setTermId] = useState<string>('')

  const [list, setList] = useState<Equipier[]>([])
  const [counts, setCounts] = useState<Record<string, Counts>>({})

  // add/edit
  const [newName, setNewName] = useState<string>('')
  const [newGuardian, setNewGuardian] = useState<string>('')
  const [newPhone, setNewPhone] = useState<string>('')
  const [newDOB, setNewDOB] = useState<string>('')
  const [newAvatar, setNewAvatar] = useState<File | null>(null) // ⬅️ جديد

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<Equipier>>({})

  // attendance tab
  const [meetingDate, setMeetingDate] = useState<string>('')
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})

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

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const { data: tm, error: te } = await supabase.from('terms').select('id,name,year,start_date,end_date').order('year', { ascending: false }).order('name', { ascending: true })
      if (te) throw te
      setTerms(tm ?? [])
      if (tm && tm.length) setTermId(tm[0].id)

      if (isAdmin || isGlobalSec) {
        const { data: ts, error: tErr } = await supabase.from('teams').select('id,name').order('name')
        if (tErr) throw tErr
        setTeams(ts ?? [])
        if (ts && ts.length) { setTeamId(ts[0].id); setTeamName(ts[0].name) }
      } else {
        const { data: me, error: meErr } = await supabase.from('v_me').select('team_id').maybeSingle()
        if (meErr) throw meErr
        if (!me?.team_id) throw new Error('لا يوجد فريق مرتبط بحسابك')
        setTeamId(me.team_id)
        const { data: t } = await supabase.from('teams').select('name').eq('id', me.team_id).maybeSingle()
        setTeamName(t?.name || '—')
      }

      const now = new Date(); const pad=(n:number)=>String(n).padStart(2,'0')
      const d = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
      setMeetingDate(d)
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally { setLoading(false) }
  }

  useEffect(() => { if (teamId) refreshList() }, [teamId])
  useEffect(() => { if (teamId && termId) refreshCounts() }, [teamId, termId])

  async function refreshList() {
    try {
      const { data, error } = await supabase.from('members')
        .select('id, full_name, guardian_name, guardian_phone, birth_date, avatar_url')
        .eq('team_id', teamId).eq('is_equipier', true).order('full_name')
      if (error) throw error
      const arr = (data as any[]) ?? []
      setList(arr)

      const c: Record<string, boolean> = {}; const r: Record<string, string> = {}
      arr.forEach(m => { c[m.id] = false; r[m.id] = '' })
      setChecks(c); setReasons(r)

      if (meetingDate) await loadMeetingAttendanceForDate(meetingDate, arr.map(x=>x.id))
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الأفراد')
    }
  }

  async function refreshCounts() {
    try {
      if (!teamId || !termId) { setCounts({}); return }
      const { data, error } = await supabase
        .from('v_equipier_term_stats')
        .select('member_id, present, total, absent_excused, absent_unexcused')
        .eq('team_id', teamId)
        .eq('term_id', termId)
      if (error) throw error
      const map: Record<string, Counts> = {}
      ;(data as any[] ?? []).forEach(r => {
        map[r.member_id] = {
          present: Number(r.present)||0,
          total: Number(r.total)||0,
          absent_excused: Number(r.absent_excused)||0,
          absent_unexcused: Number(r.absent_unexcused)||0
        }
      })
      setCounts(map)
    } catch (e:any) {
      // fallback اختياري
      setCounts({})
    }
  }

  // ⬇️ إضافة ولد + رفع الصورة
  async function addEquipier() {
    if (!newName.trim()) return toast.error('ادخل الاسم')
    try {
      // 1) إدخال العضو أولاً للحصول على الـ ID
      const { data: row, error } = await supabase.from('members').insert({
        full_name: newName.trim(),
        team_id: teamId,
        is_equipier: true,
        guardian_name: newGuardian || null,
        guardian_phone: newPhone || null,
        birth_date: newDOB || null
      }).select('id').single()
      if (error) throw error
      const newId = row?.id as string

      if (newAvatar && newId) {
        const url = await uploadAvatarOrWarn(newAvatar, teamId, newId, toast)
        if (url) {
          await supabase.from('members').update({ avatar_url: url }).eq('id', newId)
        }
      }

      toast.success('تم إضافة الإكويبيير')
      setNewName(''); setNewGuardian(''); setNewPhone(''); setNewDOB(''); setNewAvatar(null)
      await refreshList()
      await refreshCounts()
    } catch (e:any) {
      toast.error(e.message || 'تعذر الإضافة')
    }
  }

  function startEdit(m: Equipier) {
    setEditingId(m.id)
    setEditDraft({ ...m })
  }
  function cancelEdit() { setEditingId(null); setEditDraft({}) }
  async function saveEdit() {
    if (!editingId) return
    const payload: any = {}
    payload.full_name = (editDraft.full_name || '').trim()
    payload.guardian_name = editDraft.guardian_name || null
    payload.guardian_phone = editDraft.guardian_phone || null
    payload.birth_date = editDraft.birth_date || null
    if (!payload.full_name) return toast.error('الاسم مطلوب')
    try {
      const { error } = await supabase.from('members').update(payload).eq('id', editingId).eq('is_equipier', true)
      if (error) throw error
      toast.success('تم حفظ التعديلات')
      cancelEdit()
      await refreshList()
      await refreshCounts()
    } catch (e:any) { toast.error(e.message || 'تعذر الحفظ') }
  }
  async function deleteEquipier(id: string) {
    if (!confirm('هل أنت متأكد من حذف هذا الإكويبيير؟')) return
    try {
      const { error } = await supabase.from('members').delete().eq('id', id).eq('is_equipier', true)
      if (error) throw error
      toast.success('تم الحذف')
      await refreshList()
      await refreshCounts()
    } catch (e:any) { toast.error(e.message || 'تعذر الحذف') }
  }

  async function loadMeetingAttendanceForDate(dateISO: string, memberIds?: string[]) {
    try {
      const { data: mrow } = await supabase
        .from('meetings').select('id')
        .eq('team_id', teamId).eq('meeting_date', dateISO).eq('mtype', 'meeting')
        .maybeSingle()
      if (!mrow?.id) {
        const ids = memberIds ?? list.map(x=>x.id)
        const c: Record<string, boolean> = {}; const r: Record<string, string> = {}
        ids.forEach(id => { c[id] = false; r[id] = '' })
        setChecks(c); setReasons(r)
        return
      }
      const { data: attRows } = await supabase
        .from('attendance')
        .select('member_id, is_present, absence_reason')
        .eq('meeting_id', mrow.id)
      const c: Record<string, boolean> = {}; const r: Record<string, string> = {}
      const ids = memberIds ?? list.map(x=>x.id)
      ids.forEach(id => { c[id] = false; r[id] = '' })
      ;(attRows as any[] ?? []).forEach(a => {
        c[a.member_id] = !!a.is_present
        r[a.member_id] = a.is_present ? '' : (a.absence_reason || '')
      })
      setChecks(c); setReasons(r)
    } catch {
      /* silent */
    }
  }

  async function saveAttendance() {
    setSaving(true)
    try {
      if (!meetingDate) throw new Error('اختر تاريخ الاجتماع')
      const { data: mrow, error: me } = await supabase
        .from('meetings')
        .upsert({ team_id: teamId, meeting_date: meetingDate, mtype: 'meeting' }, { onConflict: 'team_id,meeting_date,mtype' })
        .select('id').maybeSingle()
      if (me) throw me
      const meeting_id = mrow?.id
      if (!meeting_id) throw new Error('تعذر إنشاء سجل الاجتماع')

      const payload = Object.entries(checks).map(([member_id, present]) => ({
        meeting_id, member_id, is_present: !!present,
        absence_reason: present ? null : ((reasons[member_id] || '').trim() || null)
      }))
      if (!payload.length) throw new Error('لا يوجد أفراد')

      const { error: ae } = await supabase.from('attendance').upsert(payload, { onConflict: 'meeting_id,member_id' })
      if (ae) throw ae

      toast.success('تم حفظ الحضور')
      await refreshCounts()
      await loadMeetingAttendanceForDate(meetingDate)
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحفظ')
    } finally { setSaving(false) }
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">السيكرتارية — (فريق)</h1>

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

      <div className="flex items-center gap-2 flex-wrap">
        <button className={`tab ${tab==='equipiers'?'tab-active':''}` } onClick={()=>setTab('equipiers')}>الأولاد (إدارة)</button>
        <button className={`tab ${tab==='attendance'?'tab-active':''}`} onClick={()=>setTab('attendance')}>حضور الاجتماعات</button>
      </div>

      {tab==='equipiers' && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">إضافة ولد جديد</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 items-end">
            <div>
              <label className="text-sm">الاسم</label>
              <input className="border rounded-xl p-2 w-full min-w-0" value={newName} onChange={e=>setNewName(e.target.value)} />
            </div>
            <div>
              <label className="text-sm">اسم ولي الأمر</label>
              <input className="border rounded-xl p-2 w-full min-w-0" value={newGuardian} onChange={e=>setNewGuardian(e.target.value)} />
            </div>
            <div>
              <label className="text-sm">هاتف ولي الأمر</label>
              <input className="border rounded-xl p-2 w-full min-w-0" value={newPhone} onChange={e=>setNewPhone(e.target.value)} />
            </div>
            <div>
              <label className="text-sm">تاريخ الميلاد</label>
              <input type="date" className="border rounded-xl p-2 w-full min-w-0" value={newDOB} onChange={e=>setNewDOB(e.target.value)} />
            </div>

            {/* ⬇️ صورة (اختياري) */}
            <div className="sm:col-span-2 md:col-span-2">
              <label className="text-sm">صورة شخصية (اختياري)</label>
              <input type="file" className="block w-full text-sm" accept="image/*" onChange={e=>setNewAvatar(e.target.files?.[0] ?? null)} />
              {newAvatar && <div className="text-xs text-gray-500 mt-1">الحجم: {(newAvatar.size/1024/1024).toFixed(2)} MB</div>}
            </div>

            <div className="sm:col-span-2 md:col-span-5 text-end">
              <LoadingButton loading={false} onClick={addEquipier}>إضافة</LoadingButton>
            </div>
          </div>

          <h2 className="text-lg font-semibold">قائمة الأولاد</h2>
          <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs sm:text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-start">الاسم</th>
                  <th className="p-2 text-start">ولي الأمر</th>
                  <th className="p-2 text-start whitespace-nowrap">الهاتف</th>
                  <th className="p-2 text-start whitespace-nowrap">تاريخ الميلاد</th>
                  <th className="p-2 text-center whitespace-nowrap">النسبة (الترم)</th>
                  <th className="p-2 text-center whitespace-nowrap">غياب بعذر/بدون</th>
                  <th className="p-2 text-center whitespace-nowrap">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {list.map(m => {
                  const c = counts[m.id] || { present: 0, total: 0, absent_excused: 0, absent_unexcused: 0 }
                  const isEditing = editingId === m.id
                  return (
                    <tr key={m.id} className="border-t">
                      <td className="p-2">{isEditing ? (
                        <input className="border rounded-xl p-1 w-full min-w-0" defaultValue={m.full_name} onChange={ev=>setEditDraft(d=>({...d, full_name: ev.target.value}))} />
                      ) : m.full_name}</td>
                      <td className="p-2">{isEditing ? (
                        <input className="border rounded-xl p-1 w-full min-w-0" defaultValue={m.guardian_name || ''} onChange={ev=>setEditDraft(d=>({...d, guardian_name: ev.target.value}))} />
                      ) : (m.guardian_name || '—')}</td>
                      <td className="p-2 whitespace-nowrap">{isEditing ? (
                        <input className="border rounded-xl p-1 w-full min-w-0" defaultValue={m.guardian_phone || ''} onChange={ev=>setEditDraft(d=>({...d, guardian_phone: ev.target.value}))} />
                      ) : (m.guardian_phone || '—')}</td>
                      <td className="p-2 whitespace-nowrap">{isEditing ? (
                        <input type="date" className="border rounded-xl p-1 w-full min-w-0" defaultValue={m.birth_date || ''} onChange={ev=>setEditDraft(d=>({...d, birth_date: ev.target.value}))} />
                      ) : (m.birth_date || '—')}</td>
                      <td className="p-2 text-center">
                        <span className="px-2 py-1 rounded-full bg-white border text-[11px] sm:text-xs whitespace-nowrap">
                          {c.present} من {c.total} — {c.total ? Math.round((c.present/c.total)*100) : 0}%
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        <span className="px-2 py-1 rounded-full bg-white border text-[11px] sm:text-xs whitespace-nowrap">
                          بعذر {c.absent_excused} / بدون {c.absent_unexcused}
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        {!isEditing ? (
                          <button className="btn border text-xs sm:text-sm" onClick={()=>startEdit(m)}>تعديل</button>
                        ) : (
                          <div className="flex gap-2 justify-center">
                            <button className="btn border text-xs sm:text-sm" onClick={saveEdit}>حفظ</button>
                            <button className="btn border text-xs sm:text-sm" onClick={cancelEdit}>إلغاء</button>
                          </div>
                        )}
                        <button className="btn border ml-2 text-xs sm:text-sm" onClick={()=>deleteEquipier(m.id)}>حذف</button>
                      </td>
                    </tr>
                  )
                })}
                {list.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={7}>لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab==='attendance' && (
        <section className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 items-end">
            <div>
              <label className="text-sm">الترم</label>
              <select className="border rounded-xl p-2 w-full min-w-0 cursor-pointer" value={termId} onChange={e=>setTermId(e.target.value)}>
                {terms.map(t => <option key={t.id} value={t.id}>{t.year} — {t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm">تاريخ الاجتماع</label>
              <input
                type="date"
                className="border rounded-xl p-2 w-full min-w-0"
                value={meetingDate}
                onChange={async e=>{
                  const v = e.target.value
                  setMeetingDate(v)
                  await loadMeetingAttendanceForDate(v)
                }}
              />
            </div>
            <div className="text-end">
              <LoadingButton loading={saving} onClick={saveAttendance}>حفظ الحضور</LoadingButton>
            </div>
          </div>

          <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs sm:text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="p-2 text-start">الاسم</th>
                  <th className="p-2 text-center whitespace-nowrap">حضر؟</th>
                  <th className="p-2 text-start">عذر الغياب (إن وُجد)</th>
                  <th className="p-2 text-center whitespace-nowrap">حضوره في الترم</th>
                </tr>
              </thead>
              <tbody>
                {list.map(m => {
                  const c = counts[m.id] || { present: 0, total: 0, absent_excused: 0, absent_unexcused: 0 }
                  const present = !!checks[m.id]
                  return (
                    <tr key={m.id} className="border-t align-top">
                      <td className="p-2">{m.full_name}</td>
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          className="scale-125 cursor-pointer"
                          checked={present}
                          onChange={e=>{
                            const v = e.target.checked
                            setChecks(p=>({...p, [m.id]: v}))
                            if (v) setReasons(r=>({...r, [m.id]: ''}))
                          }}
                        />
                      </td>
                      <td className="p-2">
                        {!present ? (
                          <input
                            className="border rounded-xl p-2 w-full min-w-0"
                            placeholder="اكتب العذر (اختياري)"
                            value={reasons[m.id] || ''}
                            onChange={e=>setReasons(r=>({...r, [m.id]: e.target.value}))}
                          />
                        ) : <span className="text-xs text-gray-500">—</span>}
                      </td>
                      <td className="p-2 text-center">
                        <span className="px-2 py-1 rounded-full bg-white border text-[11px] sm:text-xs whitespace-nowrap">
                          {c.present} من {c.total} — {c.total ? Math.round((c.present/c.total)*100) : 0}%
                          <br />
                          <span className="text-[10px] sm:text-[11px] text-gray-600">بعذر {c.absent_excused} / بدون {c.absent_unexcused}</span>
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {list.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={4}>لا توجد بيانات</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
