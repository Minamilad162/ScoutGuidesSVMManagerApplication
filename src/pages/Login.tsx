import { useState } from 'react'
import { useAuth } from '../components/AuthProvider'
import Logo from '../assets/Scout-SVM.png'

export default function Login() {
  const { signInWithPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setLoading(true)
    try {
      await signInWithPassword(email.trim(), password)
    } catch (e: any) {
      setErr(e.message || 'فشل تسجيل الدخول')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap min-h-screen flex items-center justify-center bg-gradient-to-br from-sky-50 via-indigo-50 to-violet-50 p-4">
      <form className="login-card w-full max-w-md rounded-3xl shadow-xl border bg-white/80 backdrop-blur p-6 md:p-8" onSubmit={submit}>
        <div className="flex flex-col items-center gap-3 mb-6">
          <img src={Logo} alt="Scouts & Guides Saint Vincent" className="h-20 w-20 object-contain drop-shadow" />
          <h1 className="title text-2xl font-extrabold tracking-tight">تسجيل الدخول</h1>
          <p className="text-sm text-gray-600">مرحبًا بك في Scout Manager</p>
        </div>

        <label className="label text-sm">اسم المستخدم (البريد الإلكتروني)</label>
        <input
          className="input border rounded-xl p-3 w-full"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={e=>setEmail(e.target.value)}
          autoComplete="username"
          required
        />

        <label className="label text-sm mt-3">كلمة المرور</label>
        <input
          className="input border rounded-xl p-3 w-full"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={e=>setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        {err && <div className="err mt-3 text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2 text-sm">{err}</div>}

        <button className="btn btn-brand w-full mt-4" disabled={loading}>
          {loading ? 'جاري الدخول...' : 'دخول'}
        </button>

        <div className="hint text-center text-xs text-gray-500 mt-4">
          لو ماعندك حساب، تواصل مع الأدمن لإضافتك.
        </div>
      </form>
    </div>
  )
}
