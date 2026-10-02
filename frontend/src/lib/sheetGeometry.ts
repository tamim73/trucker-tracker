import type { DutyStatus } from './api'
import { DUTY_ORDER } from './duty'

/** Layout of the paper log sheet, in SVG units (viewBox 0 0 W H). */
export const W = 1100
export const H = 860
export const GX = 136 // grid left
export const GW = 864 // 24 h x 36 px
export const HOUR = GW / 24
export const GT = 280 // grid top
export const RH = 34 // row height
export const GB = GT + RH * 4
export const TX = GX + GW // totals column left
export const RB = GB + 52 // remarks baseline

export const PAPER = '#fefefd'
export const PRINT = '#1b1b1b'
export const RULE = '#3b3b3b'
export const FAINT = '#8a8a86'
export const PEN = '#1f3a93'
export const DANGER = '#c0262d'

/** Minute of the day to x on the grid, and duty status to the y of its row's center. */
export const x = (minute: number) => GX + (minute / 60) * HOUR
export const rowY = (status: DutyStatus) => GT + DUTY_ORDER.indexOf(status) * RH + RH / 2
