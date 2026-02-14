import { useEffect, useState } from 'react'

export default function DarkModeToggle() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('theme')
    if (saved) return saved === 'dark'
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  useEffect(() => {
    const cls = document.documentElement.classList
    cls.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }, [dark])
  return (
    <button type="button" aria-label="Toggle theme" onClick={() => {
      setDark(v => {
        const next = !v
        const root = document.documentElement
        const body = document.body
        root.classList.toggle('dark', next)
        body.classList.toggle('dark', next)
        localStorage.setItem('theme', next ? 'dark' : 'light')
        document.documentElement.style.colorScheme = next ? 'dark' : 'light'
        return next
      })
    }} className="flex items-center gap-2 p-2 rounded-full border hover:bg-[#e9f2f7] dark:hover:bg-neutral-800">
      {dark ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-5 h-5"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
      )}
      <span className="hidden sm:inline text-sm">{dark ? 'Oscuro' : 'Claro'}</span>
    </button>
  )
}
