import type { Clock } from "../../port/Clock";

export class SystemClock implements Clock {
    nowEpochMs(): number {
        return Date.now();
    }
}
