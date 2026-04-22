import { useTranslation } from 'react-i18next'
import wimmLogoIcon from '../assets/images/wimm-logo-icon.png'
import wimmLogoLabel from '../assets/images/wimm-logo-label.png'

/** Vertical brand mark: icon above wordmark (login/register). */
export function AuthBrand(): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mb-1 flex flex-col items-center justify-center gap-3">
      <img
        src={wimmLogoIcon}
        alt=""
        className="block h-auto w-auto max-h-[60px] max-w-[min(140px,42vw)] object-contain"
        decoding="async"
        aria-hidden
      />
      <img
        src={wimmLogoLabel}
        alt={t('auth.brandAlt')}
        className="block h-auto w-auto max-h-[65px] max-w-full object-contain"
        decoding="async"
      />
    </div>
  );
}
