import { forwardRef, type InputHTMLAttributes } from 'react'
import './Input.css'

type InputProps = InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...inputProps }, ref) => (
    <input
      ref={ref}
      className={['ui-input', className].filter(Boolean).join(' ')}
      {...inputProps}
    />
  )
)

Input.displayName = 'Input'
