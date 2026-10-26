export function profilePartition(id: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new Error("Invalid profile identifier");
    }
    return `persist:household-${id.toLowerCase()}`;
}

export function serverAddress(value: string): string {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
        throw new Error("Use an HTTPS server address, or HTTP on localhost for development");
    }
    return url.origin;
}

export function isTrustedNavigation(value: string, origin: string): boolean {
    try { return new URL(value).origin === origin; } catch { return false; }
}

export function permitsOfflineProfile(grant: unknown, profileId: string, server: string, tokenHash: string, now: number): boolean {
    return !!grant && typeof grant === "object" && "profileId" in grant && grant.profileId === profileId &&
        "server" in grant && grant.server === server && "tokenHash" in grant && grant.tokenHash === tokenHash &&
        "kid" in grant && grant.kid === false && "expiresAt" in grant && typeof grant.expiresAt === "number" &&
        grant.expiresAt > now;
}
