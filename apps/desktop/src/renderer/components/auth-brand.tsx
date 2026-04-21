import wimmLogoIcon from '../assets/images/wimm-logo-icon.png'
import wimmLogoLabel from '../assets/images/wimm-logo-label.png'

/** Vertical brand mark: icon above wordmark + tagline (login/register). */
export function AuthBrand(): JSX.Element {
  return (
    <div className="wm-auth-brand">
      <img
        src={wimmLogoIcon}
        alt=""
        className="wm-auth-logo wm-auth-logo--icon"
        decoding="async"
        aria-hidden
      />
      <img
        src={wimmLogoLabel}
        alt="Wimm — Where is my money?"
        className="wm-auth-logo wm-auth-logo--label"
        decoding="async"
      />
    </div>
  )
}
