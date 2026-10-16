/**
 * The wall's weather-card size channel (#134).
 *
 * The page owns the one viewport mechanism, so it decides the size (`wallWeatherSize`, from
 * this device's style and the window height) and provides it here. A provide rather than a
 * fifth named prop threaded through the three views and `WallViewShell`, which only pass the
 * peripheral cards through: the `WALL_LOCK` / `WALL_BURST` precedent.
 *
 * Optional at every consumer: `inject(WALL_WEATHER, undefined)`, and a missing provider means
 * `'off'`. A peripheral card mounted in a test, or anywhere outside the wall, draws no weather
 * rather than crashing.
 */
import type { ComputedRef, InjectionKey } from 'vue';
import type { WallWeatherSize } from '@/components/wall/wallLayout';

export const WALL_WEATHER: InjectionKey<ComputedRef<WallWeatherSize>> = Symbol('wallWeather');
