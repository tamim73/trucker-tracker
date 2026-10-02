import { lazy, Suspense, type ComponentProps } from 'react'
import type { TripMap as TripMapType } from './TripMap'

const TripMap = lazy(() => import('./TripMap').then((m) => ({ default: m.TripMap })))

/** MapLibre is most of the bundle; load it after the page shell paints. */
export function LazyMap(props: ComponentProps<typeof TripMapType>) {
  return (
    <Suspense fallback={<div className={`skeleton ${props.className ?? ''}`} aria-hidden />}>
      <TripMap {...props} />
    </Suspense>
  )
}
