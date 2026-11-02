import { Field } from "./ui";
import { t } from "../lib/i18n";
import { useStore } from "../lib/store";
import type { Location } from "../lib/types";

/** Real places stock can be (the In-transit location is internal and hidden here). */
export const placeList = (locs: Location[]) => locs.filter((l) => l.kind !== "transit" && l.kind !== "wip" && !l.archived).sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));

/** Location select; empty value = the default location. */
export function LocationSelect({ value, onChange, disabled, label }: { value: string | null; onChange: (id: string | null) => void; disabled?: boolean; label?: string }) {
  const { db } = useStore();
  const places = placeList(db.locations);
  const def = places.find((l) => l.is_default);
  if (places.length <= 1 && !value) return null; // one location: nothing to choose
  return (
    <Field label={label ?? t("Location")}>
      <select value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{def ? `${def.name} (${t("default")})` : t("Default")}</option>
        {places.filter((l) => !l.is_default).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </Field>
  );
}
