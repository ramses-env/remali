import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

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

  const toggle = () => {
    setDark(v => !v)
  }

  return (
    <button 
      onClick={toggle}
      className={`relative inline-flex items-center h-9 w-16 rounded-full p-1 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${dark ? 'bg-neutral-800' : 'bg-neutral-200'}`}
      aria-label="Toggle theme"
    >
      <span className="sr-only">Toggle theme</span>
      <motion.div
        className="w-7 h-7 bg-white rounded-full shadow-sm grid place-items-center"
        layout
        transition={{ type: "spring", stiffness: 700, damping: 30 }}
        style={{ x: dark ? 28 : 0 }}
      >
        <motion.div
          initial={false}
          animate={{ scale: dark ? 0 : 1, opacity: dark ? 0 : 1 }}
          transition={{ duration: 0.2 }}
          className="absolute"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-yellow-500"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        </motion.div>
        <motion.div
          initial={false}
          animate={{ scale: dark ? 1 : 0, opacity: dark ? 1 : 0 }}
          transition={{ duration: 0.2 }}
          className="absolute"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
        </motion.div>
      </motion.div>
    </button>
  )
}
