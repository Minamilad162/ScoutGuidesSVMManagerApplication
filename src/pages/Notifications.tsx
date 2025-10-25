import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageLoader } from '../components/ui/PageLoader'
import { useToast } from '../components/ui/Toaster'
import { useAuth } from '../components/AuthProvider'

type Notif = {
  id: string
  ntype: string
  payload: any
  is_read: boolean
  created_at: string
}

/** -------- Helpers -------- */
const pickAny = (obj: any, ...keys: string[]) => {
  if (!obj) return undefined
  for (const k of keys) {
    const v = obj[k]
    if (v !== undefined && v !== null && v !== '') return v
  }
  return undefined
}
const toNumber = (x: any): number | null => {
  if (x === null || x === undefined || x === '') return null
  const n = Number(x)
  return Number.isFinite(n) ? n : null
}
const fmtMoney = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  try { return `${Math.round(n).toLocaleString()} EGP` } catch { return `${n} EGP` }
}

function fmtDate(d?: string) {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(+dt)) return d
  return dt.toLocaleDateString()
}
function fmtTime(d?: string) {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(+dt)) return d
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtDateTime(d?: string) {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(+dt)) return d
  return dt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime()
  const m = Math.round(diff/60000); if (m < 1) return 'الآن'
  if (m < 60) return `${m} د`
  const h = Math.round(m/60); if (h < 24) return `${h} س`
  const days = Math.round(h/24); return `${days} يوم`
}

/** نطبّع الـpayload لمفاتيح موحّدة */
function normalizePayload(p: any) {
  return {
    // فرق
    teamId:         pickAny(p, 'team_id', 'teamId', 'team_id_top'),
    teamName:       pickAny(p, 'team_name', 'teamName', 'team', 'team_name_top'),

    // أفراد/أدوار
    memberId:       pickAny(p, 'member_id', 'memberId', 'user_id'),
    memberName:     pickAny(p, 'member_name', 'memberName', 'user_name', 'name'),
    guardianName:   pickAny(p, 'guardian_name', 'guardianName'),
    guardianPhone:  pickAny(p, 'guardian_phone', 'guardianPhone'),
    role:           pickAny(p, 'role', 'role_name'),

    // أرض/أدوات
    zoneId:         pickAny(p, 'zone_id', 'field_zone_id'),
    zoneName:       pickAny(p, 'zone_name', 'field_zone_name'),
    materialId:     pickAny(p, 'material_id'),
    materialName:   pickAny(p, 'material_name', 'item_name'),
    qty:            pickAny(p, 'qty', 'quantity'),

    // أوقات
    from:           pickAny(p, 'from', 'starts_at', 'start'),
    to:             pickAny(p, 'to', 'ends_at', 'end'),
    meetingDate:    pickAny(p, 'meeting_date', 'last_meeting_date'),
    mtype:          pickAny(p, 'mtype', 'meeting_type'),

    // ترم
    termLabel:      pickAny(p, 'term_label', 'term_name'),
    termYear:       pickAny(p, 'term_year', 'year'),

    // ميزانية (أكثر من مفتاح علشان نغطي كل السيناريوهات)
    amount:         pickAny(p, 'amount', 'amount_total', 'budget_amount', 'budget_total', 'amount_budget_nested', 'amount_total_top'),
    remaining:      pickAny(p, 'remaining', 'remaining_amount', 'remaining_total', 'remaining_budget_nested', 'remaining_top', 'remaining_amount_top'),
    spent:          pickAny(p, 'spent', 'spent_total', 'expenses_sum'),

    // متفرقات
    missing:        Array.isArray(p?.missing) ? p.missing : undefined,
    dates: (
      Array.isArray(p?.dates) ? p.dates
      : Array.isArray(p?.absence_dates) ? p.absence_dates
      : Array.isArray(p?.last_three_dates) ? p.last_three_dates
      : undefined
    ),
    note:           pickAny(p, 'note', 'message'),

    extra:          p
  }
}

