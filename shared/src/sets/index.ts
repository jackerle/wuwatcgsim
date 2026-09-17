// Every card set that ships with the app. Add a new set's export here and
// it becomes visible to the whole engine.
//
// Files starting with "_" are references, not real cards — never listed.
import type { CardDef } from "../cardDef";
import { BP01 } from "./BP01";
import { SD01 } from "./SD01";
import { SD02 } from "./SD02";

export const ALL_SETS: Record<string, CardDef[]> = { BP01, SD01, SD02 };

export { BP01, SD01, SD02 };
