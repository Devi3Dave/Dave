import { useState } from 'react'
import type { ProfileField } from '../types'
import { loadProfile, saveProfile } from '../settings'
import { uid } from '../util'

interface Props {
  style?: React.CSSProperties
  onPick: (text: string) => void
  onClose: () => void
}

/** "Autofill" profile: saved personal details that can be dropped onto a form with one tap. */
export default function ProfileSheet({ style, onPick, onClose }: Props) {
  const [fields, setFields] = useState<ProfileField[]>(loadProfile)
  const filled = fields.filter((f) => f.value.trim())
  const [editing, setEditing] = useState(filled.length === 0)

  const update = (key: string, patch: Partial<ProfileField>) =>
    setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)))

  const done = () => {
    saveProfile(fields)
    setEditing(false)
  }

  return (
    <div className="popover profile" style={style}>
      <div className="popover-head">
        <strong>Eigene Angaben</strong>
        {editing ? (
          <button className="btn-text strong" onClick={done}>Fertig</button>
        ) : (
          <button className="btn-text" onClick={() => setEditing(true)}>Bearbeiten</button>
        )}
      </div>
      {editing ? (
        <div className="profile-edit">
          {fields.map((f) => (
            <label key={f.key} className="field">
              <input
                className="field-label"
                value={f.label}
                onChange={(e) => update(f.key, { label: e.target.value })}
                aria-label="Bezeichnung"
              />
              <input
                className="field-value"
                value={f.value}
                placeholder="Nicht ausgefüllt"
                onChange={(e) => update(f.key, { value: e.target.value })}
              />
            </label>
          ))}
          <button
            className="btn-text"
            onClick={() => setFields((fs) => [...fs, { key: uid(), label: 'Eigenes Feld', value: '' }])}
          >
            + Feld hinzufügen
          </button>
        </div>
      ) : (
        <ul className="profile-list">
          {filled.map((f) => (
            <li key={f.key}>
              <button onClick={() => { onPick(f.value); onClose() }}>
                <span className="muted">{f.label}</span>
                <span>{f.value}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
