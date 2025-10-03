import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../components/AuthProvider'

type Team = { id: string; name: string }
type Rank = { id: number; rank_label: string; rank_slug: string }
type Role = { id: number; role_label: string; role_slug: string }
type Member = {
  id: string; full_name: string; team_id: string | null; rank_id: number | null;
  is_equipier: boolean; personal_phone: string | null;
  guardian_name: string | null; guardian_phone: string | null; birth_date: string | null;
  auth_user_id: string | null;
}
type UserRoleView = { user_id: string; role_slug: string; team_id: string | null }
type Term = { id: string; name: string; year: number; start_date: string | null; end_date: string | null }
type FieldZone = { id: string; name: string; active: boolean }
type TeamLink = { id: string; team_id: string; kind: 'images'|'program'; url: string }

export default function Admin() {
  const { roles } = useAuth()
  const isAdmin = useMemo(() => roles.some(r => r.role_slug === 'admin'), [roles])
  const [tab, setTab] = useState<'members'|'roles'|'terms'|'field'|'links'|'stats'>('members')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Shared
  const [teams, setTeams] = useState<Team[]>([])
  const [ranks, setRanks] = useState<Rank[]>([])
  const [rolesList, setRolesList] = useState<Role[]>([])
  const [terms, setTerms] = useState<Term[]>([])

  useEffect(() => { loadBasic() }, [])
  async function loadBasic() {
    const [t, r, rl, tm] = await Promise.all([
      supabase.from('teams').select('id, name').order('name', { ascending: true }),
      supabase.from('ranks').select('id, rank_label, rank_slug').order('id'),
      supabase.from('roles').select('id, role_label, role_slug').order('id'),
      supabase.from('terms').select('id, name, year, start_date, end_date').order('year', { ascending: false }).order('name', { ascending: true }),
    ])
    if (!t.error) setTeams(t.data ?? [])
    if (!r.error) setRanks(r.data ?? [])
    if (!rl.error) setRolesList(rl.data ?? [])
    if (!tm.error) setTerms(tm.data ?? [])
  }

  // ========== Members ==========
  const [members, setMembers] = useState<Member[]>([])
  const [q, setQ] = useState('')
  const [fltTeam, setFltTeam] = useState<string>('')
  const [fltRank, setFltRank] = useState<number | ''>('')
  const [onlyEquipiers, setOnlyEquipiers] = useState(false)

  const [mEditId, setMEditId] = useState<string | null>(null)
  const [mFull, setMFull] = useState('')
  const [mTeam, setMTeam] = useState<string>('')
  const [mRank, setMRank] = useState<number | ''>('')
  const [mEquipier, setMEquipier] = useState(false)
  const [mPhone, setMPhone] = useState('')
  const [mGName, setMGName] = useState('')
  const [mGPhone, setMGPhone] = useState('')
  const [mBirth, setMBirth] = useState('')
  const [mAuth, setMAuth] = useState('')

  useEffect(() => { loadMembers() }, [])
  async function loadMembers() {
    const { data, error } = await supabase
      .from('members')
      .select('id, full_name, team_id, rank_id, is_equipier, personal_phone, guardian_name, guardian_phone, birth_date, auth_user_id')
      .order('full_name', { ascending: true })
    if (error) { setErr(error.message); return }
    setMembers(data ?? [])
  }

  function filteredMembers() {
    let list = [...members]
    if (q) list = list.filter(m => m.full_name.toLowerCase().includes(q.toLowerCase()))
    if (fltTeam) list = list.filter(m => m.team_id === fltTeam)
    if (fltRank !== '') list = list.filter(m => m.rank_id === fltRank)
    if (onlyEquipiers) list = list.filter(m => m.is_equipier)
    return list
  }

  async function saveMember() {
    setMsg(null); setErr(null)
    if (!mFull) { setErr('ادخل الاسم كامل'); return }
    const payload: any = {
      full_name: mFull,
      team_id: mTeam || null,
      rank_id: mRank === '' ? null : Number(mRank),
      is_equipier: mEquipier,
      personal_phone: mPhone || null,
      guardian_name: mGName || null,
      guardian_phone: mGPhone || null,
      birth_date: mBirth || null,
      auth_user_id: mAuth || null
    }
    if (mEditId) {
      const { error } = await supabase.from('members').update(payload).eq('id', mEditId)
      if (error) { setErr(error.message); return }
      setMsg('تم تعديل العضو')
    } else {
      const { error } = await supabase.from('members').insert(payload).single()
      if (error) { setErr(error.message); return }
      setMsg('تم إضافة عضو')
    }
    setMEditId(null); setMFull(''); setMTeam(''); setMRank(''); setMEquipier(false); setMPhone(''); setMGName(''); setMGPhone(''); setMBirth(''); setMAuth('')
    await loadMembers()
  }

  function editMember(m: Member) {
    setMEditId(m.id); setMFull(m.full_name); setMTeam(m.team_id ?? ''); setMRank(m.rank_id ?? ''); setMEquipier(m.is_equipier);
    setMPhone(m.personal_phone ?? ''); setMGName(m.guardian_name ?? ''); setMGPhone(m.guardian_phone ?? ''); setMBirth(m.birth_date ?? '');
    setMAuth(m.auth_user_id ?? '')
  }

  // CSV Import/Export
  const fileRef = useRef<HTMLInputElement>(null)
  function exportMembersCSV() {
    const hdr = ['full_name','team_name','rank_slug','is_equipier','personal_phone','guardian_name','guardian_phone','birth_date','auth_user_id']
    const lines = [hdr.join(',')]
    for (const m of filteredMembers()) {
      const team = teams.find(t => t.id === m.team_id)?.name ?? ''
      const rank = ranks.find(r => r.id === m.rank_id)?.rank_slug ?? ''
      lines.push(`"${m.full_name.replace(/"/g,'""')}",${team ? `"${team.replace(/"/g,'""')}"` : ''},${rank},${m.is_equipier?1:0},${m.personal_phone??''},${m.guardian_name??''},${m.guardian_phone??''},${m.birth_date??''},${m.auth_user_id??''}`)
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'members.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
  }
  async function importMembersCSV(file: File) {
    setErr(null); setMsg(null)
    const text = await file.text()
    const rows = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean)
    const header = rows.shift()
    if (!header) { setErr('CSV فارغ'); return }
    const cols = header.split(',').map(s=>s.trim())
    const idx = {
      full_name: cols.indexOf('full_name'),
      team_name: cols.indexOf('team_name'),
      rank_slug: cols.indexOf('rank_slug'),
      is_equipier: cols.indexOf('is_equipier'),
      personal_phone: cols.indexOf('personal_phone'),
      guardian_name: cols.indexOf('guardian_name'),
      guardian_phone: cols.indexOf('guardian_phone'),
      birth_date: cols.indexOf('birth_date'),
      auth_user_id: cols.indexOf('auth_user_id')
    }
    if (idx.full_name === -1) { setErr('عمود full_name مطلوب'); return }
    const payload: any[] = []
    for (const line of rows) {
      if (!line) continue
      const parts = splitCSV(line)
      const full_name = strip(parts[idx.full_name])
      if (!full_name) continue
      const team_name = strip(parts[idx.team_name])
      const rank_slug = strip(parts[idx.rank_slug])
      const team_id = team_name ? (teams.find(t => t.name === team_name)?.id ?? null) : null
      const rank_id = rank_slug ? (ranks.find(r => r.rank_slug === rank_slug)?.id ?? null) : null
      const is_equipier = idx.is_equipier !== -1 ? (parts[idx.is_equipier] === '1' || parts[idx.is_equipier]?.toLowerCase() === 'true') : false
      payload.push({
        full_name,
        team_id,
        rank_id,
        is_equipier,
        personal_phone: idx.personal_phone !== -1 ? strip(parts[idx.personal_phone]) || null : null,
        guardian_name: idx.guardian_name !== -1 ? strip(parts[idx.guardian_name]) || null : null,
        guardian_phone: idx.guardian_phone !== -1 ? strip(parts[idx.guardian_phone]) || null : null,
        birth_date: idx.birth_date !== -1 ? strip(parts[idx.birth_date]) || null : null,
        auth_user_id: idx.auth_user_id !== -1 ? strip(parts[idx.auth_user_id]) || null : null,
      })
    }
    if (!payload.length) { setErr('لا يوجد صفوف صالحة'); return }
    const { error } = await supabase.from('members').insert(payload)
    if (error) { setErr(error.message); return }
    setMsg(`تم استيراد ${payload.length} عضو`)
    await loadMembers()
  }
  function splitCSV(line: string): string[] {
    const res: string[] = []; let cur = ''; let inQ = false
    for (let i=0;i<line.length;i++) {
      const ch=line[i]
      if (ch === '"') {
        if (inQ && line[i+1] === '"') { cur+='"'; i++; } else inQ=!inQ
      } else if (ch === ',' && !inQ) { res.push(cur); cur='' }
      else { cur+=ch }
    }
    res.push(cur); return res
  }
  function strip(s?: string) { if (!s) return ''; return s.replace(/^"|"$/g,'') }

  // ========== Roles assignment ==========
  const [selectedMemberId, setSelectedMemberId] = useState<string>('')
  const [assignRoleId, setAssignRoleId] = useState<number | ''>('')
  const [assignTeamId, setAssignTeamId] = useState<string>('') // optional
  const [memberRoles, setMemberRoles] = useState<UserRoleView[]>([])

  useEffect(() => { if (selectedMemberId) loadMemberRoles(selectedMemberId) }, [selectedMemberId])
  async function loadMemberRoles(memberId: string) {
    const mem = members.find(m => m.id === memberId)
    if (!mem?.auth_user_id) { setMemberRoles([]); return }
    const { data, error } = await supabase.from('user_roles_view').select('user_id, role_slug, team_id').eq('user_id', mem.auth_user_id)
    if (!error) setMemberRoles(data ?? [])
  }
  async function assignRole() {
    setErr(null); setMsg(null)
    const mem = members.find(m => m.id === selectedMemberId)
    if (!mem?.auth_user_id) { setErr('العضو ليس له حساب (auth_user_id)'); return }
    if (assignRoleId === '') { setErr('اختر الدور'); return }
    const payload: any = {
      user_id: mem.auth_user_id,
      role_id: Number(assignRoleId),
      team_id: assignTeamId || null
    }
    const { error } = await supabase.from('user_roles').insert(payload).single()
    if (error) { setErr(error.message); return }
    setMsg('تم تعيين الدور')
    await loadMemberRoles(selectedMemberId)
  }

  // ========== Terms ==========
  const [termName, setTermName] = useState('')
  const [termYear, setTermYear] = useState<number>(new Date().getFullYear())
  const [termStart, setTermStart] = useState('')
  const [termEnd, setTermEnd] = useState('')
  const [termEditId, setTermEditId] = useState<string | null>(null)

  function editTerm(t: Term) {
    setTermEditId(t.id); setTermName(t.name); setTermYear(t.year); setTermStart(t.start_date ?? ''); setTermEnd(t.end_date ?? '')
  }
  async function saveTerm() {
    setErr(null); setMsg(null)
    if (!termName) { setErr('اسم الترم مطلوب'); return }
    const payload: any = { name: termName, year: Number(termYear), start_date: termStart || null, end_date: termEnd || null }
    if (termEditId) {
      const { error } = await supabase.from('terms').update(payload).eq('id', termEditId)
      if (error) { setErr(error.message); return }
      setMsg('تم تحديث الترم')
    } else {
      const { error } = await supabase.from('terms').insert(payload).single()
      if (error) { setErr(error.message); return }
      setMsg('تم إضافة الترم')
    }
    setTermEditId(null); setTermName(''); setTermYear(new Date().getFullYear()); setTermStart(''); setTermEnd('')
    const { data } = await supabase.from('terms').select('id, name, year, start_date, end_date').order('year', { ascending: false }).order('name', { ascending: true })
    setTerms(data ?? [])
  }

  // ========== Field Zones ==========
  const [zones, setZones] = useState<FieldZone[]>([])
  const [zName, setZName] = useState('')
  const [zActive, setZActive] = useState(true)
  const [zEditId, setZEditId] = useState<string | null>(null)

  useEffect(() => { loadZones() }, [])
  async function loadZones() {
    const { data, error } = await supabase.from('field_zones').select('id, name, active').order('name')
    if (!error) setZones(data ?? [])
  }
  function editZone(z: FieldZone) { setZEditId(z.id); setZName(z.name); setZActive(z.active) }
  async function saveZone() {
    setErr(null); setMsg(null)
    if (!zName) { setErr('اسم القطاع مطلوب'); return }
    const payload: any = { name: zName, active: zActive }
    if (zEditId) {
      const { error } = await supabase.from('field_zones').update(payload).eq('id', zEditId)
      if (error) { setErr(error.message); return }
      setMsg('تم تحديث القطاع')
    } else {
      const { error } = await supabase.from('field_zones').insert(payload).single()
      if (error) { setErr(error.message); return }
      setMsg('تم إضافة القطاع')
    }
    setZEditId(null); setZName(''); setZActive(true)
    await loadZones()
  }

  // ========== Team Links (Images/Program) ==========
  const [links, setLinks] = useState<TeamLink[]>([])
  const [selTeam, setSelTeam] = useState<string>('')
  const [imgUrl, setImgUrl] = useState('')
  const [progUrl, setProgUrl] = useState('')

  useEffect(() => { loadLinks() }, [])
  async function loadLinks() {
    const { data, error } = await supabase.from('team_links').select('id, team_id, kind, url').order('team_id')
    if (!error) setLinks(data as any ?? [])
  }
  useEffect(() => {
    const imgs = links.find(l => l.team_id === selTeam && l.kind === 'images')
    const progs = links.find(l => l.team_id === selTeam && l.kind === 'program')
    setImgUrl(imgs?.url ?? ''); setProgUrl(progs?.url ?? '')
  }, [selTeam, links])

  async function saveLinks() {
    setErr(null); setMsg(null)
    if (!selTeam) { setErr('اختر فريق'); return }
    const payload = [
      { team_id: selTeam, kind: 'images', url: imgUrl },
      { team_id: selTeam, kind: 'program', url: progUrl },
    ]
    const { error } = await supabase.from('team_links').upsert(payload, { onConflict: 'team_id,kind' })
    if (error) { setErr(error.message); return }
    setMsg('تم حفظ الروابط')
    await loadLinks()
  }

  // ========== Stats (views) ==========
  const [statsRank, setStatsRank] = useState<any[]>([])
  const [statsFinance, setStatsFinance] = useState<any[]>([])
  const [statsAbsence, setStatsAbsence] = useState<any[]>([])
  const [statsEval, setStatsEval] = useState<any[]>([])
  const [selTerm, setSelTerm] = useState<string>('')

  useEffect(() => { loadStats(); }, [])
  useEffect(() => { if (terms.length && !selTerm) setSelTerm(terms[0].id) }, [terms])
  useEffect(() => { if (selTerm) loadAbsenceForTerm(selTerm) }, [selTerm])

  async function loadStats() {
    const [v1, v2, v4] = await Promise.all([
      supabase.from('v_rank_counts_by_team').select('*'),
      supabase.from('v_finance_summary').select('*'),
      supabase.from('v_eval_coverage').select('*'),
    ])
    if (!v1.error) setStatsRank(v1.data ?? [])
    if (!v2.error) setStatsFinance(v2.data ?? [])
    if (!v4.error) setStatsEval(v4.data ?? [])
  }
  async function loadAbsenceForTerm(termId: string) {
    const { data, error } = await supabase.from('v_chefs_high_absence').select('*').eq('term_id', termId)
    if (!error) setStatsAbsence(data ?? [])
  }

  // ========== UI ==========
  if (!isAdmin) return <div className="p-6">تحتاج صلاحية Admin للدخول هنا.</div>

  return (
    <div className="p-6 space-y-6">
      <div className="tabs">
        <button className={`tab ${tab==='members'?'tab-active':''}`} onClick={()=>setTab('members')}>Members</button> <br />
        <button className={`tab ${tab==='roles'?'tab-active':''}`} onClick={()=>setTab('roles')}>Roles</button><br />
        <button className={`tab ${tab==='terms'?'tab-active':''}`} onClick={()=>setTab('terms')}>Terms</button><br />
        {/* <button className={`tab ${tab==='field'?'tab-active':''}`} onClick={()=>setTab('field')}>Field Zones</button><br /> */}
        {/* <button className={`tab ${tab==='links'?'tab-active':''}`} onClick={()=>setTab('links')}>Team Links</button><br /> */}
        <button className={`tab ${tab==='stats'?'tab-active':''}`} onClick={()=>setTab('stats')}>Statistics</button><br />
      </div>

      {msg && <div className="text-green-700 text-sm">{msg}</div>}
      {err && <div className="text-red-600 text-sm">{err}</div>}

      {tab === 'members' && (
        <div className="space-y-6">
          <div className="card space-y-3">
            <h2 className="text-lg font-bold">إضافة/تعديل عضو</h2>

            {/* ✅ Grid responsive + inputs full width + min-w-0 لمنع overflow */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <input className="border rounded-xl p-2 w-full min-w-0" placeholder="الاسم الكامل" value={mFull} onChange={e=>setMFull(e.target.value)} />

              <select className="border rounded-xl p-2 w-full min-w-0" value={mTeam} onChange={e=>setMTeam(e.target.value)}>
                <option value="">— فريق —</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>

              <select className="border rounded-xl p-2 w-full min-w-0" value={mRank === '' ? '' : String(mRank)} onChange={e=>setMRank(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— رتبة —</option>
                {ranks.map(r => <option key={r.id} value={r.id}>{r.rank_label}</option>)}
              </select>

              <label className="text-sm flex items-center gap-2 w-full min-w-0">
                <input type="checkbox" checked={mEquipier} onChange={e=>setMEquipier(e.target.checked)} /> Equipier
              </label>

              <input className="border rounded-xl p-2 w-full min-w-0" placeholder="تليفون شخصي" value={mPhone} onChange={e=>setMPhone(e.target.value)} />
              <input className="border rounded-xl p-2 w-full min-w-0" placeholder="اسم ولي الأمر" value={mGName} onChange={e=>setMGName(e.target.value)} />
              <input className="border rounded-xl p-2 w-full min-w-0" placeholder="تليفون ولي الأمر" value={mGPhone} onChange={e=>setMGPhone(e.target.value)} />
              <input type="date" className="border rounded-xl p-2 w-full min-w-0" value={mBirth} onChange={e=>setMBirth(e.target.value)} />

              <input className="border rounded-xl p-2 w-full min-w-0 md:col-span-2" placeholder="auth_user_id (اختياري)" value={mAuth} onChange={e=>setMAuth(e.target.value)} />

              <div className="md:col-span-2 flex justify-end">
                <button className="btn btn-brand" onClick={saveMember}>{mEditId ? 'تحديث' : 'إضافة'}</button>
              </div>
            </div>
          </div>

          <div className="card space-y-3">
            {/* ✅ فلاتر تلفّ على الموبايل */}
            <div className="flex flex-wrap gap-2">
              <input className="border rounded-xl p-2 flex-1 min-w-[200px]" placeholder="بحث بالاسم..." value={q} onChange={e=>setQ(e.target.value)} />
              <select className="border rounded-xl p-2" value={fltTeam} onChange={e=>setFltTeam(e.target.value)}>
                <option value="">كل الفرق</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select className="border rounded-xl p-2" value={fltRank === '' ? '' : String(fltRank)} onChange={e=>setFltRank(e.target.value ? Number(e.target.value) : '')}>
                <option value="">كل الرتب</option>
                {ranks.map(r => <option key={r.id} value={r.id}>{r.rank_label}</option>)}
              </select>
              <label className="text-sm flex items-center gap-2">
                <input type="checkbox" checked={onlyEquipiers} onChange={e=>setOnlyEquipiers(e.target.checked)} /> Equipier فقط
              </label>
              <button className="btn border" onClick={exportMembersCSV}>تصدير CSV</button>
              <input type="file" accept=".csv" className="hidden" ref={fileRef} onChange={e=>{ const f = e.target.files?.[0]; if (f) importMembersCSV(f) }} />
              <button className="btn border" onClick={()=>fileRef.current?.click()}>استيراد CSV</button>
            </div>

            {/* ✅ Responsive table wrapper */}
            <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[1000px] text-xs sm:text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2 text-start">الاسم</th>
                    <th className="p-2">الفريق</th>
                    <th className="p-2">الرتبة</th>
                    <th className="p-2">Equipier</th>
                    <th className="p-2">هاتف</th>
                    <th className="p-2">ولي الأمر</th>
                    <th className="p-2">تليفون ولي الأمر</th>
                    <th className="p-2">الميلاد</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers().map(m => (
                    <tr key={m.id} className="border-t">
                      <td className="p-2 whitespace-normal break-words">{m.full_name}</td>
                      <td className="p-2 whitespace-normal break-words">{teams.find(t=>t.id===m.team_id)?.name ?? '—'}</td>
                      <td className="p-2 text-center whitespace-nowrap">{ranks.find(r=>r.id===m.rank_id)?.rank_label ?? '—'}</td>
                      <td className="p-2 text-center whitespace-nowrap">{m.is_equipier ? '✓' : '—'}</td>
                      <td className="p-2 whitespace-normal break-words">{m.personal_phone ?? '—'}</td>
                      <td className="p-2 whitespace-normal break-words">{m.guardian_name ?? '—'}</td>
                      <td className="p-2 whitespace-normal break-words">{m.guardian_phone ?? '—'}</td>
                      <td className="p-2 whitespace-nowrap">{m.birth_date ?? '—'}</td>
                      <td className="p-2 text-center"><button className="text-sm" onClick={()=>editMember(m)}>تعديل</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'roles' && (
        <div className="space-y-6">
          <div className="card space-y-3">
            <h2 className="text-lg font-bold">تعيين دور</h2>
            {/* ✅ Grid responsive في الفورم */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <select className="border rounded-xl p-2 w-full min-w-0" value={selectedMemberId} onChange={e=>setSelectedMemberId(e.target.value)}>
                <option value="">— اختر عضو —</option>
                {members.filter(m => m.auth_user_id).map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select>
              <select className="border rounded-xl p-2 w-full min-w-0" value={assignRoleId === '' ? '' : String(assignRoleId)} onChange={e=>setAssignRoleId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— اختر دور —</option>
                {rolesList.map(r => <option key={r.id} value={r.id}>{r.role_label}</option>)}
              </select>
              <select className="border rounded-xl p-2 w-full min-w-0" value={assignTeamId} onChange={e=>setAssignTeamId(e.target.value)}>
                <option value="">— Global —</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button className="btn btn-brand w-full md:w-auto">تعيين</button>
            </div>
            <div className="text-xs text-gray-500">* Global يعني الدور بدون فريق (مثل Admin/Ancien)</div>
          </div>

          <div className="card space-y-3">
            <h3 className="font-semibold">الأدوار الحالية للعضو</h3>
            <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[480px] text-xs sm:text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2">الدور</th>
                    <th className="p-2">الفريق</th>
                  </tr>
                </thead>
                <tbody>
                  {memberRoles.map(r => (
                    <tr key={`${r.user_id}-${r.role_slug}-${r.team_id ?? 'global'}`} className="border-t">
                      <td className="p-2 whitespace-normal break-words">{rolesList.find(x=>x.role_slug===r.role_slug)?.role_label ?? r.role_slug}</td>
                      <td className="p-2 whitespace-normal break-words">{r.team_id ? (teams.find(t=>t.id===r.team_id)?.name ?? r.team_id) : 'Global'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'terms' && (
        <div className="space-y-6">
          <div className="card space-y-3">
            <h2 className="text-lg font-bold">Terms</h2>
            {/* ✅ Grid responsive للفورم */}
            <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-5 gap-3">
              <input className="border rounded-xl p-2 w-full min-w-0" placeholder="اسم الترم" value={termName} onChange={e=>setTermName(e.target.value)} />
              <input type="number" className="border rounded-xl p-2 w-full min-w-0" placeholder="السنة" value={termYear} onChange={e=>setTermYear(Number(e.target.value))} />
              <input type="date" className="border rounded-xl p-2 w-full min-w-0" value={termStart} onChange={e=>setTermStart(e.target.value)} />
              <input type="date" className="border rounded-xl p-2 w-full min-w-0" value={termEnd} onChange={e=>setTermEnd(e.target.value)} />
              <button className="btn btn-brand w-full md:w-auto" onClick={saveTerm}>{termEditId ? 'تحديث' : 'إضافة'}</button>
            </div>
          </div>

          <div className="card space-y-3">
            <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[700px] text-xs sm:text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2">الاسم</th>
                    <th className="p-2">السنة</th>
                    <th className="p-2">من</th>
                    <th className="p-2">إلى</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {terms.map(t => (
                    <tr key={t.id} className="border-t">
                      <td className="p-2 whitespace-normal break-words">{t.name}</td>
                      <td className="p-2 text-center whitespace-nowrap">{t.year}</td>
                      <td className="p-2 whitespace-nowrap">{t.start_date ?? '—'}</td>
                      <td className="p-2 whitespace-nowrap">{t.end_date ?? '—'}</td>
                      <td className="p-2 text-center">
                        <button className="text-sm" onClick={()=>editTerm(t)}>تعديل</button>
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
            <h2 className="text-lg font-bold">Field Zones</h2>
            {/* ✅ Grid responsive للفورم */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <input className="border rounded-xl p-2 w-full min-w-0" placeholder="اسم القطاع (A1/A2/...)" value={zName} onChange={e=>setZName(e.target.value)} />
              <label className="text-sm flex items-center gap-2 w-full min-w-0">
                <input type="checkbox" checked={zActive} onChange={e=>setZActive(e.target.checked)} /> نشط
              </label>
              <button className="btn btn-brand w-full md:w-auto" onClick={saveZone}>{zEditId ? 'تحديث' : 'إضافة'}</button>
            </div>
          </div>
          <div className="card space-y-3">
            <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs sm:text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2">القطاع</th>
                    <th className="p-2">نشط</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {zones.map(z => (
                    <tr key={z.id} className="border-t">
                      <td className="p-2 whitespace-normal break-words">{z.name}</td>
                      <td className="p-2 text-center whitespace-nowrap">{z.active ? '✓' : '—'}</td>
                      <td className="p-2 text-center"><button className="text-sm" onClick={()=>editZone(z)}>تعديل</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'links' && (
        <div className="space-y-6">
          <div className="card space-y-3">
            <h2 className="text-lg font-bold">Team Links</h2>
            {/* ✅ Grid responsive للفورم */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select className="border rounded-xl p-2 w-full min-w-0" value={selTeam} onChange={e=>setSelTeam(e.target.value)}>
                <option value="">— اختر فريق —</option>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <input className="border rounded-xl p-2 w-full min-w-0" placeholder="رابط الصور (Drive)" value={imgUrl} onChange={e=>setImgUrl(e.target.value)} />
              <input className="border rounded-xl p-2 w-full min-w-0" placeholder="رابط المنهج (Drive)" value={progUrl} onChange={e=>setProgUrl(e.target.value)} />
              <div className="md:col-span-3 flex justify-end">
                <button className="btn btn-brand">حفظ</button>
              </div>
            </div>
          </div>

          <div className="card space-y-3">
            <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[800px] text-xs sm:text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2">الفريق</th>
                    <th className="p-2">Images</th>
                    <th className="p-2">Program</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map(t => {
                    const img = links.find(l=>l.team_id===t.id && l.kind==='images')?.url ?? '—'
                    const prog = links.find(l=>l.team_id===t.id && l.kind==='program')?.url ?? '—'
                    return (
                      <tr key={t.id} className="border-t">
                        <td className="p-2 whitespace-normal break-words">{t.name}</td>
                        <td className="p-2 break-all">{img}</td>
                        <td className="p-2 break-all">{prog}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'stats' && (
        <div className="space-y-6">
          <div className="card space-y-2">
            <h3 className="font-semibold">توزيع الرتب حسب الفريق</h3>
            <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[600px] text-xs sm:text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2">الفريق</th>
                    <th className="p-2">الرتبة</th>
                    <th className="p-2">عدد</th>
                  </tr>
                </thead>
                <tbody>
                  {statsRank.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 whitespace-normal break-words">{r.team_name}</td>
                      <td className="p-2 whitespace-normal break-words">{r.rank_label}</td>
                      <td className="p-2 text-center whitespace-nowrap">{r.member_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card space-y-2">
            <h3 className="font-semibold">الشفات غيابهم &gt; 50%</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-sm">الترم</label>
                <select className="w-full border rounded-xl p-2" value={selTerm} onChange={e=>setSelTerm(e.target.value)}>
                  {terms.map(t => <option key={t.id} value={t.id}>{t.year} — {t.name}</option>)}
                </select>
              </div>
            </div>
            <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[800px] text-xs sm:text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2">الاسم</th>
                    <th className="p-2">الفريق</th>
                    <th className="p-2">حضور</th>
                    <th className="p-2">غياب</th>
                    <th className="p-2">% النسبة</th>
                  </tr>
                </thead>
                <tbody>
                  {statsAbsence.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 whitespace-normal break-words">{r.full_name}</td>
                      <td className="p-2 whitespace-normal break-words">{r.team_name}</td>
                      <td className="p-2 text-center whitespace-nowrap">{r.present_count}</td>
                      <td className="p-2 text-center whitespace-nowrap">{r.absent_count}</td>
                      <td className="p-2 text-center whitespace-nowrap">{r.absent_pct}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card space-y-2">
            <h3 className="font-semibold">الميزانيات</h3>
            <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[900px] text-xs sm:text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2">السنة/الترم</th>
                    <th className="p-2">الفريق</th>
                    <th className="p-2">الميزانية</th>
                    <th className="p-2">المصروف</th>
                    <th className="p-2">المتبقي</th>
                    <th className="p-2">% متبقي</th>
                  </tr>
                </thead>
                <tbody>
                  {statsFinance.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 whitespace-nowrap">{r.year} — {r.term_name}</td>
                      <td className="p-2 whitespace-normal break-words">{r.team_name}</td>
                      <td className="p-2 text-center whitespace-nowrap">{r.budget_total ?? '—'}</td>
                      <td className="p-2 text-center whitespace-nowrap">{r.spent}</td>
                      <td className="p-2 text-center whitespace-nowrap">{r.remaining}</td>
                      <td className="p-2 text-center whitespace-nowrap">{r.pct_remaining ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card space-y-2">
            <h3 className="font-semibold">التقييمات</h3>
            <div className="border rounded-2xl w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-[800px] text-xs sm:text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2">السنة/الترم</th>
                    <th className="p-2">الفريق</th>
                    <th className="p-2">إجمالي الشُفاة</th>
                    <th className="p-2">تم تقييمهم</th>
                    <th className="p-2">متبقين</th>
                  </tr>
                </thead>
                <tbody>
                  {statsEval.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 whitespace-nowrap">{r.year} — {r.term_name}</td>
                      <td className="p-2 whitespace-normal break-words">{r.team_name}</td>
                      <td className="p-2 text-center whitespace-nowrap">{r.total_chefs}</td>
                      <td className="p-2 text-center whitespace-nowrap">{r.evaluated_chefs}</td>
                      <td className="p-2 text-center whitespace-nowrap">{r.pending_chefs}</td>
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
