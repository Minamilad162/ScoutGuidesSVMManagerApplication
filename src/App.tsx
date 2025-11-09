import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { AuthProvider, useAuth } from './components/AuthProvider'
import SideNav from './components/SideNav'
import { supabase } from './lib/supabase' // ⬅️ NEW: علشان نخزن الاشتراك

import Attendance from './pages/Attendance'
import Finance from './pages/Finance'
import Materials from './pages/Materials'
import Evaluation from './pages/Evaluation'
import Notifications from './pages/Notifications'
import Admin from './pages/Admin'

import Login from './pages/Login'
import Home from './pages/Home'
import ReservationsAdmin from './pages/ReservationsAdmin'
import AdminMembers from './pages/AdminMembers'
import MaterialsTeamReservations from './pages/MaterialsTeamReservations'
import MaterialsAdmin from './pages/MaterialsAdmin'
import AdminAttendance from './pages/AdminAttendance'
import AdminReservationsAll from './pages/AdminReservationsAll'
import AdminFieldReservations from './pages/AdminFieldReservations'
import FieldReservationsTeam from './pages/FieldReservationsTeam'
import AdminEvaluations from './pages/AdminEvaluations'
import LegionEvaluations from './pages/LegionEvaluations'
import MyEvaluation from './pages/MyEvaluation'
import LegionAttendance from './pages/LegionAttendance'
import AdminFinance from './pages/AdminFinance'
import TeamFinance from './pages/TeamFinance'
import AdminSecretary from './pages/AdminSecretary'
import TeamSecretary from './pages/TeamSecretary'
import TeamSecretaryAttendance from './pages/TeamSecretaryAttendance'
import AdminEvents from './pages/AdminEvents'
import AdminEvalQuestions from './pages/AdminEvalQuestions'
import FinanceEvent from './pages/financeEvent'
import MaterialsReturnApprove from './pages/MaterialsReturnApprove'
import ChefsEvaluationOverview from './pages/ChefsEvaluationOverview'
import AdminDashboard from './pages/AdminDashboard'
import StorageInventory from './pages/StorageInventory'
import TeamCases from './pages/TeamCases'







// ======= Helpers for Push =======
function urlBase64ToUint8Array(base64String: string) {
  // يحوّل VAPID public key (base64url) لـUint8Array
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}
function bufToBase64(buf: ArrayBuffer | null) {
  if (!buf) return ''
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

async function ensurePushSubscription(userId?: string | null) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    if (!userId) return

    // لازم المفتاح العام من .env (Vite)
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
    if (!vapidPublicKey) {
      console.warn('VITE_VAPID_PUBLIC_KEY is missing')
      return
    }

    // لو الإذن “denied” خلاص ما نحاولش
    if (Notification.permission === 'denied') return

    // لو لسه “default” جرّب نطلب الإذن
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') return
    }

    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      })
    }

    // خزّن الاشتراك في Supabase
    const endpoint = sub.endpoint
    const p256dh = bufToBase64(sub.getKey('p256dh'))
    const auth = bufToBase64(sub.getKey('auth'))

    // غيّر اسم الجدول/الأعمدة حسب سكيمتك — مثال شائع:
    // webpush_subscriptions(id, user_id, endpoint, p256dh, auth, created_at)
    await supabase
      .from('webpush_subscriptions')
      .upsert(
        { user_id: userId, endpoint, p256dh, auth },
        { onConflict: 'user_id,endpoint' } as any
      )
  } catch (e) {
    console.warn('push subscription failed', e)
  }
}

function ProtectedLayout() {
  const { user, loading } = useAuth()
  const loc = useLocation()
  const [navOpen, setNavOpen] = useState(false) // مقفول افتراضيًا

  // ⬇️ NEW: جرّب الاشتراك في الإشعارات بعد تسجيل الدخول
  useEffect(() => {
    if (user?.id) {
      ensurePushSubscription(user.id)
    }
  }, [user?.id])

  if (loading) return <div className="center">...loading</div>
  if (!user) return <Navigate to="/" state={{ from: loc }} replace />

  return (
    <div className="app-grid">
      {/* Topbar */}
      <header className="app-topbar">
        <button
          type="button"
          className="burger"
          aria-label="فتح القائمة"
          onClick={() => setNavOpen(true)}
        >
          ☰
        </button>
        <div className="topbar-title">Scout Manager</div>
      </header>

      {/* Drawer: نتحكم في التحويل بالـinline style لضمان الإخفاء الافتراضي */}
      <div
        className="drawer-panel"
        style={{ transform: navOpen ? 'translateX(0)' : 'translateX(110%)' }}
        aria-hidden={!navOpen}
      >
        <SideNav onNavigate={() => setNavOpen(false)} />
      </div>
      {navOpen && (
        <button
          className="drawer-backdrop"
          aria-label="إغلاق القائمة"
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* Main */}
      <main className="app-main" onClick={() => { if (navOpen) setNavOpen(false) }}>
        <Outlet />
      </main>
    </div>
  )
}

function PublicOnly({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="center">...loading</div>
  if (user) return <Navigate to="/app" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PublicOnly><Login /></PublicOnly>} />
          <Route path="/app" element={<ProtectedLayout />}>
            <Route index element={<Home />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="finance" element={<Finance />} />
            <Route path="MaterialTeamReservation" element={<MaterialsTeamReservations />} />
            <Route path="MaterialAdmin" element={<MaterialsAdmin />} />
            <Route path="AdminAttendance" element={<AdminAttendance />} />
            <Route path="AdminReservationsAll" element={<AdminReservationsAll />} />
            <Route path="AdminFieldReservations" element={<AdminFieldReservations />} />
            <Route path="AdminEvaluations" element={<AdminEvaluations />} />
            <Route path="LegionEvaluations" element={<LegionEvaluations />} />
            <Route path="LegionAttendance" element={<LegionAttendance />} />
            <Route path="LegionAttendance" element={<LegionAttendance />} />
            <Route path="financeEvent" element={<FinanceEvent />} />
            <Route path="MaterialsReturnApprove" element={<MaterialsReturnApprove />} />
            <Route path="AdminDashboard" element={<AdminDashboard />} />
            <Route path="storage" element={<StorageInventory />} />
            <Route path="TeamCases" element={<TeamCases/>} />
            <Route path="TeamStatistics" element={<TeamStatistics/>} />


            <Route path="/app/AdminEvalQuestions" element={<AdminEvalQuestions />} />
            <Route path="/app/AdminFinance" element={<AdminFinance />} />
            <Route path="/app/AdminSecretary" element={<AdminSecretary />} />
            <Route path="/app/TeamSecretaryAttendance" element={<TeamSecretaryAttendance />} />
            <Route path="/app/AdminEvents" element={<AdminEvents />} />
            <Route path="/app/ChefsEvaluationOverview" element={<ChefsEvaluationOverview />} />

            <Route path="TeamSecretary" element={<TeamSecretary />} />
            <Route path="/app/TeamFinance" element={<TeamFinance />} />
            <Route path="/app/evaluation" element={<MyEvaluation />} />
            <Route path="FieldReservationsTeam" element={<FieldReservationsTeam />} />
            <Route path="materials" element={<Materials />} />
            <Route path="evaluation" element={<Evaluation />} />
            <Route path="reservation" element={<ReservationsAdmin />} />
            <Route path="/app/admin-members" element={<AdminMembers />} />

            <Route path="notifications" element={<Notifications />} />
            <Route path="admin" element={<Admin />} />
          </Route>
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
