import { useAuth } from '../components/AuthProvider'

export default function TeamDashboard() {
  const { roles, myTeamId, user } = useAuth()
  return (
    <div className="p-6">
      <div className="card space-y-2">
        <h1 className="text-xl font-bold">لوحة الفريق</h1>
        <div className="text-sm">المستخدم: {user?.email}</div>
        <div className="text-sm">فريقك: {myTeamId ?? '—'}</div>
        <div className="text-sm">الأدوار: {roles.map(r => r.role_slug + (r.team_id ? `@${r.team_id}`:'' )).join(', ')}</div>
      </div>
    </div>
  )
}
