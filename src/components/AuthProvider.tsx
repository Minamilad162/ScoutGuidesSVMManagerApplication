import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

type RoleView = { role_slug: string; team_id: string | null }
type Ctx = {
  user: any | null
  roles: RoleView[]
  myTeamId: string | null
  loading: boolean
  signInWithPassword: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}
const AuthCtx = createContext<Ctx>({
  user: null, roles: [], myTeamId: null, loading: true,
  signInWithPassword: async () => {}, signOut: async () => {}
})

export function AuthProvider({ children }: { children: any }) {
  const [user, setUser] = useState<any | null>(null)
  const [roles, setRoles] = useState<RoleView[]>([])
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setUser(session?.user ?? null)
      setLoading(false)
    }
    init()
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => { listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    const load = async () => {
      if (!user) { setRoles([]); setMyTeamId(null); return }
      const { data: rolesData } = await supabase.from('user_roles_view').select('role_slug, team_id').eq('user_id', user.id)
      setRoles((rolesData as any[])?.map(r => ({ role_slug: r.role_slug, team_id: r.team_id })) ?? [])
      const { data: me } = await supabase.from('v_me').select('member_id, team_id').maybeSingle()
      setMyTeamId(me?.team_id ?? null)
    }
    load()
  }, [user])

  async function signInWithPassword(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }
  async function signOut() { await supabase.auth.signOut() }

  const value = useMemo(() => ({ user, roles, myTeamId, loading, signInWithPassword, signOut }), [user, roles, myTeamId, loading])
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
export function useAuth() { return useContext(AuthCtx) }
