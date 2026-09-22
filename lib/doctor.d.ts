import { type GithubStatus, type HostsCheck, type PortProbe, type ProxyStatus, type TunCheck } from './checks.js';
export type FindingLevel = 'ok' | 'warn' | 'error';
export interface Finding {
    level: FindingLevel;
    title: string;
    detail?: string;
}
export interface DoctorRaw {
    proxy: ProxyStatus;
    ports: PortProbe[];
    github: GithubStatus;
    hosts: HostsCheck;
    tun: TunCheck;
}
export interface DoctorReport {
    ok: boolean;
    findings: Finding[];
    suggestions: string[];
    raw: DoctorRaw;
}
/** Run the full preflight diagnosis and derive suggestions. */
export declare function runDoctor(opts?: {
    timeoutMs?: number;
    extraPorts?: number[];
}): Promise<DoctorReport>;
/** Render the doctor report for the terminal. */
export declare function renderDoctor(report: DoctorReport): string;
