/**
 * The wall's family memories channel (#140). The faces that open the viewer sit inside the
 * chore board, the details sheet, the footer and the lane headers, and the wall views are
 * rendered through one generic `<component :is>`, so a prop would fall through to every
 * view. One typed provide instead, the `WALL_LOCK` precedent.
 *
 * Optional at every consumer: `inject(WALL_MEMORIES, null)`. With no provider a face stays
 * a plain picture and a chip keeps filtering, which is also what lets the existing tests
 * mount these components unchanged.
 */
import type { InjectionKey } from 'vue';
import type { WallMemoriesContext } from '@/composables/useWallMemories';

export const WALL_MEMORIES: InjectionKey<WallMemoriesContext> = Symbol('wallMemories');
