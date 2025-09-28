import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'

type Term = { id: string; name: string; year: number }

// أضفنا weight_percent و weight الافتراضي للسؤال
type Answer = {
  question_id: number
  answer: boolean
  weight_percent: number | null
  question?: { id: number; question_text: string; weight: number | null }
}

type StatRow = {
  member_id: string
  member_name: string
  is_equipier: boolean
  present_meetings: number
  total_meetings: number
  present_preps: number
  total_preps: number
  present_total: number
  total_total: number
  pct: number
} | null

export default function MyEvaluation() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)

  const [terms, setTerms] = useState<Term[]>([])
  const [termId, setTermId] = useState<string>('')
  const [allTerms, setAllTerms] = useState(false)

  const [meInfo, setMeInfo] = useState<{ member_id: string; team_id: string } | null>(null)

  const [evalData, setEvalData] = useState<any | null>(null)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [hint, setHint] = useState<string>('')

  const [stats, setStats] = useState<StatRow>(null)

  useEffect(() => { init() }, [])
  async function init() {
    setLoading(true)
    try {
      const [{ data: ts, error: te }, { data: me, error: meErr }] = await Promise.all([
        supabase.from('terms').select('id,name,year').order('year', { ascending: false }),
        supabase.from('v_me').select('member_id, team_id').maybeSingle()
      ])
      if (te) throw te
      if (meErr) throw meErr
      if (!me?.member_id) throw new Error('لا يوجد حساب عضو مرتبط')
      setMeInfo(me as any)
      setTerms((ts as any) ?? [])
      if (ts && ts.length) setTermId(ts[0].id)
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحميل')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (termId && meInfo) refresh() }, [termId, allTerms, meInfo])
  async function refresh() {
    setLoading(true)
    setHint('')
    try {
      const member_id = meInfo!.member_id
      const team_id = meInfo!.team_id

      const [evRes, stRes] = await Promise.all([
        supabase
          .from('evaluations')
          .select('id, auto_present_count, auto_absent_count, positive_note, negative_note, development_plan')
          .eq('evaluatee_member_id', member_id)
          .eq('term_id', termId)
          .maybeSingle(),
        supabase
          .rpc('attendance_stats', { p_team_id: team_id, p_term_id: allTerms ? null : termId, p_all_terms: allTerms })
      ])

      const { data: ev, error: ee } = evRes as any
      if (ee) throw ee
      setEvalData(ev || null)

      const { data: statsData, error: se } = stRes as any
      if (se) throw se
      const myRow = (statsData as any[])?.find?.(r => r.member_id === member_id) || null
      setStats(myRow)

      if (ev) {
        // هنا بنسحب weight_percent + وزن السؤال الافتراضي
        const { data: ans, error: ae } = await supabase
          .from('evaluation_answers')
          .select('question_id, answer, weight_percent, question:evaluation_questions!inner(id,question_text,weight)')
          .eq('evaluation_id', ev.id)
          .order('question_id')
        if (ae) throw ae
        setAnswers((ans as any) ?? [])
      } else {
        setAnswers([])
        const { data: anyEv, error: anyErr } = await supabase
          .from('v_evaluations_full')
          .select('term_name, term_year')
          .eq('evaluatee_member_id', member_id)
          .order('term_year', { ascending: false })
          .limit(1)
        if (!anyErr && anyEv && anyEv.length) {
          setHint(`يوجد تقييم مُسجل في ترم ${anyEv[0].term_year} — ${anyEv[0].term_name}. اختر الترم المناسب من القائمة.`)
        }
      }
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل البيانات')
    } finally {
      setLoading(false)
    }
  }

  const presence = useMemo(() => {
    if (!stats) return { presencePct: 0 }
    const totalTotal = stats.total_total ?? 0
    const presentTotal = stats.present_total ?? 0
    const presencePct = totalTotal > 0 ? Math.round((presentTotal * 10000) / totalTotal) / 100 : 0
    return { presencePct }
  }, [stats])

  return (
    <div className="p-6 space-y-6">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <h1 className="text-xl font-bold">تقييمي</h1>

      <div className="grid md:grid-cols-4 gap-2 items-end">
        <div>
          <label className="text-sm">الترم</label>
          <select className="border rounded-xl p-2 w-full cursor-pointer" value={termId} onChange={e=>setTermId(e.target.value)} disabled={allTerms}>
            {terms.map(t => <option key={t.id} value={t.id}>{t.year} — {t.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 mt-6">
          <input id="allTerms" type="checkbox" checked={allTerms} onChange={e=>setAllTerms(e.target.checked)} />
          <label htmlFor="allTerms" className="text-sm">عرض السنة كلها (كل الترمات)</label>
        </div>
      </div>

      {/* Attendance stats cards */}
      <section className="grid md:grid-cols-4 gap-3">
        <div className="p-3 bg-gray-50 rounded-xl">
          <div className="text-sm text-gray-600">الاجتماعات — حضور / إجمالي</div>
          <div className="text-lg font-semibold">{stats?.present_meetings ?? 0} / {stats?.total_meetings ?? 0}</div>
        </div>
        <div className="p-3 bg-gray-50 rounded-xl">
          <div className="text-sm text-gray-600">التحضيرات — حضور / إجمالي</div>
          <div className="text-lg font-semibold">{stats?.present_preps ?? 0} / {stats?.total_preps ?? 0}</div>
        </div>
        <div className="p-3 bg-gray-50 rounded-xl">
          <div className="text-sm text-gray-600">الإجمالي — حضور / إجمالي</div>
          <div className="text-lg font-semibold">{stats?.present_total ?? 0} / {stats?.total_total ?? 0}</div>
        </div>
        <div className="p-3 bg-gray-50 rounded-xl">
          <div className="text-sm text-gray-600">نسبة الحضور الكلية</div>
          <div className="text-lg font-semibold">{presence.presencePct.toFixed(2)}%</div>
        </div>
      </section>

      {/* Evaluation details */}
      {!evalData ? (
        <div className="p-4 border rounded-2xl text-gray-600 space-y-2">
          <div>لا يوجد تقييم مُسجّل لهذا الترم حتى الآن.</div>
          {hint && <div className="text-xs text-gray-500">{hint}</div>}
        </div>
      ) : (
        <div className="space-y-4">
          <section className="card space-y-2">
            <h2 className="text-lg font-semibold">الإجابات</h2>
            <div className="border rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="p-2 text-start">السؤال</th>
                    <th className="p-2 text-center">النسبة %</th>
                    <th className="p-2 text-center">الإجابة</th>
                  </tr>
                </thead>
                <tbody>
                  {answers.map(a => {
                    const w = (a.weight_percent ?? a.question?.weight ?? 0) as number
                    return (
                      <tr key={a.question_id} className="border-t">
                        <td className="p-2">{a.question?.question_text}</td>
                        <td className="p-2 text-center">{w}%</td>
                        <td className="p-2 text-center">{a.answer ? 'نعم' : 'لا'}</td>
                      </tr>
                    )
                  })}
                  {answers.length === 0 && (
                    <tr>
                      <td className="p-3 text-center text-gray-500" colSpan={3}>لا توجد إجابات</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card space-y-2">
            <h2 className="text-lg font-semibold">ملاحظات</h2>
            <div className="grid md:grid-cols-3 gap-3">
              <div className="md:col-span-1">
                <div className="text-sm text-gray-600">إيجابي</div>
                <div className="p-3 border rounded-xl min-h-[80px] bg-white whitespace-pre-wrap">{evalData.positive_note || '—'}</div>
              </div>
              <div className="md:col-span-1">
                <div className="text-sm text-gray-600">سلبي</div>
                <div className="p-3 border rounded-xl min-h-[80px] bg-white whitespace-pre-wrap">{evalData.negative_note || '—'}</div>
              </div>
              <div className="md:col-span-1">
                <div className="text-sm text-gray-600">خطة التطوير</div>
                <div className="p-3 border rounded-xl min-h-[80px] bg-white whitespace-pre-wrap">{evalData.development_plan || '—'}</div>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
