// src/pages/Login.tsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from '../components/ui/Toaster'
import Logo from '../assets/Scout-SVM.png' // 👈 شعار المشروع (مسار نسبي)

export default function Login() {
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  // ✅ فallback شامل لكل حالات recovery
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '')
    const search = window.location.search

    const hp = new URLSearchParams(hash)
    const qp = new URLSearchParams(search)

    const hasRecoveryInHash = hp.get('type') === 'recovery'
    const hasRecoveryInQuery =
      qp.get('type') === 'recovery' || qp.get('token_hash') || qp.get('code')

    if (hasRecoveryInHash || hasRecoveryInQuery) {
      const target =
        '/reset-password' +
        (search || '') +
        (hash ? `#${hash}` : '')
      window.location.replace(target)
    }
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) {
      toast.error('اكتب البريد وكلمة السر')
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      })
      if (error) throw error
      window.location.replace('/app')
    } catch (err: any) {
      toast.error(err?.message || 'تعذر تسجيل الدخول')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <form onSubmit={onSubmit} className="card w-full max-w-md space-y-4">
        {/* الشعار */}
        <div className="text-center">
          <img
            src={Logo}
            alt="Scout SVM Logo"
            className="mx-auto w-28 h-auto select-none"
            draggable={false}
          />
        </div>

        <h1 className="text-xl font-bold text-center">تسجيل الدخول</h1>

        <div className="space-y-2">
          <label className="text-sm">البريد الإلكتروني</label>
          <input
            type="email"
            className="border rounded-xl p-2 w-full"
            placeholder="example@email.com"
            value={email}
            onChange={e=>setEmail(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm">كلمة السر</label>
          <input
            type="password"
            className="border rounded-xl p-2 w-full"
            placeholder="••••••••"
            value={password}
            onChange={e=>setPassword(e.target.value)}
          />
        </div>

        <button className="btn border w-full" disabled={loading}>
          {loading ? '...جارٍ الدخول' : 'دخول'}
        </button>











        {/* <div className="text-center text-sm">
          <a className="text-blue-600 hover:underline" href="/forgot">نسيت كلمة السر؟</a>
        </div> */}
      </form>
    </div>
  )
}
