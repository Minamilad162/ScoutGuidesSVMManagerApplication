import { useEffect, useState } from 'react'
import { useAuth } from '../components/AuthProvider'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

export default function Home() {
  const { user, myTeamId } = useAuth()
  const nav = useNavigate()

  const [unread, setUnread] = useState(0)
  const [teamName, setTeamName] = useState<string>('')
  const [fullName, setFullName] = useState<string>('')

  useEffect(() => { load() }, [myTeamId, user?.id])

  // تحديث لحظي لعدد الإشعارات
  useEffect(() => {
    if (!user?.id) return
    const channel = supabase
      .channel('notif_count_home')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => loadCount()
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  async function load() {
    try {
      await Promise.all([loadCount(), loadName(), loadTeam()])
    } catch {
      // نكمل عادي لو حصلت مشكلة بسيطة
    }
  }

  async function loadCount() {
    const { data: ns } = await supabase
      .from('v_my_notifications')
      .select('id')
      .eq('is_read', false)
    setUnread((ns ?? []).length)
  }

  async function loadName() {
    let name = ''
    if (user?.id) {
      const { data: m } = await supabase
        .from('members')
        .select('full_name')
        .eq('auth_user_id', user.id)
        .maybeSingle()
      name = m?.full_name || ''
    }
    if (!name) {
      const meta: any = (user as any)?.user_metadata || {}
      name = meta.full_name || meta.name || (user?.email ?? '')
    }
    setFullName(name)
  }

  async function loadTeam() {
    if (myTeamId) {
      const { data: t } = await supabase
        .from('teams')
        .select('name')
        .eq('id', myTeamId)
        .maybeSingle()
      setTeamName(t?.name ?? '')
    } else {
      setTeamName('')
    }
  }

  return (
    <div className="space-y-6">
      {/* بانر إشعارات واضح */}
      <div className={`rounded-2xl border p-4 ${unread > 0 ? 'bg-amber-50 border-amber-300' : 'bg-gray-50'}`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold">أهلًا {fullName || '—'}</h1>
            <div className="text-sm text-gray-600 mt-1">فريقك: <b>{teamName || '—'}</b></div>
          </div>
          <button
            className="btn border"
            onClick={() => nav('/app/notifications')}
            title="اذهب للإشعارات"
          >
            فتح الإشعارات
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span className="inline-flex items-center justify-center min-w-9 h-9 px-3 rounded-full text-white text-sm font-bold"
                style={{ backgroundColor: unread > 0 ? '#f59e0b' : '#9ca3af' }}>
            {unread}
          </span>
          <span className="text-sm text-gray-700">
            {unread > 0 ? 'إشعارات غير مقروءة بانتظارك' : 'لا توجد إشعارات جديدة'}
          </span>
        </div>
      </div>

      <div className="text-sm text-gray-500">استخدم القائمة الجانبية للتنقل بين الصفحات المسموح بها.</div>
    </div>
  )
}
