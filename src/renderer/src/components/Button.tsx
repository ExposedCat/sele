import type { ButtonHTMLAttributes, FC, ReactNode } from 'react'
import './Button.css'

export type ButtonTheme = 'primary' | 'secondary' | 'transparent'
export type ButtonSize = 'normal' | 'small'

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'className' | 'onClick' | 'style' | 'type'
>

type ButtonProps = NativeButtonProps & {
  callback: () => Promise<void> | void
  icon?: ReactNode
  label?: ReactNode
  theme?: ButtonTheme
  size?: ButtonSize
  fill?: boolean
}

const getButtonClassName = (
  theme: ButtonTheme,
  size: ButtonSize,
  icon: ReactNode,
  label: ReactNode,
  fill: boolean
): string =>
  [
    'ui-button',
    `ui-button--${theme}`,
    `ui-button--${size}`,
    icon && !label ? 'ui-button--icon-only' : null,
    fill ? 'ui-button--fill' : null
  ]
    .filter(Boolean)
    .join(' ')

export const Button: FC<ButtonProps> = ({
  callback,
  icon = null,
  label = null,
  theme = 'secondary',
  size = 'normal',
  fill = false,
  ...buttonProps
}) => {
  const handleClick = (): void => {
    void callback()
  }

  return (
    <button
      {...buttonProps}
      className={getButtonClassName(theme, size, icon, label, fill)}
      type="button"
      onClick={handleClick}
    >
      {icon}
      {label && <span className="ui-button__label">{label}</span>}
    </button>
  )
}
