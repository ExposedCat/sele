import { Check, ChevronDown } from 'lucide-react'
import { type CSSProperties, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './Dropdown.css'

export type DropdownOption<TValue extends string = string> = {
  value: TValue
  label: string
  disabled?: boolean
}

type DropdownAppearance = 'glass' | 'inline' | 'splitAction'
type DropdownMenuAlign = 'start' | 'end'
type DropdownSize = 'normal' | 'small' | 'large'
type DropdownValueDisplay = 'label' | 'icon'

type DropdownProps<TValue extends string = string> = {
  id?: string
  appearance?: DropdownAppearance
  disabled?: boolean
  fill?: boolean
  menuAlign?: DropdownMenuAlign
  options: readonly DropdownOption<TValue>[]
  placement?: 'bottom' | 'top'
  size?: DropdownSize
  title?: string
  value: TValue
  valueDisplay?: DropdownValueDisplay
  'aria-label'?: string
  onChange: (value: TValue) => void
}

const getOptionClassName = (active: boolean, selected: boolean, disabled: boolean): string =>
  [
    'ui-dropdown__option',
    active ? 'ui-dropdown__option--active' : null,
    selected ? 'ui-dropdown__option--selected' : null,
    disabled ? 'ui-dropdown__option--disabled' : null
  ]
    .filter(Boolean)
    .join(' ')

export const Dropdown = <TValue extends string>({
  id,
  appearance = 'glass',
  disabled = false,
  fill = false,
  menuAlign = 'start',
  options,
  placement = 'bottom',
  size = 'normal',
  title,
  value,
  valueDisplay = 'label',
  'aria-label': ariaLabel,
  onChange
}: DropdownProps<TValue>): React.ReactElement => {
  const reactId = useId().replace(/:/g, '')
  const buttonId = id ?? `dropdown-${reactId}`
  const listboxId = `${buttonId}-listbox`
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const [inFloatingPane, setInFloatingPane] = useState(false)
  const selectedIndex = options.findIndex((option) => option.value === value)
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null
  const [activeIndex, setActiveIndex] = useState(selectedIndex)
  const menuOpen = open && !disabled

  const enabledIndexes = useMemo(
    () =>
      options.reduce<number[]>((indexes, option, index) => {
        if (!option.disabled) indexes.push(index)
        return indexes
      }, []),
    [options]
  )

  useEffect(() => {
    setInFloatingPane(Boolean(rootRef.current?.closest('.chat-panel')))
  }, [])

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node

      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false)
        setMenuStyle(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) return

    const closeMenu = (): void => {
      setOpen(false)
      setMenuStyle(null)
    }

    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)

    return () => {
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [menuOpen])

  const getEnabledIndex = (index: number): number => {
    if (enabledIndexes.length === 0) return -1
    if (enabledIndexes.includes(index)) return index
    return enabledIndexes[0]
  }

  const getAdjacentEnabledIndex = (index: number, direction: 1 | -1): number => {
    if (enabledIndexes.length === 0) return -1
    const currentEnabledIndex = enabledIndexes.indexOf(index)

    if (currentEnabledIndex < 0) {
      return direction === 1 ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1]
    }

    const nextEnabledIndex =
      (currentEnabledIndex + direction + enabledIndexes.length) % enabledIndexes.length

    return enabledIndexes[nextEnabledIndex]
  }

  const getMenuStyle = (buttonRect: DOMRect): CSSProperties => {
    const viewportInset = 12
    const menuOffset = 6
    const maxMenuWidth = 280
    const startLeft = Math.min(
      Math.max(viewportInset, buttonRect.left),
      Math.max(viewportInset, window.innerWidth - maxMenuWidth - viewportInset)
    )
    const nextMenuStyle: CSSProperties = {
      minWidth: buttonRect.width
    }

    if (placement === 'top') {
      nextMenuStyle.bottom = window.innerHeight - buttonRect.top + menuOffset
    } else {
      nextMenuStyle.top = buttonRect.bottom + menuOffset
    }

    if (menuAlign === 'end') {
      nextMenuStyle.right = Math.max(viewportInset, window.innerWidth - buttonRect.right)
    } else {
      nextMenuStyle.left = startLeft
    }

    return nextMenuStyle
  }

  const openMenu = (index = selectedIndex): void => {
    if (disabled || enabledIndexes.length === 0 || typeof window === 'undefined') return

    const buttonRect = buttonRef.current?.getBoundingClientRect()
    if (!buttonRect) return

    setMenuStyle(getMenuStyle(buttonRect))
    setActiveIndex(getEnabledIndex(index))
    setOpen(true)
  }

  const selectOption = (option: DropdownOption<TValue>): void => {
    if (option.disabled) return

    onChange(option.value)
    setOpen(false)
    setMenuStyle(null)
    buttonRef.current?.focus({ preventScroll: true })
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1

      if (!menuOpen) {
        openMenu(getAdjacentEnabledIndex(selectedIndex, direction))
        return
      }

      setActiveIndex((currentIndex) => getAdjacentEnabledIndex(currentIndex, direction))
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const nextIndex =
        event.key === 'Home' ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1]

      if (typeof nextIndex !== 'number') return
      if (!menuOpen) {
        openMenu(nextIndex)
        return
      }

      setActiveIndex(nextIndex)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()

      if (!menuOpen) {
        openMenu()
        return
      }

      const activeOption = options[activeIndex]
      if (activeOption) selectOption(activeOption)
      return
    }

    if (event.key === 'Escape' && menuOpen) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setMenuStyle(null)
      return
    }

    if (event.key === 'Tab') {
      setOpen(false)
      setMenuStyle(null)
    }
  }

  const rootClassName = [
    'ui-dropdown',
    `ui-dropdown--${appearance === 'splitAction' ? 'split-action' : appearance}`,
    `ui-dropdown--${placement}`,
    `ui-dropdown--${size}`,
    `ui-dropdown--menu-${menuAlign}`,
    `ui-dropdown--value-${valueDisplay}`,
    fill ? 'ui-dropdown--fill' : null,
    menuOpen ? 'ui-dropdown--open' : null,
    disabled ? 'ui-dropdown--disabled' : null,
    inFloatingPane ? 'ui-dropdown--floating-pane' : null
  ]
    .filter(Boolean)
    .join(' ')
  const activeOptionId =
    menuOpen && activeIndex >= 0 && options[activeIndex]
      ? `${listboxId}-option-${options[activeIndex].value}`
      : undefined
  const menu = menuOpen ? (
    <div
      ref={menuRef}
      className={rootClassName}
      data-dropdown-menu-root="true"
      style={menuStyle ?? undefined}
    >
      <div className="ui-dropdown__menu" id={listboxId} role="listbox" aria-labelledby={buttonId}>
        {options.map((option, index) => {
          const selected = option.value === value
          const optionId = `${listboxId}-option-${option.value}`

          return (
            <div
              key={option.value}
              id={optionId}
              className={getOptionClassName(
                activeIndex === index,
                selected,
                Boolean(option.disabled)
              )}
              role="option"
              aria-disabled={option.disabled || undefined}
              aria-selected={selected}
              onClick={() => selectOption(option)}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => {
                if (!option.disabled) setActiveIndex(index)
              }}
            >
              <span className="ui-dropdown__option-label">{option.label}</span>
              {selected && <Check className="ui-dropdown__check" aria-hidden="true" />}
            </div>
          )
        })}
      </div>
    </div>
  ) : null

  return (
    <div className={rootClassName} ref={rootRef}>
      <button
        ref={buttonRef}
        id={buttonId}
        className="ui-dropdown__trigger"
        type="button"
        role="combobox"
        aria-activedescendant={activeOptionId}
        aria-controls={listboxId}
        aria-expanded={menuOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
        title={title ?? selectedOption?.label}
        onClick={() => {
          if (menuOpen) {
            setOpen(false)
            setMenuStyle(null)
            return
          }

          openMenu()
        }}
        onKeyDown={handleKeyDown}
      >
        <span className="ui-dropdown__value">{selectedOption?.label ?? value}</span>
        <ChevronDown className="ui-dropdown__chevron" aria-hidden="true" />
      </button>
      {menu && createPortal(menu, document.body)}
    </div>
  )
}
