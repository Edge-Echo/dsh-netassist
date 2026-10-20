export interface TcpResult {
    state: 'OPEN' | 'CLOSED' | 'TIMEOUT';
    ms: number;
}
/** TCP connect test with a bounded wait; never rejects. */
export declare function tcpProbe(host: string, port: number, timeoutMs?: number): Promise<TcpResult>;
/** HTTP status code for a URL, or -1 when the request could not complete. */
export declare function httpStatus(url: string, timeoutMs?: number): Promise<number>;
export interface ResolveResult {
    addresses: string[];
    ms: number;
    error?: string;
}
/**
 * Resolve a host through one specific DNS server.
 *
 * The system resolver cannot answer "which DNS server would work here", which is the actual
 * question when GitHub resolves to a stale address.
 */
export declare function resolveVia(server: string, host: string, timeoutMs?: number): Promise<ResolveResult>;