/** -------- Visual meta per notification type -------- */
const typeMeta: Record<string, {
  title: string
  tone: 'info'|'warn'|'danger'
  icon: string
  makeText: (n: Notif, np: ReturnType<typeof normalizePayload>) => string
}> = {
  budget_low: {
    title: 'تنبيه الميزانية',
    tone: 'warn',
    icon: '💸',
    makeText: (_, np) => {
      // حاول تحسب المتبقّي حتى لو الـpayload فيه budget/spent فقط
      let rem = toNumber(np.remaining)
      if (rem === null) {
        const total = toNumber(np.amount)
        const spent = toNumber(np.spent)
        if (total !== null && spent !== null) rem = total - spent
      }
      const team = np.teamName ?? '—'
      const term = np.termLabel ? ` (ترم ${np.termLabel})` : ''
      return `ميزانية فريق ${team}${term} أقل من 25%. المتبقي: ${fmtMoney(rem)}.`
    }
  },
  budget_depleted: {
    title: 'نفاد الميزانية',
    tone: 'danger',
    icon: '⛔',
    makeText: (_, np) =>
      `ميزانية فريق ${np.teamName ?? '—'}${np.termLabel ? ` (ترم ${np.termLabel})` : ''} نفدت.`,
  },
  eval_due: {
    title: 'تقييمات مطلوبة',
    tone: 'warn',
    icon: '📝',
    makeText: (_, np) =>
      `باقي أسبوعين لانتهاء الترم${np.termLabel ? ` (${np.termLabel})` : ''}. ${np.missing?.length ? `لم تُقيَّم: ${np.missing.join('، ')}` : ''}`,
  },
  materials_conflict: {
    title: 'تعارض حجز أدوات',
    tone: 'danger',
    icon: '🧰',
    makeText: (_, np) =>
      `الأداة ${np.materialName ?? '—'} محجوزة لفريق ${np.teamName ?? '—'} من ${fmtTime(np.from)} إلى ${fmtTime(np.to)}.`,
  },
  field_conflict: {
    title: 'تعارض حجز أرض',
    tone: 'danger',
    icon: '🏕️',
    makeText: (_, np) =>
      `قطاع الأرض ${np.zoneName ?? '—'} محجوز لفريق ${np.teamName ?? '—'} من ${fmtTime(np.from)} إلى ${fmtTime(np.to)}.`,
  },
  event: {
    title: 'إشعار فعالية',
    tone: 'info',
    icon: '📅',
    makeText: (_, np) => {
      const t = np.extra?.title || 'فعالية'
      const when = np.from || np.extra?.starts_at
      const loc = np.extra?.location
      const body = np.extra?.content
      return `${t}${when ? ` — الموعد: ${fmtDateTime(when)}` : ''}${loc ? ` — المكان: ${loc}` : ''}${body ? ` — ${body}` : ''}`
    }
  },
  equipier_3_absences: {
    title: 'تحذير غياب متتالٍ (3 مرات)',
    tone: 'warn',
    icon: '🚸',
    makeText: (n, np) => {
      const name = np.memberName || '—'
      const team = np.teamName || '—'
      const dates: string[] = Array.isArray(n.payload?.dates) ? n.payload.dates : []
      const datesTxt = dates.length ? dates.map(fmtDate).join('، ') : '—'
      return `العضو ${name} (فريق ${team}) تغيّب 3 اجتماعات متتالية في التواريخ: ${datesTxt}`
    }
  },
  materials_return_all_ok: {
    title: 'تم تسليم العهدة كاملة',
    tone: 'info',
    icon: '✅',
    makeText: (_, np) => {
      const team = np.teamName || '—'
      const date = np.extra?.date || np.from || ''
      const total = np.extra?.total ?? np.amount ?? ''
      return `الفريق ${team} سلّم العهدة كاملة${date ? ` بتاريخ ${date}` : ''}${total ? ` (عدد البنود: ${total})` : ''}.`
    }
  },
  materials_return_not_all: {
    title: 'لم يتم تسليم العهدة كاملة',
    tone: 'warn',
    icon: '⚠️',
    makeText: (n, np) => {
      const team = np.teamName || '—'
      const date = n.payload?.date || ''
      const approved = n.payload?.approved ?? '0'
      const total = n.payload?.total ?? '0'
      const items = Array.isArray(n.payload?.pending_items)
        ? n.payload.pending_items.map((i:any)=>`${i.material_name} (متبقٍّ: ${i.remaining_qty})`).join('، ')
        : ''
      return `الفريق ${team} لم يسلّم العهدة كاملة${date ? ` بتاريخ ${date}` : ''} — المعتمد ${approved} من إجمالي ${total}${items ? `.\nالبنود الناقصة: ${items}` : ''}`
    }
  },
}

/** مظهر الكارت حسب نوعه */
function clsTone(tone: 'info'|'warn'|'danger') {
  switch (tone) {
    case 'warn': return 'border-amber-300 bg-amber-50'
    case 'danger': return 'border-rose-300 bg-rose-50'
    default: return 'border-sky-300 bg-sky-50'
  }
}

