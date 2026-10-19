export interface Closure {
  from: string // YYYY-MM-DD
  to: string
  reason: string | null
}

export interface Branch {
  id: string
  name: string
  timezone: string
  latitude: number
  longitude: number
  distanceKm: number | null // only when the client's position was sent
  closure: Closure | null // set while the branch is closed today
}
