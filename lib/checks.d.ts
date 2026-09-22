export declare const DEFAULT_TIMEOUT_MS = 25000;
export declare const DEFAULT_PROXY_PORTS: number[];
export declare function ps(script: string, timeoutMs?: number): Promise<string>;
export declare function psJson<T>(script: string, timeoutMs?: number): Promise<T>;
export declare function b64(s: string): string;
export declare function psStr(base64: string): string;
/** PowerShell expression: TCP connect test; wrap in `$()` at the call site. */
export declare function tcpTestExpr(hostExpr: string, port: number | string, timeoutMs?: number): string;
export interface GithubStatus {
    dns: string[];
    tcp443: string;
    reachable: boolean;
    /** HTTP status code when the HTTPS probe succeeded. */
    httpStatus?: number;
    /** Round-trip milliseconds for the TCP probe. */
    tcpMs?: number;
}
/** DNS + TCP (+ optional HTTPS) reachability of github.com. */
export declare function checkGithub(timeoutMs?: number): Promise<GithubStatus>;
export interface ProxyStatus {
    enabled: boolean;
    server: string;
    override: string;
    envHttp: string;
    envHttps: string;
    /** Parsed `host:port` of the effective proxy (system proxy when enabled, else env vars). */
    hostPort?: {
        host: string;
        port: number;
    };
    /** Registry holds a proxy address while the Windows proxy switch is OFF. */
    staleServer?: string;
}
export declare function checkProxyStatus(timeoutMs?: number): Promise<ProxyStatus>;
export interface PortProbe {
    port: number;
    status: string;
}
/** TCP probe of candidate local proxy ports. */
export declare function checkProxyPorts(ports?: number[], timeoutMs?: number): Promise<PortProbe[]>;
export interface HostsCheck {
    entries: string[];
    hasGithub: boolean;
}
export declare function checkHosts(timeoutMs?: number): Promise<HostsCheck>;
export interface TunCheck {
    /** Names of virtual/TUN-style adapters that are up. */
    adapters: string[];
    detected: boolean;
}
/** Detect TUN/TAP-style virtual adapters (system proxy is often bypassed under TUN). */
export declare function checkTunAdapters(timeoutMs?: number): Promise<TunCheck>;
export interface DiagResult {
    host: string;
    dns: string[];
    tcp: string;
    http: string;
}
/** Full diagnosis chain for an arbitrary host. */
export declare function checkDiag(host: string, port?: number, path?: string, timeoutMs?: number): Promise<DiagResult>;