/** --------- Component --------- */
export default function Notifications() {
  const toast = useToast()
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Notif[]>([])
  const [showRead, setShowRead] = useState(false)
  const [search, setSearch] = useState('')
  const [marking, setMarking] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  // جلب البيانات + إرسال عداد غير المقروء للـSideNav
  useEffect(() => { refresh() }, [showRead])
  async function refresh() {
    setLoading(true)
    try {
      let q = supabase.from('v_my_notifications').select('*').order('created_at', { ascending: false }) as any
      if (!showRead) q = q.eq('is_read', false)
      const { data, error } = await q
      if (error) throw error
      const list = (data as any) ?? []

      // ✅ منع التكرارات الشائعة (خصوصًا غياب 3 مرات)
      const seen = new Set<string>()
      const deduped: Notif[] = []
      for (const n of list) {
        const p = normalizePayload(n.payload)
        const key = JSON.stringify({
          t: n.ntype,
          m: p.memberId || null,
          team: p.teamId || null,
          mat: p.materialId || null,
          zone: p.zoneId || null,
          from: p.from || null,
          to: p.to || null,
          dates: Array.isArray(p.dates) ? p.dates.slice().sort() : null
        })
        if (!seen.has(key)) { seen.add(key); deduped.push(n) }
      }

      setRows(deduped)

      // ✅ ابعت عدّاد غير المقروء لسايدنـاف مباشرة
      const unreadCount = deduped.filter((n: Notif) => !n.is_read).length
      window.dispatchEvent(new CustomEvent('app:notif-unread', { detail: unreadCount }))
    } catch (e:any) {
      toast.error(e.message || 'تعذر تحميل الإشعارات')
    } finally {
      setLoading(false)
    }
  }

  // Realtime: أي INSERT/UPDATE على notifications تخص المستخدم → حدّث القائمة
  useEffect(() => {
    if (!user?.id) return
    const ch = supabase
      .channel(`notif_page_${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, () => refresh())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, showRead])

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const s = search.toLowerCase()
    return rows.filter(n => {
      const meta = typeMeta[n.ntype]
      const np = normalizePayload(n.payload)
      const title = meta?.title || n.ntype.replace(/_/g,' ')
      const text = meta?.makeText(n, np) || ''
      return (title.toLowerCase().includes(s) || text.toLowerCase().includes(s) || n.ntype.toLowerCase().includes(s)
        || (np.teamName?.toLowerCase().includes(s))
        || (np.memberName?.toLowerCase().includes(s))
        || (np.zoneName?.toLowerCase().includes(s))
        || (np.materialName?.toLowerCase().includes(s))
        || (np.guardianName?.toLowerCase().includes(s))
        || (np.guardianPhone?.toLowerCase().includes(s))
      )
    })
  }, [rows, search])

  async function markRead(id: string) {
    setMarking(id)
    try {
      const { error } = await supabase.rpc('mark_notifications_read', { _ids: [id] })
      if (error) throw error

      // ✅ حدّث الواجهة فورًا + ابعت العدّاد الجديد
      let newRows: Notif[]
      if (showRead) {
        newRows = rows.map(n => n.id === id ? { ...n, is_read: true } : n)
      } else {
        newRows = rows.filter(n => n.id !== id)
      }
      setRows(newRows)
      const unreadCount = newRows.filter(n => !n.is_read).length
      window.dispatchEvent(new CustomEvent('app:notif-unread', { detail: unreadCount }))
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحديث')
    } finally { setMarking(null) }
  }

  async function markAllRead() {
    setMarkingAll(true)
    try {
      const { error } = await supabase.rpc('mark_all_my_notifications_read')
      if (error) throw error

      // ✅ حدّث الواجهة فورًا + ابعت صفر
      if (showRead) setRows(prev => prev.map(n => ({ ...n, is_read: true })))
      else setRows([])

      window.dispatchEvent(new CustomEvent('app:notif-unread', { detail: 0 }))
    } catch (e:any) {
      toast.error(e.message || 'تعذر التحديث')
    } finally { setMarkingAll(false) }
  }

  return (
    <div className="app-main">
      <PageLoader visible={loading} text="جاري التحميل..." />

      <div className="container space-y-4">
        {/* ===== Toolbar ===== */}
        <div className="card toolbar">
          <h1 className="text-xl font-bold">الإشعارات</h1>

          <div className="toolbar-search">
            <input
              className="input w-full"
              placeholder="ابحث (فريق، شخص، عنوان...)"
              value={search}
              onChange={e=>setSearch(e.target.value)}
            />
          </div>

          <div className="toolbar-actions">
            <label className="inline-flex items-center gap-2 text-sm bg-gray-50 border rounded-xl px-3 py-2 cursor-pointer">
              <input type="checkbox" checked={showRead} onChange={e=>setShowRead(e.target.checked)} />
              عرض المقروء
            </label>
            <button
              className="btn btn-brand"
              onClick={markAllRead}
              disabled={markingAll || rows.length===0}
              title="تحديد الكل كمقروء"
            >
              {markingAll ? '…' : 'تحديد الكل كمقروء'}
            </button>
          </div>
        </div>

        {/* ===== Cards ===== */}
        <div className="space-y-3">
          {filtered.map(n => {
            const meta = typeMeta[n.ntype]
            const np = normalizePayload(n.payload)
            const title = meta?.title || n.ntype.replace(/_/g,' ')
            const text = meta?.makeText(n, np) || (np.note ?? '—')
            const tone = meta?.tone || 'info'
            const icon = meta?.icon || '🔔'
            const datesArr: string[] = Array.isArray(n.payload?.dates) ? n.payload.dates : []

            return (
              <div
                key={n.id}
                className={`notif-card rounded-2xl border p-4 ${clsTone(tone)} ${n.is_read ? 'opacity-60' : ''}`}
              >
                <div className="notif-grid">
                  <div className="min-w-0">
                    <div className="grid items-center gap-2 md:grid-cols-[1fr,auto]">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span className="text-lg">{icon}</span>
                        <div className="notif-title font-semibold break-words">{title}</div>
                        {!n.is_read && (
                          <span className="badge-new">جديد</span>
                        )}
                      </div>
                      <span className="notif-time">{timeAgo(n.created_at)}</span>
                    </div>

                    <div className="mt-2 text-sm leading-6 whitespace-pre-line break-words">
                      {text}
                    </div>

                    <div className="mt-3 chips">
                      {np.teamName && <span className="chip">فريق: <b>{np.teamName}</b></span>}
                      {np.memberName && <span className="chip">الاسم: <b>{np.memberName}</b></span>}
                      {np.guardianName && <span className="chip">ولي الأمر: <b>{np.guardianName}</b></span>}
                      {np.guardianPhone && <span className="chip">هاتف ولي الأمر: <b dir="ltr">{np.guardianPhone}</b></span>}
                      {np.role && <span className="chip">الدور: <b>{np.role}</b></span>}
                      {np.materialName && <span className="chip">أداة: <b>{np.materialName}</b></span>}
                      {np.zoneName && <span className="chip">قطاع: <b>{np.zoneName}</b></span>}
                      {np.qty !== undefined && <span className="chip">العدد: <b>{np.qty}</b></span>}
                      {np.termLabel && <span className="chip">الترم: <b>{np.termLabel}</b></span>}
                    </div>

                    <div className="mt-3 details-grid">
                      {(np.from || np.to) && (
                        <div className="detail">
                          <div className="detail-label">الفترة</div>
                          <div className="break-words">
                            <b>{fmtDateTime(np.from)}</b> — <b>{fmtDateTime(np.to)}</b>
                          </div>
                        </div>
                      )}

                      {np.meetingDate && (
                        <div className="detail">
                          <div className="detail-label">تاريخ الاجتماع</div>
                          <div><b>{fmtDate(np.meetingDate)}</b></div>
                        </div>
                      )}

                      {Array.isArray(datesArr) && datesArr.length === 3 && (
                        <div className="detail">
                          <div className="detail-label">تواريخ الغياب</div>
                          <div className="break-words"><b>{datesArr.map(fmtDate).join('، ')}</b></div>
                        </div>
                      )}

                      {n.ntype === 'budget_low' && (
                        <div className="detail">
                          <div className="detail-label">المتبقي</div>
                          {/* نحاول نعرض المتبقّي حتى لو كان لازم نحسبه */}
                          <div>
                            <b>{
                              (() => {
                                let rem = toNumber(normalizePayload(n.payload).remaining)
                                if (rem === null) {
                                  const np2 = normalizePayload(n.payload)
                                  const total = toNumber(np2.amount)
                                  const spent = toNumber(np2.spent)
                                  if (total !== null && spent !== null) rem = total - spent
                                }
                                return fmtMoney(rem)
                              })()
                            }</b>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="actions-col">
                    {!n.is_read ? (
                      <button
                        className="btn border w-full md:w-auto"
                        disabled={marking===n.id}
                        onClick={()=>markRead(n.id)}
                      >
                        {marking===n.id ? '...' : 'تمّت القراءة'}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-500 block text-center md:text-start">مقروء</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <div className="p-6 text-center text-gray-500 border rounded-2xl bg-white">لا توجد إشعارات للعرض</div>
          )}
        </div>
      </div>
    </div>
  )
}
