import type { DriverDetails } from './api'

export const EMPTY_DRIVER: DriverDetails = {
  name: '',
  co_driver: '',
  carrier: '',
  main_office: '',
  home_terminal: '',
  vehicle_numbers: '',
  shipping_document: '',
  commodity: '',
}

export const DRIVER_FIELDS: { key: keyof DriverDetails; label: string; placeholder: string; autoComplete?: string }[] = [
  { key: 'name', label: 'Driver name', placeholder: 'Full name…', autoComplete: 'name' },
  { key: 'co_driver', label: 'Co-driver', placeholder: 'Leave blank if solo…' },
  { key: 'carrier', label: 'Carrier', placeholder: 'Company name…', autoComplete: 'organization' },
  { key: 'vehicle_numbers', label: 'Truck and trailer numbers', placeholder: 'Tractor 4471 / Trailer 53-1208…' },
  { key: 'main_office', label: 'Main office address', placeholder: 'Street, city, state…' },
  { key: 'home_terminal', label: 'Home terminal address', placeholder: 'Street, city, state…' },
  { key: 'shipping_document', label: 'Shipping document number', placeholder: 'BOL or manifest number…' },
  { key: 'commodity', label: 'Shipper and commodity', placeholder: 'Shipper, commodity…' },
]
