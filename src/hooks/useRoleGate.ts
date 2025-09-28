
import { useMemo } from 'react'
import { useAuth } from '../components/AuthProvider'

export function useRoleGate() {
  const { roles } = useAuth()

  const isAdmin = roles.some(r => r.role_slug === 'admin')
  const hasGlobal = (slug: string) => roles.some(r => r.role_slug === slug && (r.team_id === null || r.team_id === undefined))
  const hasTeam = (slug: string, teamId?: string | null) => {
    if (!teamId) return false
    return roles.some(r => r.role_slug === slug && r.team_id === teamId)
  }

  return useMemo(() => ({
    isAdmin,
    hasGlobal,
    hasTeam,
    canEditBudget: (teamId?: string | null) => isAdmin || hasGlobal('responsable_finance'),
    canWriteExpense: (teamId?: string | null) => isAdmin || (teamId ? (hasTeam('responsable_finance', teamId) || hasTeam('chef_de_legion', teamId)) : false),
    canManageInventory: () => isAdmin || hasGlobal('responsable_materials'),
    canBookReservations: (teamId?: string | null) => isAdmin || (teamId ? (hasTeam('responsable_materials', teamId) || hasTeam('chef_de_legion', teamId)) : false),
  }), [roles])
}
