import { PROFILE_CATALOG } from "./catalog.ts";

/**
 * Branded collections (games, films, TV, cars, sports clubs, artists, fashion and food brands) use other companies'
 * names, artwork and logos. They stay switched off for the public release until MAKZ Labs holds a licence or written
 * permission for each one. Flip this to true only for private builds.
 */
export const LICENSED_COLLECTIONS_ENABLED = false;

type Entry = (typeof PROFILE_CATALOG)[number];
export const isLicensedCollection = (c: Pick<Entry, "category">) => c.category !== "Original Themes (No Brand)";
/** Collections people can pick and save right now. */
export const AVAILABLE_CATALOG = PROFILE_CATALOG.filter((c) => c.ready && (LICENSED_COLLECTIONS_ENABLED || !isLicensedCollection(c)));
