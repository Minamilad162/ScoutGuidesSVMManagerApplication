
export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <span className={`inline-block animate-spin rounded-full border-2 border-gray-300 border-t-transparent ${className}`} />
  )
}
