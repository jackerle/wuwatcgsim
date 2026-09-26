// Every lesson, in the order the Tutorial menu lists them — the order a new
// player is best off taking them in.

import { abilityLesson } from "./abilityLesson";
import { colorLesson } from "./colorLesson";
import type { Lesson } from "./director";
import { levelLesson } from "./levelLesson";
import { phaseLesson } from "./phaseLesson";

export const LESSONS: Lesson[] = [phaseLesson, colorLesson, levelLesson, abilityLesson];
