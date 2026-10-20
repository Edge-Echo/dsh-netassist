/** Public resolvers worth comparing from mainland China, plus the two global ones. */
export declare const DEFAULT_DNS_SERVERS: readonly [{
    readonly name: "AliDNS";
    readonly ip: "223.5.5.5";
}, {
    readonly name: "DNSPod";
    readonly ip: "119.29.29.29";
}, {
    readonly name: "Cloudflare";
    readonly ip: "1.1.1.1";
}, {
    readonly name: "Google";
    readonly ip: "8.8.8.8";
}];
export interface DnsServerAnswer {
    name: string;
    server: string;
    addresses: string[];
    ms: number;
    error?: string;
}
export interface DnsCompareResult {
    host: string;
    answers: DnsServerAnswer[];
    /** True when every server that answered returned the same address set. */
    consistent: boolean;
    /** Servers that answered at all. */
    responding: number;
}
/**
 * Ask several DNS servers the same question and compare.
 *
 * A stale or poisoned answer from the system resolver is invisible until you see what other
 * resolvers return for the same name.
 */
export declare function checkDnsCompare(host?: string, timeoutMs?: number): Promise<DnsCompareResult>;
export interface RegistryProbe {
    registry: string;
    host: string;
    tcp: string;
    http: number;
    ms: number;
}
export interface RegistryCheck {
    /** The registry npm would use right now. */
    configured: string;
    probes: RegistryProbe[];
}
/** What registry npm would actually use: env var, then ~/.npmrc, then the default. */
export declare function configuredRegistry(): string;
/** Probe the npm registry npm is configured to use, plus the official one when they differ. */
export declare function checkRegistry(timeoutMs?: number): Promise<RegistryCheck>;
