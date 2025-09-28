import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'
import { LoadingButton } from '../components/ui/LoadingButton'

type Team = { id: string; name: string }
type Rank = { id: number; rank_slug: string; rank_label: string }
type Term = { id: string; name: string; year: number }
type Member = { id: string; full_name: string; team_id: string; teams?: { name: string }; rank?: { rank_slug: string; rank_label: string } }
type Question = { id: number; question_text: string; weight: number }

export default function AdminEvaluations() {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [terms, setTerms] = useState<Term[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [ranks, setRanks] = useState<Rank[]>([])

  const [termId, setTermId] = useState<string>('')
  const [teamId, setTeamId] = useState<string>('all')
  const [rankSlug, setRankSlug] = useState<string>('all')

  const [members, setMembers] = useState<Member[]>([])

  // editing state
  const [openId, setOpenId] = useState<string | null>(null)
  const [evalId, setEvalId] = useState<string | null>(null)
  const [present, setPresent] = useState<number>(0)
  const [absent, setAbsent] = useState<number>(0)
  const [positive, setPositive] = useState<string>('')
  const [negative, setNegative] = useState<string>('')
  const [plan, setPlan] = useState<string>('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Record<number, boolean>>({})

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const [{ data: ts, error: te }, { data: tms, error: tme }, { data: rk, error: rke }, { data: qs, error: qse }] = await Promise.all([
        supabase.from('terms').select('id,name,year').order('year', { ascending: false }),
        supabase.from('teams').select('id,name').order('name'),
        supabase.from('ranks').select('id,rank_slug,rank_label').order('id'),
        supabase.from('evaluation_questions').select('id,question_text,weight').eq('active', true).order('id')
      ])
      if (te) throw te; if (tme) throw tme; if (rke) throw rke; if (qse) throw qse
      setTerms((ts as any) ?? [])
      setTeams((tms as any) ?? [])
      setRanks((rk as any) ?? [])
      setQuestions((qs as any) ?? [])
      if (ts && ts.length) setTermId(ts[0].id)
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (termId) loadMembers() }, [termId, teamId, rankSlug])
  async function loadMembers() {
    try {
      let q = supabase.from('members').select('id,full_name,team_id, teams:team_id(name), rank:ranks!inner(rank_slug,rank_label)').eq('is_equipier', false).order('full_name') as any
      if (teamId !== 'all') q = q.eq('team_id', teamId)
      if (rankSlug !== 'all') q = q.eq('rank.rank_slug', rankSlug)
      const { data, error } = await q
      if (error) throw error
      setMembers((data as any) ?? [])
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الأعضاء')
    }
  }

  function resetForm() {
    setEvalId(null); setPresent(0); setAbsent(0); setPositive(''); setNegative(''); setPlan(''); setAnswers({})
  }

  async function openEditor(member: Member) {
    resetForm()
    setOpenId(member.id)
    try {
      // load existing evaluation
      const { data: ev, error: ee } = await supabase
        .from('evaluations')
        .select('id, auto_present_count, auto_absent_count, positive_note, negative_note, development_plan, evaluation_answers(question_id, answer)')
        .eq('evaluatee_member_id', member.id)
        .eq('term_id', termId)
        .maybeSingle()
      if (ee) throw ee
      if (ev) {
        setEvalId(ev.id)
        setPresent(ev.auto_present_count ?? 0)
        setAbsent(ev.auto_absent_count ?? 0)
        setPositive(ev.positive_note ?? '')
        setNegative(ev.negative_note ?? '')
        setPlan(ev.development_plan ?? '')
        const map: Record<number, boolean> = {}
        ;(ev.evaluation_answers ?? []).forEach((a:any) => { map[a.question_id] = !!a.answer })
        setAnswers(map)
      } else {
        // no evaluation yet -> initialize blank
        setEvalId(null)
        setAnswers({})
      }
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل التقييم')
    }
  }

  async function save(member: Member) {
    if (!termId) return toast.error('اختر الترم')
    setSaving(true)
    try {
      // upsert evaluation
      const up = {
        evaluatee_member_id: member.id,
        evaluator_user_id: (await supabase.auth.getUser()).data.user?.id,
        team_id: member.team_id,
        term_id: termId,
        positive_note: positive || null,
        negative_note: negative || null,
        development_plan: plan || null
      }
      const { data: evalRow, error: e1 } = await supabase
        .from('evaluations')
        .upsert(up, { onConflict: 'evaluatee_member_id,term_id' })
        .select('id').maybeSingle()
      if (e1) throw e1

      const eid = evalRow?.id
      if (!eid) throw new Error('تعذر تحديد التقييم')

      // upsert answers in batch
      const rows = Object.entries(answers).map(([qid, ans]) => ({
        evaluation_id: eid,
        question_id: Number(qid),
        answer: !!ans
      }))
      if (rows.length) {
        const { error: e2 } = await supabase
          .from('evaluation_answers')
          .upsert(rows, { onConflict: 'evaluation_id,question_id' })
        if (e2) throw e2
      }

      // recompute presence
      await supabase.rpc('recompute_eval_presence', { p_evaluation_id: eid })

      toast.success('تم الحفظ')
      setOpenId(null)
    } catch (e:any) {
      toast.error(e.message || 'تعذر الحفظ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">التقييمات — (أدمن)</h1>

      <div className="grid md:grid-cols-4 gap-2 items-end">
        <div>
          <label className="text-sm">الترم</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={termId} onChange={e=>setTermId(e.target.value)}>
            {terms.map(t => <option key={t.id} value={t.id}>{t.year} — {t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm">الفريق</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={teamId} onChange={e=>setTeamId(e.target.value)}>
            <option value="all">كل الفرق</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm">الرتبة</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={rankSlug} onChange={e=>setRankSlug(e.target.value)}>
            <option value="all">الكل</option>
            {ranks.map(r => <option key={r.id} value={r.rank_slug}>{r.rank_label}</option>)}
          </select>
        </div>
      </div>

      <div className="border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-start">الاسم</th>
              <th className="p-2 text-start">الفريق</th>
              <th className="p-2 text-start">الرتبة</th>
              <th className="p-2 text-center">تقييم</th>
            </tr>
          </thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id} className="border-t">
                <td className="p-2">{m.full_name}</td>
                <td className="p-2">{m.teams?.name || '—'}</td>
                <td className="p-2">{m.rank?.rank_label || '—'}</td>
                <td className="p-2 text-center">
                  <button className="btn border" onClick={()=>openEditor(m)}>فتح</button>
                </td>
              </tr>
            ))}
            {members.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={4}>لا توجد بيانات</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Editor */}
      {openId && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-[min(900px,95vw)] max-h-[90vh] overflow-auto p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">نموذج التقييم</h2>
              <button className="btn" onClick={()=>setOpenId(null)}>إغلاق</button>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm">ملاحظات إيجابية</label>
                <textarea className="border rounded-xl p-2 w-full" rows={3} value={positive} onChange={e=>setPositive(e.target.value)} />
              </div>
              <div>
                <label className="text-sm">ملاحظات سلبية</label>
                <textarea className="border rounded-xl p-2 w-full" rows={3} value={negative} onChange={e=>setNegative(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm">خطة التطوير</label>
                <textarea className="border rounded-xl p-2 w-full" rows={3} value={plan} onChange={e=>setPlan(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold">الأسئلة</div>
              <div className="border rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-2 text-start">السؤال</th>
                      <th className="p-2 text-center">نعم</th>
                      <th className="p-2 text-center">لا</th>
                    </tr>
                  </thead>
                  <tbody>
                    {questions.map(q => (
                      <tr key={q.id} className="border-t">
                        <td className="p-2">{q.question_text}</td>
                        <td className="p-2 text-center">
                          <input type="radio" name={`q${q.id}`} checked={answers[q.id] === true} onChange={()=>setAnswers(prev => ({...prev, [q.id]: true}))} />
                        </td>
                        <td className="p-2 text-center">
                          <input type="radio" name={`q${q.id}`} checked={answers[q.id] === false} onChange={()=>setAnswers(prev => ({...prev, [q.id]: false}))} />
                        </td>
                      </tr>
                    ))}
                    {questions.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={3}>لا توجد أسئلة</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">الحضور: {present} — الغياب: {absent}</div>
              <LoadingButton loading={saving} onClick={()=>save(members.find(m=>m.id===openId)!)}>حفظ</LoadingButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
