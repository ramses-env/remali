import { useTheme } from '../store/theme'

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={isDark ? 'Modo claro' : 'Modo oscuro'}
      className={`relative w-9 h-9 rounded-full border border-edge bg-surface-2 text-mute hover:text-gold transition-colors flex items-center justify-center ${className}`}
    >
      {isDark ? (
        // Sol
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
          <circle cx="12" cy="12" r="4" />
          <path strokeLinecap="round" d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" />
        </svg>
      ) : (
        // Luna
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
        </svg>
      )}
    </button>
  )
}
