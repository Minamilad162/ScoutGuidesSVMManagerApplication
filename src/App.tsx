import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './components/AuthProvider'
import SideNav from './components/SideNav'

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
import FinanceEvent from './pages/FinanceEvent'
import MaterialsReturnApprove from './pages/MaterialsReturnApprove'

function ProtectedLayout() {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="center">...loading</div>
  if (!user) return <Navigate to="/" state={{ from: loc }} replace />
  return (
    <div className="app-grid">
      <SideNav />
      <main className="app-main">
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

            <Route path="/app/AdminEvalQuestions" element={<AdminEvalQuestions />} />

            <Route path="/app/AdminFinance" element={<AdminFinance />} />
            <Route path="/app/AdminSecretary" element={<AdminSecretary />} />
            <Route path="/app/TeamSecretaryAttendance" element={<TeamSecretaryAttendance />} />
            <Route path="/app/AdminEvents" element={<AdminEvents />} />

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
