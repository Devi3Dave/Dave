import type { ProfileField, SavedSignature } from './types'

// Small per-device settings (signatures, autofill profile) in localStorage.
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or unavailable – settings just won't persist */
  }
}

export type SigRole = 'signature' | 'initials'

export const loadSignature = (role: SigRole) => read<SavedSignature | null>(`fs.sig.${role}`, null)
export const saveSignature = (role: SigRole, sig: SavedSignature | null) => write(`fs.sig.${role}`, sig)

const DEFAULT_PROFILE: ProfileField[] = [
  { key: 'name', label: 'Vollständiger Name', value: '' },
  { key: 'first', label: 'Vorname', value: '' },
  { key: 'last', label: 'Nachname', value: '' },
  { key: 'street', label: 'Straße und Hausnummer', value: '' },
  { key: 'city', label: 'PLZ und Ort', value: '' },
  { key: 'email', label: 'E-Mail', value: '' },
  { key: 'phone', label: 'Telefon', value: '' },
  { key: 'birth', label: 'Geburtsdatum', value: '' },
]

export function loadProfile(): ProfileField[] {
  const saved = read<ProfileField[]>('fs.profile', [])
  const byKey = new Map(saved.map((f) => [f.key, f]))
  const merged = DEFAULT_PROFILE.map((f) => byKey.get(f.key) ?? f)
  return [...merged, ...saved.filter((f) => !DEFAULT_PROFILE.some((d) => d.key === f.key))]
}
export const saveProfile = (fields: ProfileField[]) => write('fs.profile', fields)

export const loadInk = () => read<string>('fs.ink', '#111111')
export const saveInk = (c: string) => write('fs.ink', c)
