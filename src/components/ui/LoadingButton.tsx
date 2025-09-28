
import { Spinner } from './Spinner'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
  variant?: 'brand' | 'outline'
}

export function LoadingButton({ loading, children, className = '', variant = 'brand', ...rest }: Props) {
  const base = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl transition cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed'
  const style = variant === 'brand'
    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
    : 'border bg-white hover:bg-gray-50'
  return (
    <button className={`${base} ${style} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading && <Spinner />}
      <span>{children}</span>
    </button>
  )
}
