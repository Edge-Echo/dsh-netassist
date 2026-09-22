import type { Context } from '@deepseek-ai/cordis';
/** Plugin config: per-call PowerShell timeout. */
export interface NetassistConfig {
    psTimeoutMs?: number;
}
declare const _default: ((ctx: Context, config?: NetassistConfig) => void) & {
    inject: string[];
};
export default _default;
