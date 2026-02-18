import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import React from 'react'

type ErrorType = '404' | '500' | '403' | 'maintenance'

interface ErrorConfig {
  code: string
  title: string
  message: string
  icon: (props: { className?: string }) => React.ReactElement
  action?: { label: string; path: string }
}

const errors: Record<ErrorType, ErrorConfig> = {
  '404': {
    code: '404',
    title: 'Página no encontrada',
    message: 'Lo sentimos, no pudimos encontrar la página que estás buscando. Puede que haya sido movida o eliminada.',
    icon: ({ className }) => (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    action: { label: 'Volver al inicio', path: '/' }
  },
  '500': {
    code: '500',
    title: 'Error del servidor',
    message: 'Nuestros servidores están teniendo problemas. Por favor, inténtalo de nuevo más tarde.',
    icon: ({ className }) => (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    action: { label: 'Reintentar', path: '.' }
  },
  '403': {
    code: '403',
    title: 'Acceso denegado',
    message: 'No tienes permisos para acceder a esta página. Contacta al administrador si crees que es un error.',
    icon: ({ className }) => (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
    action: { label: 'Ir al inicio', path: '/' }
  },
  'maintenance': {
    code: 'Mantenimiento',
    title: 'En mantenimiento',
    message: 'Estamos realizando mejoras en nuestra plataforma. Volveremos pronto.',
    icon: ({ className }) => (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  }
}

export default function ErrorPage({ type = '404' }: { type?: ErrorType }) {
  const config = errors[type]
  const nav = useNavigate()

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center p-4 text-center overflow-hidden">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative mb-8"
      >
        <motion.div 
          animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 bg-blue-100 rounded-full blur-3xl opacity-50 transform scale-150" 
        />
        <motion.div 
          whileHover={{ rotate: 5, scale: 1.05 }}
          transition={{ type: "spring", stiffness: 300 }}
          className="relative w-32 h-32 sm:w-40 sm:h-40 rounded-full bg-gradient-to-br from-[#e9f2f7] to-[#dbe9f2] flex items-center justify-center shadow-inner z-10"
        >
          <motion.div
            animate={{ y: [0, -5, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <config.icon className="w-16 h-16 sm:w-20 sm:h-20 text-[#517ea0]" />
          </motion.div>
        </motion.div>
        
        {/* Floating elements animation */}
        <motion.div 
          animate={{ y: [0, -15, 0], rotate: [0, 10, 0], x: [0, 5, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-4 -right-4 w-12 h-12 rounded-full bg-white shadow-xl flex items-center justify-center border border-blue-50 z-20"
        >
          <span className="text-2xl font-bold text-[#517ea0]">!</span>
        </motion.div>

        {/* Extra decorative bubbles */}
        <motion.div
          animate={{ y: [0, 10, 0], x: [0, -5, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute bottom-0 -left-2 w-6 h-6 rounded-full bg-blue-50 shadow-sm border border-blue-100 z-0"
        />
      </motion.div>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="max-w-md space-y-4 relative z-10"
      >
        <motion.h1 
          animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
          transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
          className="text-6xl sm:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#5488af] via-[#487aa1] to-[#5488af] bg-[length:200%_auto]"
        >
          {config.code}
        </motion.h1>
        <h2 className="text-2xl font-bold text-neutral-800">
          {config.title}
        </h2>
        <p className="text-neutral-600">
          {config.message}
        </p>

        {config.action && (
          <motion.div 
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="pt-6"
          >
            <button
              onClick={() => config.action?.path === '.' ? window.location.reload() : nav(config.action!.path)}
              className="px-8 py-3 rounded-full bg-gradient-to-r from-[#5488af] to-[#487aa1] text-white font-semibold shadow-lg shadow-blue-900/10 hover:shadow-xl hover:-translate-y-0.5 transition-all duration-300 flex items-center gap-2 mx-auto"
            >
              <span>{config.action.label}</span>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
              </svg>
            </button>
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}
