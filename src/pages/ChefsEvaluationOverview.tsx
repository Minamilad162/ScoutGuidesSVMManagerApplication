import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { LoadingButton } from '../components/ui/LoadingButton'
import { useToast } from '../components/ui/Toaster'

// ===== Types =====
type Team = { id: string; name: string }
type Rank = { id: number; rank_label: string | null; rank_slug?: string | null }
type Member = { id: string; full_name: string; is_equipier: boolean; team_id: string; rank_id: number | null }

type EvalRow = { member_id: string; year: number; review_text: string | null; score: number | null; updated_at?: string | null }
type VoteRow = { member_id: string; year: number; voter_user_id: string; promote: boolean | null; exceptional: boolean | null }

type AttendanceSummary = { present: number; total: number; pct: number }

type RoleRow = { role_slug: string; team_id: string | null }

type Term = { id: string; name: string; year: number }
// تقييم ترم (from public.evaluations)
type TermEvaluation = {
  id: string
  evaluatee_member_id: string
  evaluator_user_id: string
  team_id: string | null
  term_id: string | null
  auto_present_count: number | null
  auto_absent_count: number | null
  positive_note: string | null
  negative_note: string | null
  development_plan: string | null
  created_at: string | null
  updated_at: string | null
}

type Voter = { user_id: string; name: string; team_id: string | null }
type AdminVoteDraft = Record<string, { promote: boolean|null; exceptional: boolean|null }>

// ===== Helpers =====
const THIS_YEAR = new Date().getFullYear()
const pctBadge = (p: number) =>
  p >= 80 ? 'bg-emerald-50 border border-emerald-300 text-emerald-700'
: p >= 60 ? 'bg-amber-50 border border-amber-300 text-amber-700'
:           'bg-rose-50 border border-rose-300 text-rose-700'

function cls(...xs: (string|false|undefined)[]) { return xs.filter(Boolean).join(' ') }

// ترتيب الترقية من الأقل للأعلى
const PROMOTION_ORDER = ['sous_chef','aide','assistant','chef_de_legion'] as const

