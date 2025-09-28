import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'
import { LoadingButton } from '../components/ui/LoadingButton'

type Term = { id: string; name: string; year: number }
type Member = { id: string; full_name: string; rank?: { rank_slug: string; rank_label: string } }
type Question = { id: number; question_text: string; weight: number }

export default function LegionEvaluations() {
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [termId, setTermId] = useState<string>('')
  const [terms, setTerms] = useState<Term[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [questions, setQuestions] = useState<Question[]>([])

  const [openId, setOpenId] = useState<string | null>(null)
  const [evalId, setEvalId] = useState<string | null>(null)
  const [present, setPresent] = useState<number>(0)
  const [absent, setAbsent] = useState<number>(0)
  const [positive, setPositive] = useState<string>('')
  const [negative, setNegative] = useState<string>('')
  const [plan, setPlan] = useState<string>('')
  const [answers, setAnswers] = useState<Record<number, boolean>>({})
  const [weights, setWeights] = useState<Record<number, number>>({}) // NEW

  const [teamId, setTeamId] = useState<string>('')

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const [{ data: t, error: te }, { data: qs, error: qe }] = await Promise.all([
        supabase.from('terms').select('id,name,year').order('year', { ascending: false }),
        supabase.from('evaluation_questions').select('id,question_text,weight').eq('active', true).order('id')
      ])
      if (te) throw te; if (qe) throw qe
      setTerms((t as any) ?? [])
      if (t && t.length) setTermId(t[0].id)
      setQuestions((qs as any) ?? [])
      // default weights = question default
      const def: Record<number, number> = {}
      ;(qs ?? []).forEach(q => { def[q.id] = q.weight ?? 0 })
      setWeights(def)

      // get team for this chef
      let tId: string | null = null
      const { data: me, error: meErr } = await supabase.from('v_me').select('team_id').maybeSingle()
      if (meErr) throw meErr
      if (me?.team_id) tId = me.team_id
      if (!tId) {
        const { data: ct } = await supabase.from('v_my_chef_teams').select('team_id').maybeSingle()
        if (ct?.team_id) tId = ct.team_id
      }
      if (!tId) throw new Error('لا يوجد فريق مرتبط بحسابك كـ Chef de legion')

      setTeamId(tId)
      await loadMembers(tId)
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally {
      setLoading(false)
    }
  }

  async function loadMembers(teamId: string) {
    try {
      const { data, error } = await supabase
        .from('members')
        .select('id, full_name, rank:ranks(id, rank_slug, rank_label)')
        .eq('team_id', teamId)
        .eq('is_equipier', false)
        .order('full_name')
      if (error) throw error
      const filtered = (data as any[] ?? []).filter(m => m.rank?.rank_slug !== 'chef_de_legion')
      setMembers(filtered as any)
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الأعضاء')
    }
  }

  function resetForm() {
    setEvalId(null); setPresent(0); setAbsent(0); setPositive(''); setNegative(''); setPlan('');
    const def: Record<number, number> = {}
    questions.forEach(q => { def[q.id] = q.weight ?? 0 })
    setWeights(def)
    setAnswers({})
  }

  async function openEditor(memberId: string) {
    resetForm()
    setOpenId(memberId)
    try {
      const { data: ev, error: ee } = await supabase
        .from('evaluations')
        .select('id, auto_present_count, auto_absent_count, positive_note, negative_note, development_plan, evaluation_answers(question_id, answer, weight_percent)')
        .eq('evaluatee_member_id', memberId)
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
        const amap: Record<number, boolean> = {}
        const wmap: Record<number, number> = { ...weights }
        ;(ev.evaluation_answers ?? []).forEach((a:any) => {
          amap[a.question_id] = !!a.answer
          if (typeof a.weight_percent === 'number') wmap[a.question_id] = a.weight_percent
        })
        setAnswers(amap)
        setWeights(wmap)
      }
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل التقييم')
    }
  }

  // score using current weights
  const score = (() => {
    const act = questions
    const denom = act.reduce((s,q) => s + (Number(weights[q.id])||0), 0)
    if (!denom) return null
    const num = act.reduce((s,q) => s + ((answers[q.id] ? Number(weights[q.id])||0 : 0)), 0)
    return Math.round((num/denom)*100)
  })()

  async function save(memberId: string) {
    if (!termId) return toast.error('اختر الترم')
    setSaving(true)
    try {
      const up = {
        evaluatee_member_id: memberId,
        evaluator_user_id: (await supabase.auth.getUser()).data.user?.id,
        team_id: teamId,
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

      const rows = questions.map(q => {
        const w = Math.max(0, Math.min(100, Number(weights[q.id]) || 0))
        return {
          evaluation_id: eid,
          question_id: q.id,
          answer: !!answers[q.id],
          weight_percent: w
        }
      })
      const { error: e2 } = await supabase
        .from('evaluation_answers')
        .upsert(rows, { onConflict: 'evaluation_id,question_id' })
      if (e2) throw e2

      try {
        await supabase.rpc('recompute_eval_presence', { p_evaluation_id: eid })
      } catch {}

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

      <h1 className="text-xl font-bold">التقييمات — (Chef de legion)</h1>

      <div className="grid md:grid-cols-3 gap-2 items-end">
        <div>
          <label className="text-sm">الترم</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={termId} onChange={e=>setTermId(e.target.value)}>
            {terms.map(t => <option key={t.id} value={t.id}>{t.year} — {t.name}</option>)}
          </select>
        </div>
      </div>

      <div className="border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-start">الاسم</th>
              <th className="p-2 text-start">الرتبة</th>
              <th className="p-2 text-center">تقييم</th>
            </tr>
          </thead>
          <tbody>
            {members.map(m => (
              <tr key={m.id} className="border-t">
                <td className="p-2">{m.full_name}</td>
                <td className="p-2">{m.rank?.rank_label || '—'}</td>
                <td className="p-2 text-center">
                  <button className="btn border" onClick={()=>openEditor(m.id)}>فتح</button>
                </td>
              </tr>
            ))}
            {members.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={3}>لا توجد بيانات</td></tr>}
          </tbody>
        </table>
      </div>

      {openId && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl w-[min(1000px,95vw)] max-h-[90vh] overflow-auto p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">نموذج التقييم</h2>
              <button className="btn" onClick={()=>setOpenId(null)}>إغلاق</button>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl border">
                <div className="text-xs text-gray-500">حضور</div>
                <div className="text-xl font-bold">{present}</div>
              </div>
              <div className="p-3 rounded-xl border">
                <div className="text-xs text-gray-500">غياب</div>
                <div className="text-xl font-bold">{absent}</div>
              </div>
              <div className="p-3 rounded-xl border">
                <div className="text-xs text-gray-500">Score</div>
                <div className="text-xl font-bold">{score ?? '—'}{score!==null?'%':''}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-semibold">الأسئلة</div>
              <div className="border rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-2 text-start">السؤال</th>
                      <th className="p-2 text-center">نسبة %</th>
                      <th className="p-2 text-center">نعم</th>
                      <th className="p-2 text-center">لا</th>
                    </tr>
                  </thead>
                  <tbody>
                    {questions.map(q => (
                      <tr key={q.id} className="border-t">
                        <td className="p-2">
                          <div className="font-medium">{q.question_text}</div>
                          <div className="text-[11px] text-gray-500">الافتراضي: {q.weight}%</div>
                        </td>
                        <td className="p-2 text-center">
                          <input
                            type="number" min={0} max={100}
                            className="border rounded-lg p-1 w-20 text-center"
                            value={Number(weights[q.id] ?? q.weight)}
                            onChange={e=>{
                              const v = Math.max(0, Math.min(100, Number(e.target.value)||0))
                              setWeights(prev=>({...prev, [q.id]: v}))
                            }}
                          />
                        </td>
                        <td className="p-2 text-center">
                          <input type="radio" name={`q${q.id}`} checked={answers[q.id] === true} onChange={()=>setAnswers(prev => ({...prev, [q.id]: true}))} />
                        </td>
                        <td className="p-2 text-center">
                          <input type="radio" name={`q${q.id}`} checked={answers[q.id] === false} onChange={()=>setAnswers(prev => ({...prev, [q.id]: false}))} />
                        </td>
                      </tr>
                    ))}
                    {questions.length === 0 && <tr><td className="p-3 text-center text-gray-500" colSpan={4}>لا توجد أسئلة</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm">ملاحظات إيجابية</label>
                <textarea className="border rounded-xl p-2 w-full" rows={3} value={positive} onChange={e=>setPositive(e.target.value)} />
              </div>
              <div>
                <label className="text-sm">ملاحظات سلبية</label>
                <textarea className="border rounded-xl p-2 w-full" rows={3} value={negative} onChange={e=>setNegative(e.target.value)} />
              </div>
              <div>
                <label className="text-sm">خطة التطوير</label>
                <textarea className="border rounded-xl p-2 w-full" rows={3} value={plan} onChange={e=>setPlan(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-end">
              <LoadingButton loading={saving} onClick={()=>save(openId!)}>حفظ</LoadingButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
