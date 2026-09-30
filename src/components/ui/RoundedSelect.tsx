'use client'

import {
  Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore,
  type ChangeEvent, type CSSProperties, type KeyboardEvent, type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import styles from './RoundedSelect.module.css'

type Option = { value: string; label: string; disabled: boolean }
type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size' | 'value' | 'defaultValue'> & {
  value?: string | number
  defaultValue?: string | number
}

const subscribeToHydration = () => () => {}
const clientReady = () => true
const serverReady = () => false

function textContent(children: ReactNode): string {
  return Children.toArray(children).map((child) => isValidElement<{ children?: ReactNode }>(child)
    ? textContent(child.props.children)
    : String(child)).join('')
}

function readOptions(children: ReactNode, groupDisabled = false): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode; value?: string | number; disabled?: boolean }>(child)) return []
    if (child.type === Fragment || child.type === 'optgroup') {
      return readOptions(child.props.children, groupDisabled || Boolean(child.props.disabled))
    }
    if (child.type !== 'option') return []
    const label = textContent(child.props.children)
    return [{ value: String(child.props.value ?? label), label, disabled: groupDisabled || Boolean(child.props.disabled) }]
  })
}

/** A rounded, keyboard-accessible select. The native control retains form semantics. */
export function RoundedSelect({
  children, value, defaultValue, onChange, id: suppliedId, className, disabled,
  required, form, onInvalid, ...nativeProps
}: Props) {
  const generatedId = useId()
  const hydrated = useSyncExternalStore(subscribeToHydration, clientReady, serverReady)
  const id = suppliedId ?? `select-${generatedId}`
  const listId = `${id}-listbox`
  const options = readOptions(children)
  const [localValue, setLocalValue] = useState(String(defaultValue ?? options[0]?.value ?? ''))
  const selectedValue = value === undefined ? localValue : String(value)
  const selectedIndex = options.findIndex((option) => option.value === selectedValue)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex))
  const [invalid, setInvalid] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)
  const nativeRef = useRef<HTMLSelectElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef({ text: '', at: 0 })

  useEffect(() => {
    const native = nativeRef.current
    const owningForm = native?.form
    if (!owningForm) return
    const reset = () => queueMicrotask(() => {
      if (value === undefined && native) setLocalValue(native.value)
      setInvalid(false)
      setOpen(false)
    })
    owningForm.addEventListener('reset', reset)
    return () => owningForm.removeEventListener('reset', reset)
  }, [form, value])

  useLayoutEffect(() => {
    if (!open) return
    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const viewport = window.visualViewport
      const viewportTop = viewport?.offsetTop ?? 0
      const viewportLeft = viewport?.offsetLeft ?? 0
      const viewportHeight = viewport?.height ?? window.innerHeight
      const viewportWidth = viewport?.width ?? window.innerWidth
      const below = viewportTop + viewportHeight - rect.bottom - 16
      const above = rect.top - viewportTop - 16
      const upward = below < 180 && above > below
      const width = Math.min(Math.max(rect.width, 168), viewportWidth - 24)
      // Portals live under body, so copy tokens from the originating theme scope.
      const computed = window.getComputedStyle(trigger)
      const theme = Object.fromEntries([
        '--atlas-line', '--atlas-ink', '--atlas-paper-bright', '--atlas-jade',
        '--atlas-jade-dark', '--atlas-jade-pale', '--atlas-danger', '--atlas-font-sans',
      ].map((key) => [key, computed.getPropertyValue(key)]).filter(([, token]) => token)) as CSSProperties
      setPosition({
        ...theme,
        fontFamily: computed.fontFamily,
        direction: computed.direction as CSSProperties['direction'],
        left: Math.max(viewportLeft + 12, Math.min(rect.left, viewportLeft + viewportWidth - width - 12)),
        width,
        maxHeight: Math.max(80, Math.min(320, upward ? above : below)),
        ...(upward ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
      })
    }
    const outside = (event: Event) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.visualViewport?.addEventListener('resize', updatePosition)
    window.visualViewport?.addEventListener('scroll', updatePosition)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.visualViewport?.removeEventListener('resize', updatePosition)
      window.visualViewport?.removeEventListener('scroll', updatePosition)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
    }
  }, [open])

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, open])

  const show = () => {
    if (disabled) return
    setActiveIndex(selectedIndex >= 0 && !options[selectedIndex].disabled
      ? selectedIndex : Math.max(0, options.findIndex((option) => !option.disabled)))
    searchRef.current = { text: '', at: 0 }
    setOpen(true)
  }

  const choose = (index: number) => {
    const option = options[index]
    const native = nativeRef.current
    if (!option || option.disabled || !native) return
    setOpen(false)
    triggerRef.current?.focus()
    if (option.value === selectedValue) return
    native.value = option.value
    // A real bubbling change retains existing controlled handlers and parent forms.
    native.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const move = (direction: number) => {
    const enabled = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0)
    const current = enabled.indexOf(activeIndex)
    if (enabled.length) setActiveIndex(enabled[(current + direction + enabled.length) % enabled.length])
  }

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape') {
      if (open) event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === 'Tab') { setOpen(false); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (open) move(event.key === 'ArrowDown' ? 1 : -1)
      else show()
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const enabled = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0)
      if (!open) show()
      setActiveIndex(enabled[event.key === 'Home' ? 0 : enabled.length - 1] ?? 0)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(activeIndex)
      else show()
      return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      if (!open) show()
      const now = Date.now()
      const text = now - searchRef.current.at < 650 ? searchRef.current.text + event.key : event.key
      searchRef.current = { text, at: now }
      // Repeating one letter cycles through matching labels, like a native select.
      const query = [...text].every((letter) => letter === text[0]) ? text[0] : text
      const start = query.length === 1 ? activeIndex + 1 : 0
      const match = options.map((_, offset) => (start + offset) % options.length)
        .find((index) => !options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()))
      if (match !== undefined) setActiveIndex(match)
    }
  }

  const nativeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    if (value === undefined) setLocalValue(event.target.value)
    setInvalid(false)
    onChange?.(event)
  }

  return <span className={`${styles.root} ${className ?? ''}`}>
    <select
      {...nativeProps}
      id={`${id}-native`}
      ref={nativeRef}
      className={styles.native}
      aria-hidden="true"
      tabIndex={-1}
      disabled={disabled}
      required={required}
      form={form}
      value={value}
      defaultValue={defaultValue}
      onChange={nativeChange}
      onInvalid={(event) => {
        event.preventDefault()
        setInvalid(true)
        triggerRef.current?.focus()
        onInvalid?.(event)
      }}
    >{children}</select>
    <button
      id={id}
      ref={triggerRef}
      type="button"
      role="combobox"
      name={nativeProps.name}
      value={selectedValue}
      form={form}
      className={styles.trigger}
      disabled={disabled || !hydrated}
      data-hydrating={!hydrated || undefined}
      aria-label={nativeProps['aria-label']}
      aria-labelledby={nativeProps['aria-labelledby']}
      aria-describedby={nativeProps['aria-describedby']}
      aria-required={required || undefined}
      aria-invalid={invalid || nativeProps['aria-invalid'] || undefined}
      aria-haspopup="listbox"
      aria-controls={listId}
      aria-expanded={open}
      aria-activedescendant={open && options[activeIndex] ? `${listId}-${activeIndex}` : undefined}
      title={nativeProps.title}
      onClick={() => open ? setOpen(false) : show()}
      onKeyDown={keyDown}
    >
      <span className={styles.label}>{options[selectedIndex]?.label ?? options[0]?.label ?? ''}</span>
      <svg className={styles.chevron} viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
        <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
    {open && createPortal(<div
      id={listId}
      ref={menuRef}
      role="listbox"
      aria-labelledby={id}
      className={styles.menu}
      style={position}
    >
      {options.map((option, index) => <div
        id={`${listId}-${index}`}
        key={`${option.value}-${index}`}
        role="option"
        aria-selected={option.value === selectedValue}
        aria-disabled={option.disabled || undefined}
        data-active={index === activeIndex || undefined}
        data-index={index}
        className={styles.option}
        onPointerMove={() => !option.disabled && setActiveIndex(index)}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => choose(index)}
      >
        <span>{option.label}</span>
        {option.value === selectedValue ? <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
          <path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg> : null}
      </div>)}
    </div>, document.body)}
  </span>
}