// ==== Modal (mobile-first, fullscreen on small screens, centered card on desktop) ====
function Modal(props: { open: boolean; onClose: ()=>void; title?: string; children: any; footer?: any }) {
  if (!props.open) return null
  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <button
        className="fixed inset-0 bg-black/30"
        onClick={props.onClose}
        aria-label="Close overlay"
      />
      {/* Shell: full height on mobile, centered card on ≥sm */}
      <div className="fixed inset-x-0 bottom-0 top-0 sm:inset-0 sm:grid sm:place-items-center p-0 sm:p-3 z-[80]">
        <div className="flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[85vh] sm:w-[min(100%,900px)] sm:rounded-2xl sm:border sm:shadow-xl">
          {/* Header (sticky) */}
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b sticky top-0 bg-white z-10">
            <div className="text-base sm:text-lg font-bold truncate">{props.title}</div>
            <button className="burger -mr-1 p-2" onClick={props.onClose} aria-label="Close">×</button>
          </div>
          {/* Content (scrollable) */}
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{props.children}</div>
          {/* Footer (sticky) */}
          {props.footer && (
            <div className="border-t px-4 py-3 bg-white sticky bottom-0">
              <div className="flex items-center justify-end gap-2 flex-wrap">
                {props.footer}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Toggle pill (نعم/لا)
function TogglePill({active, onClick, yes}:{active:boolean; onClick:()=>void; yes:boolean}) {
  return (
    <button type="button" onClick={onClick}
      className={cls('px-3 py-1 rounded-full text-xs border',
        yes ? (active ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-emerald-700 border-emerald-300')
            : (active ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-white text-rose-700 border-rose-300')
      )}
    >{yes ? 'نعم' : 'لا'}</button>
  )
}

export default function ChefsEvaluationOverview() {
  const toast = useToast()

  // load state
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // filters
  const [year, setYear] = useState<number>(THIS_YEAR)
  const [teams, setTeams] = useState<Team[]>([])
  const [allowedTeamIds, setAllowedTeamIds] = useState<string[]>([])
  const [teamId, setTeamId] = useState<'all'|string>('all')
  const [ranks, setRanks] = useState<Rank[]>([])
  const [rankId, setRankId] = useState<'all'|number>('all')
  const [search, setSearch] = useState('')
  const [onlyPromoted, setOnlyPromoted] = useState(false)
  const [onlyExceptional, setOnlyExceptional] = useState(false)

  // role flags
  const [isAdmin, setIsAdmin] = useState(false)
  const [canVote, setCanVote] = useState(false)
  const [myUserId, setMyUserId] = useState<string|undefined>()

  // data
  const [members, setMembers] = useState<Member[]>([])
  const [evaluations, setEvaluations] = useState<Record<string, EvalRow>>({})
  const [votes, setVotes] = useState<Record<string, VoteRow[]>>({})
  const [attendance, setAttendance] = useState<Record<string, AttendanceSummary>>({})

  // modal core
  const [activeId, setActiveId] = useState<string|null>(null)
  const [reviewText, setReviewText] = useState('') // التقييم النهائي
  const [score, setScore] = useState('')           // الدرجة النهائية

  // chef vote (self) & admin bulk votes
  const [myVote, setMyVote] = useState<{ promote: boolean|null; exceptional: boolean|null }>({ promote: null, exceptional: null })
  const [voters, setVoters] = useState<Voter[]>([])
  const [adminVotesDraft, setAdminVotesDraft] = useState<AdminVoteDraft>({})

  // terms (for viewing per-term evaluations and Q&A)
  const [terms, setTerms] = useState<Term[]>([])
  const [termViewId, setTermViewId] = useState<string>('')
  const [termEval, setTermEval] = useState<TermEvaluation | null>(null)
  const [termQuestions, setTermQuestions] = useState<Array<{id:any; text:string}>>([])
  const [termAnswers, setTermAnswers] = useState<Record<string, string|number|null>>({}) // (احتياطي للعرض فقط)

  // نموذج الأسئلة (نعم/لا + نسبة) + حفظه
  const [qaDraft, setQaDraft] = useState<Record<string, { yes: boolean|null; pct: number|null }>>({})
  const [savingQA, setSavingQA] = useState(false)

  // maps
  const teamMap = useMemo(() => Object.fromEntries(teams.map(t => [t.id, t.name])), [teams])
  const rankMap = useMemo(() => Object.fromEntries(ranks.map(r => [r.id, r.rank_label || '—'])), [ranks])

  // خرائط إضافية للترقية حسب الـslug
  const idToSlug = useMemo(() => {
    const m = new Map<number, string|null>()
    ranks.forEach(r => m.set(r.id, r.rank_slug ?? null))
    return m
  }, [ranks])
  const slugToId = useMemo(() => {
    const m = new Map<string, number>()
    ranks.forEach(r => { if (r.rank_slug) m.set(r.rank_slug, r.id) })
    return m
  }, [ranks])

  // ===== Init: roles + teams + ranks + terms + voters =====
  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      try { const { data } = await supabase.auth.getUser(); setMyUserId(data.user?.id) } catch {}

      // roles
      const { data: roles } = await supabase.from('v_my_roles').select('role_slug,team_id')
      const rr: RoleRow[] = (roles as any[]) ?? []
      const _isAdmin = rr.some(r => r.role_slug === 'admin' || (r.role_slug === 'responsable_secretary' && r.team_id == null))
      setIsAdmin(_isAdmin)
      const _canVote = rr.some(r => r.role_slug === 'admin' || r.role_slug === 'chef_de_legion')
      setCanVote(_canVote)

      // allowed teams
      let teamsData: Team[] = []
      if (_isAdmin) {
        const { data: ts } = await supabase.from('teams').select('id,name').order('name')
        teamsData = (ts as any) ?? []
        setAllowedTeamIds(teamsData.map(t => t.id))
        setTeamId('all')
      } else {
        const { data: myR } = await supabase.from('v_my_roles').select('team_id').eq('role_slug','chef_de_legion')
        const myTeamIds = ((myR as any[]) ?? []).map(r => String(r.team_id)).filter(Boolean)
        setAllowedTeamIds(myTeamIds)
        if (myTeamIds.length) setTeamId(myTeamIds[0]!)
        const { data: ts } = await supabase.from('teams').select('id,name').in('id', myTeamIds as any)
        teamsData = (ts as any) ?? []
      }
      setTeams(teamsData)

      // ranks (جابنا كمان rank_slug)
      const { data: rs } = await supabase.from('ranks').select('id,rank_label,rank_slug').order('id')
      setRanks((rs as any) ?? [])

      // terms (for term evaluations viewer)
      const { data: ts2 } = await supabase.from('terms').select('id,name,year').order('year',{ascending:false}).order('name',{ascending:true})
      setTerms((ts2 as any) ?? [])

      // ===== voters (admin only): استخدم user_roles_view =====
      if (_isAdmin) {
        const { data: vr, error: vrErr } = await supabase
          .from('user_roles_view')
          .select('user_id, role_slug')
          .in('role_slug', ['chef_de_legion', 'admin'])
        if (vrErr) throw vrErr

        const vrRows = ((vr as any[]) ?? [])
        const userIds = Array.from(new Set(vrRows.map(r => r.user_id)))

        // أسماء من members حسب auth_user_id (غير الإكويبيير)
        const { data: ms } = await supabase
          .from('members')
          .select('auth_user_id, full_name')
          .eq('is_equipier', false)
          .in('auth_user_id', userIds as any)

        const mMap = new Map<string, string>()
        ;((ms as any[]) ?? []).forEach((m:any)=>{ if (m.auth_user_id) mMap.set(m.auth_user_id, m.full_name) })

        const uniq = new Map<string, Voter>()
        vrRows.forEach((r:any) => {
          const name = mMap.get(r.user_id) || (r.role_slug === 'admin' ? 'Admin' : 'Chef')
          if (!uniq.has(r.user_id)) uniq.set(r.user_id, { user_id: r.user_id, name, team_id: null })
        })
        const votersList = Array.from(uniq.values()).sort((a,b)=> (a.name||'').localeCompare(b.name||'', 'ar'))
        setVoters(votersList)
      }
      // ===== /voters =====

    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally { setLoading(false) }
  }

  // ===== Load members when team/year change =====
  useEffect(() => { if (allowedTeamIds.length) loadMembers() }, [allowedTeamIds, teamId])
  async function loadMembers() {
    setLoading(true)
    try {
      let q = supabase.from('members').select('id,full_name,is_equipier,team_id,rank_id').eq('is_equipier', false) as any
      if (teamId !== 'all') q = q.eq('team_id', teamId)
      else q = q.in('team_id', allowedTeamIds as any)
      const { data, error } = await q.order('full_name', { ascending: true })
      if (error) throw error
      const arr: Member[] = (data as any) ?? []
      setMembers(arr)

      const ids = arr.map(m => m.id)
      if (ids.length) {
        await Promise.all([loadEvaluations(ids), loadVotes(ids), loadAttendance(ids)])
      } else {
        setEvaluations({}); setVotes({}); setAttendance({})
      }
    } catch (e:any) { toast.error(e.message || 'تعذر تحميل القادة') }
    finally { setLoading(false) }
  }

  async function loadEvaluations(memberIds: string[]) {
    try {
      const { data } = await supabase
        .from('final_evaluations')
        .select('member_id,year,review_text,score,updated_at')
        .eq('year', year).in('member_id', memberIds)
      const map: Record<string, EvalRow> = {}
      ;((data as any[]) ?? []).forEach(r => { map[r.member_id] = r })
      setEvaluations(map)
    } catch { setEvaluations({}) }
  }

  async function loadVotes(memberIds: string[]) {
    try {
      const { data } = await supabase
        .from('final_votes')
        .select('member_id,year,voter_user_id,promote,exceptional')
        .eq('year', year).in('member_id', memberIds)
      const map: Record<string, VoteRow[]> = {}
      ;((data as any[]) ?? []).forEach(v => { (map[v.member_id] ||= []).push(v) })
      setVotes(map)
    } catch { setVotes({}) }
  }

  async function loadAttendance(memberIds: string[]) {
    try {
      const start = `${year}-01-01`, end = `${year}-12-31`
      const { data, error } = await supabase
        .from('attendance')
        .select('member_id,is_present,meetings!inner(team_id,meeting_date,mtype)')
        .gte('meetings.meeting_date', start)
        .lte('meetings.meeting_date', end)
        .in('member_id', memberIds)
      if (error) throw error
      const map: Record<string, AttendanceSummary> = {}
      ;((data as any[]) ?? []).forEach(r => {
        const m = Array.isArray(r.meetings) ? r.meetings[0] : r.meetings
        if (!m) return
        if (!map[r.member_id]) map[r.member_id] = { present: 0, total: 0, pct: 0 }
        map[r.member_id].total += 1
        if (r.is_present) map[r.member_id].present += 1
      })
      Object.values(map).forEach(v => v.pct = v.total ? Math.round((v.present/v.total)*100) : 0)
      setAttendance(map)
    } catch { setAttendance({}) }
  }

  // ===== Derived =====
  const filtered = useMemo(() => {
    let arr = members
    if (teamId !== 'all') arr = arr.filter(m => m.team_id === teamId)
    if (rankId !== 'all') arr = arr.filter(m => (m.rank_id ?? -1) === rankId)
    if (search.trim()) {
      const s = search.toLowerCase()
      arr = arr.filter(m => m.full_name.toLowerCase().includes(s) || (teamMap[m.team_id]?.toLowerCase().includes(s)))
    }
    if (onlyPromoted || onlyExceptional) {
      arr = arr.filter(m => {
        const vs = votes[m.id] || []
        const c = vs.length
        const promoted = c ? vs.filter(v => v.promote).length > c/2 : false
        const exc = c ? vs.filter(v => v.exceptional).length > c/2 : false
        return (onlyPromoted ? promoted : true) && (onlyExceptional ? exc : true)
      })
    }
    return arr
  }, [members, teamId, rankId, search, onlyPromoted, onlyExceptional, votes, teamMap])

  // ===== Rank counts (cards) — before =====
  const countsBefore = useMemo(() => {
    const m = new Map<number, number>()
    filtered.forEach(x => { if (x.rank_id != null) m.set(x.rank_id, (m.get(x.rank_id) || 0) + 1) })
    return ranks.map(r => ({ id: r.id, label: r.rank_label || '—', count: m.get(r.id) || 0 }))
  }, [filtered, ranks])

  // ===== Rank counts (cards) — after promotion by majority =====
  const countsAfter = useMemo(() => {
    const m = new Map<number, number>()

    filtered.forEach(x => {
      let rid = x.rank_id
      if (rid != null) {
        const vs = votes[x.id] || []
        const c = vs.length
        const promoted = c ? vs.filter(v => v.promote).length > c/2 : false

        if (promoted) {
          const slug = idToSlug.get(rid) || null
          const idx = slug ? PROMOTION_ORDER.indexOf(slug as any) : -1
          if (idx >= 0 && idx < PROMOTION_ORDER.length - 1) {
            const nextSlug = PROMOTION_ORDER[idx + 1]
            const nextId = slugToId.get(nextSlug)
            if (typeof nextId === 'number') {
              rid = nextId
            }
          }
        }
        // زوّد العداد للـrid (سواء اتغيّر أو لا)
        m.set(rid, (m.get(rid) || 0) + 1)
      }
    })

    return ranks.map(r => ({ id: r.id, label: r.rank_label || '—', count: m.get(r.id) || 0 }))
  }, [filtered, ranks, votes, idToSlug, slugToId])

  // ===== Term evaluation viewer (with Q&A) =====
  useEffect(() => {
    if (activeId && termViewId) {
      ;(async () => {
        await loadTermEval(activeId, termViewId)
        await loadTermQA(activeId, termViewId)
      })()
    }
  }, [activeId, termViewId])

  function defaultTermIdForYear(y:number) {
    const list = terms.filter(t => t.year === y)
    return list.length ? list[0].id : (terms[0]?.id || '')
  }

  async function loadTermEval(memberId: string, tId: string) {
    try {
      const { data } = await supabase
        .from('evaluations')
        .select('id,evaluatee_member_id,evaluator_user_id,team_id,term_id,auto_present_count,auto_absent_count,positive_note,negative_note,development_plan,created_at,updated_at')
        .eq('evaluatee_member_id', memberId)
        .eq('term_id', tId)
        .maybeSingle()
      setTermEval((data as any) ?? null)
    } catch { setTermEval(null) }
  }

  async function loadTermQA(memberId: string, tId: string) {
    try {
      const { data: qs } = await supabase.from('evaluation_questions').select('*').order('id')
      const qList: Array<{id:any; text:string}> = ((qs as any[]) ?? []).map((q:any)=>({
        id: q.id,
        text: q.question_text || q.text || q.title || q.content || `سؤال ${q.id}`
      }))
      setTermQuestions(qList)

      let evalId: string | null = termEval?.id || null
      if (!evalId) {
        const { data: ev } = await supabase
          .from('evaluations')
          .select('id')
          .eq('evaluatee_member_id', memberId)
          .eq('term_id', tId)
          .maybeSingle()
        evalId = (ev as any)?.id || null
      }

      if (!evalId) {
        setTermAnswers({})
        setQaDraft({})
        return
      }

      const { data: ans, error: ansErr } = await supabase
        .from('evaluation_answers')
        .select('question_id, answer, weight_percent')
        .eq('evaluation_id', evalId)
      if (ansErr) throw ansErr

      const answersMap: Record<string, string|number|null> = {}
      const draft: Record<string, { yes: boolean|null; pct: number|null }> = {}

      ;((ans as any[]) ?? []).forEach((a:any)=>{
        const qid = String(a.question_id)
        answersMap[qid] = a.weight_percent ?? null
        draft[qid] = {
          yes: (a.answer === true ? true : (a.answer === false ? false : null)),
          pct: (a.weight_percent === null || a.weight_percent === undefined) ? null : Number(a.weight_percent)
        }
      })

      setTermAnswers(answersMap)
      setQaDraft(draft)
    } catch {
      setTermQuestions([]); setTermAnswers({}); setQaDraft({})
    }
  }

  async function saveTermQA() {
    if (!activeId || !termViewId) { toast.error('اختر الترم أولاً'); return }
    if (!termEval?.id) {
      toast.error('لا يوجد تقييم لهذا الترم — أنشئ تقييم الترم أولاً.')
      return
    }
    setSavingQA(true)
    try {
      const rows = termQuestions.map(q => {
        const st = qaDraft[String(q.id)] || { yes: null, pct: null }
        return {
          evaluation_id: termEval!.id,
          question_id: q.id,
          answer: st.yes,
          weight_percent: st.pct
        }
      })
      const { error } = await supabase
        .from('evaluation_answers')
        .upsert(rows, { onConflict: 'evaluation_id,question_id' })
      if (error) throw error
      toast.success('تم حفظ إجابات الأسئلة')
      await loadTermQA(activeId, termViewId)
    } catch (e:any) {
      toast.error(e.message || 'تعذر حفظ الإجابات')
    } finally {
      setSavingQA(false)
    }
  }

  // ===== Prefill admin draft votes when modal opens OR votes/voters change =====
  useEffect(() => {
    if (!isAdmin || !activeId) return
    const vs = votes[activeId] || []
    const draft: AdminVoteDraft = {}
    voters.forEach(v => {
      const ex = vs.find(x => x.voter_user_id === v.user_id)
      if (ex) draft[v.user_id] = { promote: ex.promote, exceptional: ex.exceptional }
    })
    setAdminVotesDraft(draft)
  }, [isAdmin, activeId, voters, votes])

  // ===== Modal open/close =====
  function openModal(id: string) {
    setActiveId(id)
    const ev = evaluations[id]
    setReviewText(ev?.review_text || '')
    setScore(ev?.score != null ? String(ev.score) : '')

    if (canVote) {
      const vs = votes[id] || []
      const mine = myUserId ? vs.find(v => v.voter_user_id === myUserId) : undefined
      setMyVote({ promote: mine?.promote ?? null, exceptional: mine?.exceptional ?? null })
    }

    const def = defaultTermIdForYear(year)
    setTermViewId(def)
  }
  function closeModal() { setActiveId(null) }

  async function saveEvaluation() {
    if (!activeId) return
    setSaving(true)
    try {
      const payload = { member_id: activeId, year, review_text: reviewText.trim() || null, score: score !== '' ? Number(score) : null }
      const { error } = await supabase.from('final_evaluations').upsert(payload, { onConflict: 'member_id,year' })
      if (error) throw error
      toast.success('تم حفظ التقييم النهائي')
      await loadEvaluations([activeId])
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحفظ')
    } finally { setSaving(false) }
  }

  async function saveMyVote() {
    if (!activeId || !myUserId || !canVote) { toast.error('لا يمكن حفظ التصويت'); return }
    setSaving(true)
    try {
      const payload = { member_id: activeId, year, voter_user_id: myUserId, promote: myVote.promote, exceptional: myVote.exceptional }
      const { error } = await supabase.from('final_votes').upsert(payload, { onConflict: 'member_id,year,voter_user_id' })
      if (error) throw error
      toast.success('تم حفظ تصويتك')
      await loadVotes([activeId])
    } catch (e:any) { toast.error(e.message || 'تعذر الحفظ') }
    finally { setSaving(false) }
  }

  async function saveAdminVotes() {
    if (!activeId || !isAdmin) return
    setSaving(true)
    try {
      const rows = Object.entries(adminVotesDraft).map(([user_id, v]) => ({
        member_id: activeId, year, voter_user_id: user_id, promote: v.promote, exceptional: v.exceptional
      }))
      if (rows.length) {
        const { error } = await supabase.from('final_votes').upsert(rows, { onConflict: 'member_id,year,voter_user_id' })
        if (error) throw error
      }
      toast.success('تم حفظ التصويتات')
      await loadVotes([activeId])
    } catch (e:any) { toast.error(e.message || 'تعذر الحفظ') }
    finally { setSaving(false) }
  }

  // ===== UI =====
  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold">التقييم العام — القادة (Chef)</h1>
        <div className="flex items-center gap-2">
          <label className="text-sm">السنة</label>
          <select className="border rounded-xl p-2" value={year} onChange={e=>setYear(Number(e.target.value))}>
            {Array.from({length:6}).map((_,i)=>{ const y=THIS_YEAR-i; return <option key={y} value={y}>{y}</option> })}
          </select>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid md:grid-cols-5 gap-2 items-end">
          <div>
            <label className="text-sm">الفرق</label>
            <select className="border rounded-xl p-2 w-full" value={teamId} onChange={e=>setTeamId(e.target.value as any)}>
              {allowedTeamIds.length>1 && <option value="all">كل الفرق</option>}
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm">الرتبة</label>
            <select className="border rounded-xl p-2 w-full" value={String(rankId)} onChange={e=>setRankId(e.target.value==='all'?'all':Number(e.target.value))}>
              <option value="all">كل الرتب</option>
              {ranks.map(r => <option key={r.id} value={r.id}>{r.rank_label || '—'}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm">بحث</label>
            <input className="border rounded-xl p-2 w-full" placeholder="ابحث بالاسم أو الفريق" value={search} onChange={e=>setSearch(e.target.value)} />
          </div>
          <label className="inline-flex items-center gap-2 text-sm bg-gray-50 border rounded-xl px-3 py-2 cursor-pointer">
            <input type="checkbox" checked={onlyPromoted} onChange={e=>setOnlyPromoted(e.target.checked)} /> المرقَّون (أغلبية)
          </label>
          <label className="inline-flex items-center gap-2 text-sm bg-gray-50 border rounded-xl px-3 py-2 cursor-pointer">
            <input type="checkbox" checked={onlyExceptional} onChange={e=>setOnlyExceptional(e.target.checked)} /> المميّزون (أغلبية)
          </label>
        </div>
      </div>

      {/* ===== Rank stats as CARDS (before) ===== */}
      <div className="space-y-2">
        <div className="font-semibold">إحصائيات الرتب — قبل الترقية</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {countsBefore.map(rc => (
            <div key={`before-${rc.id}`} className="card text-center">
              <div className="text-sm text-gray-600 mb-1">{rc.label}</div>
              <div className="text-2xl font-extrabold">{rc.count}</div>
            </div>
          ))}
          {countsBefore.every(x=>x.count===0) && <div className="card text-center text-gray-500 sm:col-span-2 lg:col-span-4">لا توجد نتائج</div>}
        </div>
      </div>

      {/* ===== Rank stats as CARDS (after) ===== */}
      <div className="space-y-2">
        <div className="font-semibold">إحصائيات الرتب — بعد الترقية (حسب الأغلبية)</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {countsAfter.map(rc => (
            <div key={`after-${rc.id}`} className="card text-center">
              <div className="text-sm text-gray-600 mb-1">{rc.label}</div>
              <div className="text-2xl font-extrabold">{rc.count}</div>
            </div>
          ))}
          {countsAfter.every(x=>x.count===0) && <div className="card text-center text-gray-500 sm:col-span-2 lg:col-span-4">لا توجد نتائج</div>}
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map(m => {
          const att = attendance[m.id] || { present:0,total:0,pct:0 }
          const vs = votes[m.id] || []
          const c = vs.length
          const promoted = c ? vs.filter(v=>v.promote).length > c/2 : false
          const exceptional = c ? vs.filter(v=>v.exceptional).length > c/2 : false
          return (
            <div key={m.id} className="card space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold">{m.full_name}</div>
                <div className="flex items-center gap-2">
                  {promoted && <span className="px-2 py-1 rounded-full bg-emerald-50 border border-emerald-300 text-emerald-700 text-xs">تم الترقية</span>}
                  {exceptional && <span className="px-2 py-1 rounded-full bg-indigo-50 border border-indigo-300 text-indigo-700 text-xs">مميّز</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap text-sm">
                <span className="px-2 py-1 rounded-full bg-gray-50 border">{rankMap[m.rank_id ?? 0] || '—'}</span>
                <span className="px-2 py-1 rounded-full bg-gray-50 border">الفريق: {teamMap[m.team_id] || m.team_id}</span>
                <span className={cls('px-2 py-1 rounded-full text-xs', pctBadge(att.pct))}>الحضور: {att.present} / {att.total} — {att.pct}%</span>
              </div>
              <div className="text-xs text-gray-600">التقييم النهائي: {evaluations[m.id]?.score != null ? `${evaluations[m.id]!.score}%` : '—'}</div>
              <div className="text-end">
                <button className="btn border" onClick={()=>openModal(m.id)}>عرض / تعديل</button>
              </div>
            </div>
          )
        })}
        {filtered.length===0 && (
          <div className="p-6 text-center text-gray-500 border rounded-2xl bg-white md:col-span-2 lg:col-span-3">لا توجد نتائج لعرضها</div>
        )}
      </div>

      {/* Modal */}
      <Modal
        open={!!activeId}
        onClose={closeModal}
        title={activeId ? members.find(x=>x.id===activeId)?.full_name : ''}
        footer={
          <div className="flex items-center gap-2">
            {isAdmin && <LoadingButton loading={saving} onClick={saveAdminVotes}>حفظ التصويت</LoadingButton>}
            {canVote && !isAdmin && <LoadingButton loading={saving} onClick={saveMyVote}>حفظ تصويتي</LoadingButton>}
            <LoadingButton loading={saving} onClick={saveEvaluation}>حفظ التقييم النهائي</LoadingButton>
          </div>
        }
      >
        {activeId && (
          <div className="space-y-5">
            {/* Final evaluation */}
            <div className="border rounded-xl p-3">
              <div className="font-semibold mb-2">التقييم النهائي للسنة {year}</div>
              <div className="grid sm:grid-cols-[1fr,200px] gap-3">
                <div>
                  <label className="text-sm">ملاحظات القائد</label>
                  <textarea className="border rounded-xl p-2 w-full min-h-[110px]" placeholder="اكتب التقييم النهائي..." value={reviewText} onChange={e=>setReviewText(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm">الدرجة النهائية</label>
                  <input type="number" className="border rounded-xl p-2 w-full" placeholder="0–100" value={score}
                    onChange={e=>{ const v=e.target.value; if (v===''||(/^\d{0,3}$/.test(v)&&Number(v)<=100)) setScore(v) }} />
                </div>
              </div>
            </div>

            {/* Term evaluation viewer (questions + answers from DB) */}
            <div className="border rounded-xl p-3">
              <div className="flex items-center gap-2 mb-3">
                <div className="font-semibold">تقييم الترم</div>
                <select className="border rounded-xl p-2 ml-2" value={termViewId} onChange={e=>setTermViewId(e.target.value)}>
                  {terms.map(t => <option key={t.id} value={t.id}>{t.year} — {t.name}</option>)}
                </select>
              </div>
              {termEval ? (
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="text-sm">Positive note</label>
                      <textarea className="border rounded-xl p-2 w-full min-h-[90px]" value={termEval.positive_note || ''} readOnly />
                    </div>
                    <div>
                      <label className="text-sm">Negative note</label>
                      <textarea className="border rounded-xl p-2 w-full min-h-[90px]" value={termEval.negative_note || ''} readOnly />
                    </div>
                    <div className="md:col-span-2">
                      <label className="text-sm">خطة التطوير</label>
                      <textarea className="border rounded-xl p-2 w-full min-h-[80px]" value={termEval.development_plan || ''} readOnly />
                    </div>
                  </div>

                  {/* Q&A — Editable (نعم/لا + نسبة) */}
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-semibold">أسئلة التقييم وإجابات القائد</div>
                      <LoadingButton loading={savingQA} onClick={saveTermQA}>حفظ الإجابات</LoadingButton>
                    </div>
                    <div className="rounded-2xl border overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] text-sm table-auto">
                          <thead className="bg-gray-100">
                            <tr>
                              <th className="p-2 text-start">السؤال</th>
                              <th className="p-2 text-center w-[220px]">الإجابة</th>
                            </tr>
                          </thead>
                          <tbody>
                            {termQuestions.map(q => {
                              const st = qaDraft[String(q.id)] || { yes: null, pct: null }
                              return (
                                <tr key={String(q.id)} className="border-t">
                                  <td className="p-2 align-top">{q.text}</td>
                                  <td className="p-2 text-center align-top">
                                    <div className="flex items-center justify-center gap-2">
                                      <div className="inline-flex gap-2">
                                        <TogglePill yes active={st.yes===true}  onClick={()=>setQaDraft(prev=>({...prev, [String(q.id)]: {...(prev[String(q.id)]||{pct:null}), yes:true }}))} />
                                        <TogglePill yes={false} active={st.yes===false} onClick={()=>setQaDraft(prev=>({...prev, [String(q.id)]: {...(prev[String(q.id)]||{pct:null}), yes:false }}))} />
                                      </div>
                                      <input
                                        type="number"
                                        className="border rounded-xl p-1 w-20 text-center"
                                        placeholder="%"
                                        value={st.pct ?? ''}
                                        onChange={e=>{
                                          const v = e.target.value
                                          const n = Number(v)
                                          if (v==='' || (!Number.isNaN(n) && n>=0 && n<=100)) {
                                            setQaDraft(prev=>({...prev, [String(q.id)]: {...(prev[String(q.id)]||{yes:null}), pct: v===''? null : n }}))
                                          }
                                        }}
                                      />
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                            {termQuestions.length===0 && <tr><td className="p-3 text-center text-gray-500" colSpan={2}>لا توجد أسئلة</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="md:col-span-2 flex items-center gap-2 flex-wrap text-sm">
                    <span className="px-2 py-1 rounded-full bg-white border text-xs">حضور تلقائي: {termEval.auto_present_count ?? 0}</span>
                    <span className="px-2 py-1 rounded-full bg-white border text-xs">غياب تلقائي: {termEval.auto_absent_count ?? 0}</span>
                    <span className="px-2 py-1 rounded-full bg-white border text-xs">آخر تحديث: {termEval.updated_at ? new Date(termEval.updated_at).toLocaleString() : '—'}</span>
                  </div>
                </div>
              ) : (
                <div className="text-gray-500">لا يوجد تقييم لهذا الترم.</div>
              )}
            </div>

            {/* Attendance summary */}
            <div className="border rounded-xl p-3 text-sm">
              <div className="font-semibold mb-2">الحضور (السنة {year})</div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2 py-1 rounded-full bg-white border text-xs">المجموع: {attendance[activeId]?.total ?? 0}</span>
                <span className="px-2 py-1 rounded-full bg-white border text-xs">حضر: {attendance[activeId]?.present ?? 0}</span>
                <span className={cls('px-2 py-1 rounded-full text-xs', pctBadge(attendance[activeId]?.pct ?? 0))}>النسبة: {attendance[activeId]?.pct ?? 0}%</span>
              </div>
            </div>

            {/* Votes */}
            {isAdmin ? (
              <div className="border rounded-xl p-3">
                <div className="font-semibold mb-3">التصويت (بالأسماء) — ترقية / تميّز</div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="p-2 text-start">القائد</th>
                        <th className="p-2 text-center">ترقية</th>
                        <th className="p-2 text-center">تميّز</th>
                      </tr>
                    </thead>
                    <tbody>
                      {voters.map(v => {
                        const st = adminVotesDraft[v.user_id] || { promote:null, exceptional:null }
                        return (
                          <tr key={v.user_id} className="border-t">
                            <td className="p-2">{v.name}</td>
                            <td className="p-2 text-center">
                              <div className="inline-flex gap-2">
                                <TogglePill yes active={st.promote===true}  onClick={()=>setAdminVotesDraft(p=>({...p, [v.user_id]:{...st, promote:true}}))} />
                                <TogglePill yes={false} active={st.promote===false} onClick={()=>setAdminVotesDraft(p=>({...p, [v.user_id]:{...st, promote:false}}))} />
                              </div>
                            </td>
                            <td className="p-2 text-center">
                              <div className="inline-flex gap-2">
                                <TogglePill yes active={st.exceptional===true}  onClick={()=>setAdminVotesDraft(p=>({...p, [v.user_id]:{...st, exceptional:true}}))} />
                                <TogglePill yes={false} active={st.exceptional===false} onClick={()=>setAdminVotesDraft(p=>({...p, [v.user_id]:{...st, exceptional:false}}))} />
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                      {voters.length===0 && <tr><td className="p-3 text-center text-gray-500" colSpan={3}>لا يوجد قادة للتصويت</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : canVote ? (
              <div className="border rounded-xl p-3">
                <div className="font-semibold mb-2">تصويتي</div>
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-sm mb-1">ترقية؟</div>
                    <div className="flex items-center gap-3 text-sm">
                      <TogglePill yes active={myVote.promote===true}  onClick={()=>setMyVote(v=>({...v, promote:true}))} />
                      <TogglePill yes={false} active={myVote.promote===false} onClick={()=>setMyVote(v=>({...v, promote:false}))} />
                      <button className="px-2 py-1 rounded border text-xs" onClick={()=>setMyVote(v=>({...v, promote:null}))}>بلا</button>
                      <span className="ml-auto text-xs text-gray-600">نعم: {(votes[activeId]?.filter(v=>v.promote).length)||0} / {(votes[activeId]?.length)||0}</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm mb-1">تميّز؟</div>
                    <div className="flex items-center gap-3 text-sm">
                      <TogglePill yes active={myVote.exceptional===true}  onClick={()=>setMyVote(v=>({...v, exceptional:true}))} />
                      <TogglePill yes={false} active={myVote.exceptional===false} onClick={()=>setMyVote(v=>({...v, exceptional:false}))} />
                      <button className="px-2 py-1 rounded border text-xs" onClick={()=>setMyVote(v=>({...v, exceptional:null}))}>بلا</button>
                      <span className="ml-auto text-xs text-gray-600">نعم: {(votes[activeId]?.filter(v=>v.exceptional).length)||0} / {(votes[activeId]?.length)||0}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  )
}
