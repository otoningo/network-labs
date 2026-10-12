'use client';

import { useI18n } from '@/lib/i18n/context';
import type { Journey } from '@/lib/landing/journey';
import { jumpToStep } from './FoldJourney';
import { journeySteps } from './journeySteps';
import { StepList } from './StepList';

/** La columna numerada en el hero: el paso 01 activo y el resto, el viaje que viene al bajar. */
export function HeroSteps({ journey }: { readonly journey: Journey }) {
  const { messages } = useI18n();
  return <StepList steps={journeySteps(journey, messages)} active={0} onSelect={jumpToStep} />;
}
