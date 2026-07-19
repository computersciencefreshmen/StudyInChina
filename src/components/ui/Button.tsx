import Link from 'next/link'
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from 'react'

import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet'
export type ButtonSize = 'small' | 'medium' | 'large'

type SharedButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  iconStart?: ReactNode
  iconEnd?: ReactNode
}

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    SharedButtonProps {
  isLoading?: boolean
  loadingLabel?: string
}

export function Button({
  children,
  variant = 'primary',
  size = 'medium',
  fullWidth = false,
  iconStart,
  iconEnd,
  isLoading = false,
  loadingLabel = 'Loading',
  disabled,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'atlas-button',
        `atlas-button--${variant}`,
        `atlas-button--${size}`,
        fullWidth && 'atlas-button--full',
        className,
      )}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {isLoading ? <span className="atlas-button__spinner" aria-hidden="true" /> : iconStart ? (
        <span className="atlas-button__icon" aria-hidden="true">{iconStart}</span>
      ) : null}
      <span>{isLoading ? loadingLabel : children}</span>
      {!isLoading && iconEnd ? (
        <span className="atlas-button__icon atlas-button__icon--end" aria-hidden="true">
          {iconEnd}
        </span>
      ) : null}
    </button>
  )
}

export interface LinkButtonProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>,
    SharedButtonProps {
  href: string
}

export function LinkButton({
  children,
  href,
  variant = 'primary',
  size = 'medium',
  fullWidth = false,
  iconStart,
  iconEnd,
  className,
  ...props
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      className={cx(
        'atlas-button',
        `atlas-button--${variant}`,
        `atlas-button--${size}`,
        fullWidth && 'atlas-button--full',
        className,
      )}
      {...props}
    >
      {iconStart ? <span className="atlas-button__icon" aria-hidden="true">{iconStart}</span> : null}
      <span>{children}</span>
      {iconEnd ? (
        <span className="atlas-button__icon atlas-button__icon--end" aria-hidden="true">
          {iconEnd}
        </span>
      ) : null}
    </Link>
  )
}
