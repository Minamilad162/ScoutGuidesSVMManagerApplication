import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthProvider'
import { supabase } from '../lib/supabase'

type Item = { to: string; label: string }
type RoleRow = { role_slug: string; team_id?: string | null }

const PROGRAM_URL = 'https://drive.google.com/drive/folders/10Sr1dGAQLXKfz7ZauyPymnxEC_kaN6FO?usp=sharing'
const IMAGES_URL  = 'https://drive.google.com/drive/folders/13wB3GMbm8CTxKLNomKB_Jr38OD1XjeR2?usp=sharing'

type Props = { onNavigate?: () => void }

export default function SideNav({ onNavigate }: Props) {
  const { roles, user } = useAuth()
  const location = useLocation()

  // ===== Avatar =====
  const [avatar, setAvatar] = useState<string | null>(null)
  useEffect(() => {
    (async () => {
      try {
        if (!user?.id) return
        const { data, error } = await supabase
          .from('members')
          .select('avatar_url')
          .eq('auth_user_id', user.id)
          .maybeSingle()
        if (error) throw error

        const raw = data?.avatar_url ?? null
        if (!raw) { setAvatar(null); return }
        if (/^https?:\/\//i.test(raw)) {
          setAvatar(raw)
        } else {
          const { data: pub } = supabase.storage.from('avatars').getPublicUrl(raw)
          setAvatar(pub?.publicUrl ?? null)
        }
      } catch {
        setAvatar(null)
      }
    })()
  }, [user?.id])

  const initials = (() => {
    const base = (user?.name || user?.email || '').trim()
    if (!base) return ''
    const parts = base.split(/\s+/).filter(Boolean)
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || '')
  })().toUpperCase()

  // ===== Unread notifications (Realtime + event bridge + fallback polling) =====
  const [unread, setUnread] = useState(0)

  // استقبل عدّاد غير المقروء القادم من صفحة Notifications
  useEffect(() => {
    const handler = (e: any) => {
      if (typeof e?.detail === 'number') setUnread(e.detail)
    }
    window.addEventListener('app:notif-unread', handler as any)
    return () => window.removeEventListener('app:notif-unread', handler as any)
  }, [])

  useEffect(() => {
    if (!user?.id) return
    let isMounted = true
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const fetchCount = async () => {
      try {
        const { count, error } = await supabase
          .from('v_my_notifications')
          .select('id', { count: 'exact', head: true })
          .eq('is_read', false)
        if (error) throw error
        if (!isMounted) return
        setUnread(count ?? 0)
      } catch {}
    }

    // بدايةً
    fetchCount()

    // ✅ اشترك على تغييرات user_notifications (اللي بيتم تحديثها عند "تمّت القراءة")
    const ch = supabase
      .channel(`notif_count_sidebar_${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_notifications', filter: `user_id=eq.${user.id}` },
        () => { fetchCount() }
      )
      .subscribe()

    // fallback polling
    pollTimer = setInterval(fetchCount, 30000)

    return () => {
      isMounted = false
      if (pollTimer) clearInterval(pollTimer)
      supabase.removeChannel(ch)
    }
  }, [user?.id])

  // ✅ صفّر الشارة فورًا عند دخول صفحة الإشعارات (optimistic clear)
  useEffect(() => {
    if (location.pathname === '/app/notifications') {
      setUnread(0)
    }
  }, [location.pathname])

  // ===== Roles / Nav items =====
  const isAdmin = roles.some((r: RoleRow) => r.role_slug === 'admin')
  const has = (slug: string) => roles.some((r: RoleRow) => r.role_slug === slug)

  const isGlobalSecretary = roles.some(
    (r: RoleRow) => r.role_slug === 'responsable_secretary' && (r.team_id === null || r.team_id === undefined)
  )
  const hasTeamSecretary = roles.some(
    (r: RoleRow) => r.role_slug === 'responsable_secretary' && (r.team_id !== null && r.team_id !== undefined)
  )

  const pushUnique = (arr: Item[], to: string, label: string) => {
    if (!arr.some(i => i.to === to)) arr.push({ to, label })
  }

  const items = useMemo<Item[]>(() => {
    if (!user) return []

    const res: Item[] = [{ to: '/app', label: 'الرئيسية' }]

    if (isAdmin) {
      pushUnique(res, '/app/AdminDashboard', 'لوحة التحكم')

      pushUnique(res, '/app/AdminReservationsAll', 'الحجوزات')
      pushUnique(res, '/app/AdminFieldReservations', 'ادارة الارض')
      pushUnique(res, '/app/AdminAttendance', 'إدارة الحضور')
      pushUnique(res, '/app/AdminFinance', 'ادارة الميزانية')
      pushUnique(res, '/app/MaterialAdmin', 'ادارة الأدوات ')
      pushUnique(res, '/app/AdminEvaluation', 'التقييم (أدمن)')
      pushUnique(res, '/app/admin', 'لوحة الإدارة')
      pushUnique(res, '/app/admin-members', 'إدارة الأعضاء')
      pushUnique(res, '/app/AdminSecretary', 'إدارة السكرتارية')
      pushUnique(res, '/app/AdminEvents', 'فعاليات')
      pushUnique(res, '/app/AdminEvalQuestions', 'أسئلة التقييم')
      pushUnique(res, '/app/financeEvent', 'ميزانية المجموعة')
      pushUnique(res, '/app/MaterialsReturnApprove', 'تسليم العهده')

      pushUnique(res, '/app/ChefsEvaluationOverview', 'التقييم النهائى ')
    } else {
      if (has('chef_de_legion')) {
        pushUnique(res, '/app/LegionEvaluations', 'تقييم فريقي')
        pushUnique(res, '/app/LegionAttendance', 'غياب فريقي')
        pushUnique(res, '/app/FieldReservationsTeam', 'حجز الارض')
        pushUnique(res, '/app/TeamFinance', 'ميزانية الفريق')
        pushUnique(res, '/app/MaterialTeamReservation', 'الأدوات')
        pushUnique(res, '/app/TeamSecretary', 'سكرتارية فريقي')
        pushUnique(res, '/app/ChefsEvaluationOverview', 'التقييم النهائى ')
      }
      if (has('responsable_finance') && has('chef_de_legion')) {
        pushUnique(res, '/app/AdminFinance', 'ادارة الميزانية')
        pushUnique(res, '/app/financeEvent', 'ميزانية المجموعة')

      }
      if (has('responsable_finance') && !has('chef_de_legion')) {
        pushUnique(res, '/app/TeamFinance', 'ميزانية فريقى')
      }
      // if (isAdmin || has('responsable_finance')) {
      //   pushUnique(res, '/app/financeEvent', 'ميزانية المجموعة')
      // }
      const showMaterialsApprove =
        roles.some((r: RoleRow) => r.role_slug === 'admin') ||
        roles.some((r: RoleRow) => r.role_slug === 'responsable_materials')
      if (showMaterialsApprove) {
        pushUnique(res, '/app/MaterialsReturnApprove', 'تسليم العهده'),
        pushUnique(res, '/app/MaterialAdmin', 'ادارة الأدوات ')
        pushUnique(res, '/app/AdminFieldReservations', 'ادارة الارض')
      }
      if (isGlobalSecretary) {
        pushUnique(res, '/app/AdminSecretary', 'إدارة السكرتارية')
        pushUnique(res, '/app/TeamSecretary', 'سكرتارية فريقي')
      } else if (hasTeamSecretary) {
        pushUnique(res, '/app/TeamSecretary', 'سكرتارية فريقي')
        pushUnique(res, '/app/TeamSecretaryAttendance', 'غياب فريقي')        
      }
    }

    pushUnique(res, '/app/evaluation', 'تقييمي')
        pushUnique(res, 'storage', 'اماكن العهدة')

    pushUnique(res, '/app/notifications', 'الإشعارات')

    return res
  }, [roles, isAdmin, user, isGlobalSecretary, hasTeamSecretary])

  const handleNavigate = () => { onNavigate?.() }

  // ===== Local sign out to avoid 403 =====
  const [signingOut, setSigningOut] = useState(false)
  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await supabase.auth.signOut({ scope: 'local' })
      handleNavigate()
      window.location.replace('/')
    } catch {
      handleNavigate()
      window.location.replace('/')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <aside className="sidenav">
      <div className="sidenav-header">
        <div className="brand">Scout Manager</div>

        <div className="mt-3 flex items-center gap-3">
          {avatar ? (
            <img
              src={avatar}
              alt="صورة الحساب"
              className="w-12 h-12 rounded-full object-cover border"
              onError={() => setAvatar(null)}
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 text-white flex items-center justify-center font-semibold select-none">
              {initials || '👤'}
            </div>
          )}

          <div>
            <div className="user-name">{user?.name}</div>
            <div className="user-email">{user?.email}</div>
            <div className="user-teamname">{user?.teamName}</div>
          </div>
        </div>
      </div>

      <nav className="sidenav-nav">
        {items.map(i => {
          const isNotif = i.to === '/app/notifications'
          return (
            <NavLink
              key={i.to}
              to={i.to}
              end
              className={({isActive})=>`snav ${isActive?'snav-active':''}`}
              onClick={handleNavigate}
            >
              <span className="inline-flex items-center gap-2">
                {i.label}
                {isNotif && unread > 0 && (
                  <span
                    className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-full text-[11px] font-bold text-white"
                    style={{ backgroundColor: '#ef4444' }}
                    aria-label={`لديك ${unread} إشعار غير مقروء`}
                  >
                    {unread}
                  </span>
                )}
              </span>
            </NavLink>
          )
        })}

        {/* روابط Drive الثابتة */}
        <a className="snav" href={PROGRAM_URL} target="_blank" rel="noreferrer" onClick={handleNavigate}>المنهج</a>
        <a className="snav" href={IMAGES_URL}  target="_blank" rel="noreferrer" onClick={handleNavigate}>الصور</a>
      </nav>

      <div className="sidenav-footer">
        <button
          type="button"
          className="btn border w-full"
          onClick={handleSignOut}
          disabled={signingOut}
        >
          {signingOut ? 'جارٍ تسجيل الخروج...' : 'تسجيل الخروج'}
        </button>
      </div>
    </aside>
  )
}
