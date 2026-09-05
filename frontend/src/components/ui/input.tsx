import * as React from 'react'

import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      // El aspecto lo pone `.campo` (index.css), el mismo de todo el panel: este
      // componente venía de shadcn con su propia paleta (`border-input`,
      // `bg-background`) y era el único input de la app que no seguía el tema.
      className={cn('campo', className)}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = 'Input'

export { Input }

